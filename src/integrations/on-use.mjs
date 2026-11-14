/**
 * pf1-critical-effects – On Use: what a buff's action does once it has been used (DESIGN.md §8.3).
 *
 * Buffs only. Config is per action, stored on the parent item keyed by action id (PF1 actions
 * carry no flags): `flags.pf1-critical-effects.onUse.<actionId>`.
 *
 *   { effect: "healCheck" }
 *   { effect: "save", save: "fort", dc: "10", onSuccess: "", onFailure: "replace",
 *     replaceWith: { uuid, name } }
 *
 * `dc` is a formula against the item's roll data; blank reads the DC the buff was delivered at
 * (astora-mod's delivery stamp). Outcomes: "" nothing, "end" switch this buff off, "replace"
 * switch it off and put `replaceWith` on in its place.
 */

import { MODULE_ID } from "../const.mjs";
import { requestHealCheck } from "./dedicated-healing.mjs";

export const FLAG_KEY = "onUse";

export const SAVES = ["fort", "ref", "will"];

const DEFAULTS = Object.freeze({
  effect: "",
  save: "fort",
  dc: "",
  onSuccess: "",
  onFailure: "",
  replaceWith: null,
});

/**
 * @param {Item} item
 * @param {string} actionId
 * @returns {typeof DEFAULTS}
 */
export function getConfig(item, actionId) {
  const raw = item?.flags?.[MODULE_ID]?.[FLAG_KEY]?.[actionId] ?? {};
  return { ...DEFAULTS, ...raw };
}

/**
 * Merge a patch into one action's config. Clearing the effect drops the entry entirely.
 *
 * @param {Item} item
 * @param {string} actionId
 * @param {object} patch
 */
export async function setConfig(item, actionId, patch) {
  const path = `flags.${MODULE_ID}.${FLAG_KEY}`;
  const next = { ...getConfig(item, actionId), ...patch };
  if (!next.effect) return item.update({ [`${path}.-=${actionId}`]: null });
  return item.update({ [`${path}.${actionId}`]: next });
}

/** Stamped DC from astora-mod's buff delivery, when there is one. */
function deliveredDC(item) {
  const info = item.flags?.["astora-mod"]?.sourceInfo ?? item.getRollData?.()?.sourceInfo ?? {};
  const dc = Number(info.saveDC);
  return Number.isFinite(dc) ? dc : null;
}

async function resolveDC(item, formula) {
  const text = String(formula ?? "").trim();
  if (!text) return deliveredDC(item);
  if (/^-?\d+$/.test(text)) return Number(text);
  const roll = await pf1.dice.RollPF.safeRoll(text, item.getRollData());
  return Number.isFinite(roll?.total) ? roll.total : null;
}

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

const endBuff = (item) => item.setActive(false);

/**
 * Put the replacement buff on the actor, active, then switch this one off. Created first so a
 * missing replacement never costs the original.
 */
async function replaceBuff(actor, item, ref) {
  const source = ref?.uuid ? await fromUuid(ref.uuid) : null;
  const name = source?.name ?? ref?.name;
  if (!name) {
    ui.notifications.warn(`${item.name}: no replacement buff configured.`);
    return;
  }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("CRITICAL_EFFECTS.OnUse.ReplaceTitle") },
    content: `<p>${game.i18n.format("CRITICAL_EFFECTS.OnUse.ReplacePrompt", { from: esc(item.name), to: esc(name) })}</p>`,
  });
  if (!confirmed) return;

  const existing = actor.items.find((i) => i.type === "buff" && i.name === name);
  if (existing) {
    if (!existing.isActive) await existing.setActive(true);
  } else if (source?.documentName === "Item") {
    const data = source.pack ? game.items.fromCompendium(source, { clearFolder: true }) : source.toObject();
    delete data._id;
    data.system.active = true;
    await actor.createEmbeddedDocuments("Item", [data]);
  } else {
    ui.notifications.warn(`${item.name}: replacement buff "${name}" could not be found.`);
    return;
  }
  await endBuff(item);
}

async function runSave(actor, item, cfg) {
  const dc = await resolveDC(item, cfg.dc);
  if (!Number.isFinite(dc)) {
    ui.notifications.warn(`${item.name}: no save DC set or stamped on this buff – no save rolled.`);
    return;
  }

  // Unowned actors are GM auto-rolls: no dialog.
  const message = await actor.rollSavingThrow(cfg.save, { dc, skipDialog: !actor.hasPlayerOwner });
  const roll = message?.rolls?.[0];
  if (!roll) return;

  const passed = roll.isSuccess ?? roll.total >= dc;
  const outcome = passed ? cfg.onSuccess : cfg.onFailure;
  if (outcome === "end") await endBuff(item);
  else if (outcome === "replace") await replaceBuff(actor, item, cfg.replaceWith);
}

async function onPostActionUse(actionUse) {
  const item = actionUse?.item;
  const actor = actionUse?.actor ?? item?.actor;
  const actionId = actionUse?.action?.id;
  if (item?.type !== "buff" || !actor || !actionId) return;

  const cfg = getConfig(item, actionId);
  if (cfg.effect === "healCheck") await requestHealCheck(actor, item);
  else if (cfg.effect === "save") await runSave(actor, item, cfg);
}

/** Drop entries for actions removed from the item. */
function onPreUpdateItem(item, changed) {
  const actions = changed.system?.actions;
  if (!Array.isArray(actions)) return;
  const stored = item.flags?.[MODULE_ID]?.[FLAG_KEY];
  if (!stored) return;
  const live = new Set(actions.map((a) => a._id));
  for (const id of Object.keys(stored)) {
    if (!live.has(id)) foundry.utils.setProperty(changed, `flags.${MODULE_ID}.${FLAG_KEY}.-=${id}`, null);
  }
}

export function registerOnUse() {
  Hooks.on("pf1PostActionUse", (actionUse) => {
    onPostActionUse(actionUse).catch((err) => console.error(`${MODULE_ID} | on-use failed`, err));
  });
  Hooks.on("preUpdateItem", onPreUpdateItem);
}
