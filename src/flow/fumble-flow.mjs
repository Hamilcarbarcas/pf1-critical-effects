/* Fumble path, end to end (DESIGN.md §7.1).
 *
 *   1. pf1PreActionUse   — force a confirmation roll on a natural 1 (migrated from astora-mod's
 *                          critical-fumble.mjs). Synchronous, so Dice So Nice sees the die.
 *   2. pf1PostActionUse  — attach a "Resolve Fumble" button to the attack card.
 *   3. click             — GM picks the attack type (pre-selected from the weapon).
 *   4. draw              — a targeted 1d12 roll request carrying the table, so the player sees
 *                          the whole table with their row highlighted.
 *   5. result            — appended to the original attack card, journal linked.
 *
 * Nothing here touches PF1's crit pipeline; that is phase 7.
 */

import { MODULE_ID } from "../const.mjs";
import * as catalog from "../catalog/catalog.mjs";
import { registerButtonType, addButtons, removeButton } from "../chat/card-buttons.mjs";
import { setFumbleResult } from "../chat/card-mutate.mjs";
import { requestFumbleDraw } from "../integrations/roll-requests.mjs";

const BUTTON_TYPE = "resolve-fumble";

// --- 1. forced confirmation on a natural 1 ----------------------------------

/* Migrated verbatim in behaviour from astora-mod/scripts/critical-fumble.mjs. It must stay
 * synchronous: PF1 hands the roll pool to Dice So Nice later in the same pass, and an async
 * hook would miss that window, so the die would never animate. */
function forceFumbleConfirmation(actionUse) {
  for (const [idx, atk] of (actionUse.shared.attacks ?? []).entries()) {
    const chatAttack = atk.chatAttack;
    if (!chatAttack?.attack?.isNat1) continue;

    const rollData = chatAttack.rollData;
    const confirmParts = [];

    if (rollData.critConfirmBonus !== 0) {
      confirmParts.push(`@critConfirmBonus[${game.i18n.localize("PF1.CriticalConfirmation")}]`);
    }
    const ccKeys = pf1.documents.actor.changes.getChangeFlat.call(chatAttack.actor, "critConfirm");
    for (const ccKey of ccKeys) {
      chatAttack.actor?.sourceDetails[ccKey]?.forEach((c) => confirmParts.push(`(${c.value})[${c.name}]`));
    }
    const conditionalParts = actionUse._getConditionalParts(atk, { index: idx });
    if (conditionalParts["attack.crit"]?.length) confirmParts.push(...conditionalParts["attack.crit"]);

    const baseFormula = chatAttack.attack.formula;
    const formula = confirmParts.length ? `${baseFormula}+${confirmParts.join("+")}` : baseFormula;

    const roll = new pf1.dice.D20RollPF(formula, rollData, {
      critical: actionUse.shared.action.critRange,
    });
    roll.evaluate({ async: false });
    roll.options.flavor = game.i18n.localize("PF1.CriticalConfirmation");

    chatAttack.critConfirm = roll;
    chatAttack.hasCritConfirm = true;
  }
}

// --- 2. attach the button ---------------------------------------------------

/**
 * Which fumble table this action draws from.
 *
 * Natural attacks are their own item subtype. Everything else keys off the action's attack type:
 * a ranged weapon in the bow/crossbow groups draws from `bow`, any other ranged attack from
 * `thrown`, and melee from `melee`.
 */
export function inferAttackType(item, action) {
  if (item?.type === "attack" && item.system?.subType === "natural") return "natural";

  const actionType = action?.data?.actionType ?? action?.actionType;
  const isRanged = actionType === "rwak" || actionType === "rsak";
  if (!isRanged) return "melee";

  const groups = item?.system?.weaponGroups?.value ?? item?.system?.weaponGroups?.base ?? [];
  const list = Array.isArray(groups) ? groups : Object.keys(groups ?? {});
  if (list.includes("bows") || list.includes("crossbows")) return "bow";
  return "thrown";
}

/**
 * Did the confirmation roll fail?
 *
 * Only answerable when there is exactly one target whose AC we can read. With several targets,
 * or none, the answer is `null` — unknown — and the button is surfaced anyway for the GM to
 * adjudicate. Same posture as the lethal-draw gate (§7.4): surface, never enforce.
 *
 * @returns {boolean|null}
 */
function confirmFailed(actionUse, chatAttack) {
  const total = chatAttack?.critConfirm?.total;
  if (typeof total !== "number") return null;

  const targets = actionUse.shared?.targets ?? [];
  if (targets.length !== 1) return null;

  const ac = targets[0]?.actor?.system?.attributes?.ac?.normal?.total;
  if (typeof ac !== "number") return null;

  return total < ac;
}

async function attachFumbleButton(actionUse, message) {
  if (!message) return; // hidden chat — nowhere to attach

  const item = actionUse.shared?.item ?? actionUse.item;
  const action = actionUse.shared?.action ?? actionUse.action;

  const fumbles = [];
  for (const atk of actionUse.shared?.attacks ?? []) {
    const chatAttack = atk.chatAttack;
    if (!chatAttack?.attack?.isNat1) continue;
    // A confirmation that beat the target's AC is a miss, not a fumble.
    if (confirmFailed(actionUse, chatAttack) === false) continue;
    fumbles.push(chatAttack);
  }

  if (!fumbles.length) return;

  await addButtons(message, [{
    type: BUTTON_TYPE,
    label: game.i18n.localize("CRITICAL_EFFECTS.Fumble.ResolveButton"),
    icon: "fa-solid fa-face-dizzy",
    gmOnly: true,
    data: {
      attackType: inferAttackType(item, action),
      tokenId: actionUse.shared?.token?.id ?? message.speaker?.token ?? null,
      count: fumbles.length,
    },
  }]);
}

// --- 3. the dialog ----------------------------------------------------------

async function promptAttackType(preselected) {
  const keys = catalog.fumbleTableKeys();
  if (!keys.length) {
    ui.notifications.error(`${MODULE_ID}: no fumble tables are loaded.`);
    return null;
  }

  const options = keys.map((key) => {
    const label = game.i18n.localize(`CRITICAL_EFFECTS.Fumble.Table.${key}`);
    const selected = key === preselected ? " selected" : "";
    return `<option value="${key}"${selected}>${label}</option>`;
  }).join("");

  const content = `
    <div class="ce-dialog">
      <p>${game.i18n.localize("CRITICAL_EFFECTS.Fumble.PickTable")}</p>
      <select name="attackType" class="ce-table-select">${options}</select>
    </div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("CRITICAL_EFFECTS.Fumble.DialogTitle") },
    content,
    ok: {
      label: game.i18n.localize("CRITICAL_EFFECTS.Fumble.Draw"),
      callback: (_event, button) => button.form.elements.attackType.value,
    },
    rejectClose: false,
  });
}

// --- 4 + 5. draw and record -------------------------------------------------

async function resolveFumble(descriptor, { message }) {
  const attackType = await promptAttackType(descriptor.data?.attackType);
  if (!attackType) return; // cancelled

  const resultTable = catalog.fumbleResultTable(attackType);
  if (!resultTable) {
    ui.notifications.error(`${MODULE_ID}: no "${attackType}" fumble table.`);
    return;
  }

  const token = resolveToken(descriptor, message);
  if (!token) {
    ui.notifications.warn(`${MODULE_ID}: could not find the fumbling token; the draw needs one to target.`);
    return;
  }

  const { total } = await requestFumbleDraw({
    token,
    resultTable,
    flavor: game.i18n.format("CRITICAL_EFFECTS.Fumble.DrawFlavor", {
      type: game.i18n.localize(`CRITICAL_EFFECTS.Fumble.Table.${attackType}`),
    }),
  });

  if (total == null) {
    ui.notifications.warn(`${MODULE_ID}: the fumble draw produced no result.`);
    return;
  }

  const entry = catalog.drawFumble(attackType, total);
  if (!entry) {
    ui.notifications.warn(`${MODULE_ID}: d12 rolled ${total}, which the "${attackType}" table does not cover.`);
    return;
  }

  await setFumbleResult(message, {
    tableKey: attackType,
    total,
    entryId: entry.id,
    name: entry.name,
    journal: entry.journal ?? null,
  });

  // The fumble is resolved; the button has done its job.
  await removeButton(message, descriptor.id);
}

function resolveToken(descriptor, message) {
  const id = descriptor.data?.tokenId ?? message.speaker?.token;
  if (id) {
    const doc = canvas.scene?.tokens?.get(id);
    if (doc) return doc;
  }
  // Fall back to the speaker's actor, so a resolution still works off-scene.
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  return actor?.getActiveTokens(false, true)?.[0] ?? null;
}

// --- registration -----------------------------------------------------------

export function registerFumbleFlow() {
  Hooks.on("pf1PreActionUse", (actionUse) => {
    try {
      forceFumbleConfirmation(actionUse);
    } catch (err) {
      console.error(`${MODULE_ID} | fumble confirmation failed:`, err);
    }
  });

  Hooks.on("pf1PostActionUse", async (actionUse, message) => {
    try {
      await attachFumbleButton(actionUse, message);
    } catch (err) {
      console.error(`${MODULE_ID} | attaching the fumble button failed:`, err);
    }
  });

  registerButtonType(BUTTON_TYPE, resolveFumble);
}
