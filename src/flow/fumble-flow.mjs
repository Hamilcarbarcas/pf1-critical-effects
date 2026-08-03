/* Fumble path, end to end (DESIGN.md §7.1).
 *
 *   1. pf1PreActionUse   — force a confirmation roll on a natural 1 (migrated from astora-mod's
 *                          critical-fumble.mjs). Synchronous, so Dice So Nice sees the die.
 *   2. pf1PostActionUse  — attach a "Resolve Fumble" button to the attack card.
 *   3. click             — GM picks the attack type (pre-selected from the weapon).
 *   4. draw              — a targeted 1d12 roll request carrying the table, which the PLAYER
 *                          clicks to roll. Posting it ends the GM's turn in the flow.
 *   5. result            — picked up from the rollComplete hook whenever that roll lands, then
 *                          appended to the original attack card, journal linked.
 *
 * Steps 4 and 5 are deliberately disconnected: the wait for a player's click is open-ended, so
 * the link between the two lives in a flag on the request card rather than in memory.
 *
 * Nothing here touches PF1's crit pipeline; that is phase 7.
 */

import { MODULE_ID } from "../const.mjs";
import * as catalog from "../catalog/catalog.mjs";
import { registerButtonType, addButtons, removeButton } from "../chat/card-buttons.mjs";
import { setFumbleResult } from "../chat/card-mutate.mjs";
import { postFumbleDraw, totalFromResult, DRAW_FLAG } from "../integrations/roll-requests.mjs";

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

    const baseFormula = standardConfirmFormula(chatAttack.attack);
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

/**
 * The attack's formula with its d20 forced back to a plain `1d20`, keeping every bonus term.
 *
 * PF1's attack dialog can replace the d20 with any formula — `20`, `2d20kh` — held in
 * `rollData.d20` and spliced in as the FIRST term of the attack roll (which is exactly what
 * `D20RollPF#d20` reads). Reusing the attack's formula verbatim would carry that override into
 * the confirmation, so an override bought with one roll would pay for two.
 *
 * Only the d20 slot is replaced; the size, ability, BAB and situational terms are kept as they
 * are, flavour and all, so the confirmation's breakdown still reads like the attack's.
 *
 * The mirror of this for critical confirmations is in integrations/pf1-pipeline.mjs — that one
 * has to be a libWrapper, since PF1 rolls those itself.
 */
export function standardConfirmFormula(attackRoll) {
  if (!attackRoll) return pf1.dice.D20RollPF.standardRoll;
  if (attackRoll.isNormal) return attackRoll.formula; // already a plain d20; nothing to strip

  const standard = new foundry.dice.terms.Die({ number: 1, faces: 20 });
  return pf1.dice.D20RollPF.getFormula([standard, ...attackRoll.terms.slice(1)]);
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

/* A natural 1 is the whole gate. The confirmation roll is rolled and displayed, but nothing
 * reads it: whether it "failed" is a judgement about the target's AC that the GM is better
 * placed to make than we are, and the button costs nothing when it goes unused. */
async function attachFumbleButton(actionUse, message) {
  if (!message) return; // hidden chat — nowhere to attach

  const item = actionUse.shared?.item ?? actionUse.item;
  const action = actionUse.shared?.action ?? actionUse.action;

  const fumbles = (actionUse.shared?.attacks ?? []).filter((atk) => atk.chatAttack?.attack?.isNat1);
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

// --- 4. post the draw -------------------------------------------------------

/* Posts the request and stops. The player rolls it in their own time, and `completeDraw` below
 * finishes the job off the rollComplete hook — so nothing here holds state across the wait. */
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

  const request = await postFumbleDraw({
    token,
    resultTable,
    tableKey: attackType,
    sourceMessageId: message.id,
    flavor: game.i18n.format("CRITICAL_EFFECTS.Fumble.DrawFlavor", {
      type: game.i18n.localize(`CRITICAL_EFFECTS.Fumble.Table.${attackType}`),
    }),
  });

  if (!request) {
    ui.notifications.warn(`${MODULE_ID}: could not post the fumble draw.`);
    return;
  }

  // The button has handed off; a second click would post a duplicate request.
  await removeButton(message, descriptor.id);
}

// --- 5. record the result ---------------------------------------------------

/* Fires on the GM's client for every roll on any request card, including rolls a player made
 * (roll-requests relays those to the GM to record). We claim only the cards we stamped. */
async function completeDraw({ messageId, result }) {
  if (!game.user.isGM) return;

  const request = game.messages.get(messageId);
  const draw = request?.getFlag(MODULE_ID, DRAW_FLAG);
  if (!draw) return; // not one of ours

  const source = game.messages.get(draw.sourceMessageId);
  if (!source) {
    console.error(`${MODULE_ID} | fumble draw resolved but its attack card ${draw.sourceMessageId} is gone`);
    return;
  }

  const total = totalFromResult(result);
  if (total == null) return;

  const entry = catalog.drawFumble(draw.tableKey, total);
  if (!entry) {
    ui.notifications.warn(`${MODULE_ID}: d12 rolled ${total}, which the "${draw.tableKey}" table does not cover.`);
    return;
  }

  await setFumbleResult(source, {
    tableKey: draw.tableKey,
    total,
    entryId: entry.id,
    name: entry.name,
    journal: entry.journal ?? null,
  });

  // Resolved — don't act on a re-roll of the same card.
  await request.unsetFlag(MODULE_ID, DRAW_FLAG);
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

  // Global rather than per-request, so a pending draw survives a GM reload.
  Hooks.on("pf1RollRequests.rollComplete", async (payload) => {
    try {
      await completeDraw(payload);
    } catch (err) {
      console.error(`${MODULE_ID} | recording the fumble draw failed:`, err);
    }
  });

  registerButtonType(BUTTON_TYPE, resolveFumble);
}
