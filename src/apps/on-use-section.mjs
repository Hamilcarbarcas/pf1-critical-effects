/**
 * pf1-critical-effects – the On Use section on a buff action's Misc tab (DESIGN.md §8.3).
 */

import { MODULE_ID } from "../const.mjs";
import { SAVES, getConfig, setConfig } from "../integrations/on-use.mjs";
import { makeCollapsible } from "../common/sheet/collapse.mjs";

const TEMPLATE = `modules/${MODULE_ID}/src/apps/on-use-section.hbs`;
const SECTION_CLASS = "ce-ou-section";

const L = (key) => game.i18n.localize(`CRITICAL_EFFECTS.OnUse.${key}`);
const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0]);

function choices() {
  return {
    effects: { "": L("EffectNone"), healCheck: L("EffectHealCheck"), save: L("EffectSave") },
    saves: Object.fromEntries(SAVES.map((k) => [k, pf1.config.savingThrows[k] ?? k])),
    outcomes: { "": L("OutcomeNone"), end: L("OutcomeEnd"), replace: L("OutcomeReplace") },
  };
}

function badgeFor(cfg) {
  if (cfg.effect === "healCheck") return L("EffectHealCheck");
  if (cfg.effect === "save") return pf1.config.savingThrows[cfg.save] ?? cfg.save;
  return null;
}

async function injectSection(app, html) {
  const action = app.action;
  const item = app.item ?? action?.item;
  if (item?.type !== "buff" || !action?.id) return;

  const tab = rootOf(html)?.querySelector('.tab[data-tab="misc"]');
  if (!tab || tab.querySelector(`.${SECTION_CLASS}`)) return;

  const cfg = getConfig(item, action.id);
  const ref = cfg.replaceWith;
  const doc = ref?.uuid ? fromUuidSync(ref.uuid) : null;

  const rendered = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    cfg,
    ...choices(),
    isHealCheck: cfg.effect === "healCheck",
    isSave: cfg.effect === "save",
    needsReplacement: cfg.onSuccess === "replace" || cfg.onFailure === "replace",
    replaceWith: ref ? { uuid: ref.uuid, name: doc?.name ?? ref.name, img: doc?.img ?? null, missing: !!ref.uuid && !doc } : null,
  });
  if (tab.querySelector(`.${SECTION_CLASS}`)) return; // another render landed while awaiting

  const holder = document.createElement("div");
  holder.innerHTML = rendered;
  const section = holder.firstElementChild;
  tab.append(section);

  wire(item, action.id, section);

  makeCollapsible(app, section, {
    key: "on-use",
    marker: "ce-ou",
    configured: !!cfg.effect,
    badge: badgeFor(cfg),
    niche: true,
  });
}

function wire(item, actionId, section) {
  for (const input of section.querySelectorAll(".ce-ou-input")) {
    input.addEventListener("change", (event) => {
      // Unnamed fields: kept out of the action sheet's own submit.
      event.stopPropagation();
      const field = input.dataset.field;
      if (!field) return;
      setConfig(item, actionId, { [field]: input.value.trim() });
    });
  }

  section.querySelector(".ce-ou-replace-link")?.addEventListener("click", async (event) => {
    event.preventDefault();
    (await fromUuid(event.currentTarget.dataset.uuid))?.sheet?.render(true);
  });

  section.querySelector(".ce-ou-clear")?.addEventListener("click", (event) => {
    event.preventDefault();
    setConfig(item, actionId, { replaceWith: null });
  });

  const zone = section.querySelector("[data-ce-ou-drop]");
  zone?.addEventListener("dragover", (event) => event.preventDefault());
  zone?.addEventListener("drop", async (event) => {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") return;
    event.preventDefault();
    event.stopPropagation();
    const doc = await fromUuid(data.uuid);
    if (doc?.type !== "buff") {
      ui.notifications.warn(L("DropNotBuff"));
      return;
    }
    await setConfig(item, actionId, { replaceWith: { uuid: doc.uuid, name: doc.name } });
  });
}

export function registerOnUseSection() {
  const guard = (fn) => (...args) => fn(...args).catch((err) => console.error(`${MODULE_ID} | on-use section failed`, err));
  Hooks.on("renderItemActionSheet", guard(injectSection));
}
