/* Deferred critical confirmation (DESIGN.md §9.2).
 *
 * PF1 rolls the confirmation inline with the attack. With the setting on, the rolled confirmation
 * is discarded before anyone sees it and only its formula is kept; the card shows a Roll button in
 * the confirmation cell, and the click rolls it, runs the explosion chain, writes it into
 * `system.rolls`, and only then offers the GM's Critical Effect / Resolve Fumble button.
 */

import { MODULE_ID } from "../const.mjs";
import { gmRequest } from "../integrations/socket.mjs";
import { suppressionEnabled } from "../integrations/pf1-pipeline.mjs";
import { animateRolls, EXPLOSION_CAP } from "./explosion.mjs";
import { offerAttackButton } from "./attack-offer.mjs";
import { confirmAnchor, matchLittleHelper } from "../chat/inline-roll.mjs";

const SETTING = "deferCritConfirm";
const FLAG = "confirmations";
const EXPLOSION_FLAG = "explosions";
const EXPLOSION_ROLLS_FLAG = "explosionRolls";
const DSN_TARGET = "pf1.actionUse.ActionUse.prototype.handleDiceSoNice";

/** Set on a ChatAttack whose confirmation was taken back: `{ formula, critRange, fumble }`. */
const PENDING = Symbol(`${MODULE_ID}.pendingConfirm`);

/** `${messageId}:${index}` while a click is being handled, so a double click rolls once. */
const IN_FLIGHT = new Set();

/** message id -> tail of that card's confirmation writes (§9.2, "One write at a time"). */
const QUEUES = new Map();

export function registerConfirmSettings() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "Defer critical confirmation",
    hint:
      "Critical threats and natural 1s get a Roll button on the attack card instead of rolling " +
      "their confirmation at once. Shift-click toggles the roll dialog.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });
}

/** Off when PF1 confirms by armor as DR: there is no confirmation roll to defer. */
export function deferralEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING) === true && game.settings.get("pf1", "critConfirm") === true;
  } catch {
    return false;
  }
}

/** Whether this attack's confirmation is waiting for its button. */
export const isDeferred = (chatAttack) => !!chatAttack?.[PENDING];

// --- action time ------------------------------------------------------------

/* Runs on pf1PreActionUse after the fumble flow has forced its confirmation, and after every
 * addAttack wrapper (ckl-roll-bonuses' Snake Sidewind swaps the confirmation there), so the
 * formula kept is the one that would have been shown. */
function deferConfirmations(actionUse) {
  for (const chatAttack of actionUse?.shared?.chatAttacks ?? []) {
    if (chatAttack[PENDING]) continue;
    const confirm = chatAttack.critConfirm;
    if (!chatAttack.hasCritConfirm || !confirm || confirm.armorAsDR) continue;

    chatAttack[PENDING] = {
      formula: confirm.formula,
      critRange: confirm.options?.critical ?? actionUse.shared?.action?.critRange ?? 20,
      fumble: !!chatAttack.attack?.isNat1,
    };
    // hasCritConfirm stays true: it is what draws the critical column and the confirmation cell.
    chatAttack.critConfirm = null;
  }
}

/* PF1 pushes `critConfirm` into the DSN pool whenever hasCritConfirm is set, null or not.
 * Hidden for the duration of the throw; crit damage, if rolled, still animates. */
async function withoutPendingDice(wrapped, ...args) {
  const hidden = (this.shared?.chatAttacks ?? []).filter((ca) => ca[PENDING] && ca.hasCritConfirm);
  for (const ca of hidden) ca.hasCritConfirm = false;
  try {
    return await wrapped(...args);
  } finally {
    for (const ca of hidden) ca.hasCritConfirm = true;
  }
}

/* Indexed by position in `shared.chatAttacks`, which is the order PF1 writes
 * `system.rolls.attacks` in. Folded flags: see setChatFlag in astora-mod/scripts/chat-data.mjs. */
function recordOnCard(actionUse) {
  const chatData = actionUse?.shared?.chatData;
  if (!chatData) return;

  const records = {};
  for (const [index, chatAttack] of (actionUse.shared.chatAttacks ?? []).entries()) {
    if (chatAttack[PENDING]) records[index] = { ...chatAttack[PENDING] };
  }
  if (!Object.keys(records).length) return;

  for (const key of Object.keys(chatData)) {
    if (!key.startsWith("flags.")) continue;
    const dotted = chatData[key];
    delete chatData[key];
    foundry.utils.setProperty(chatData, key, dotted);
  }
  foundry.utils.setProperty(chatData, `flags.${MODULE_ID}.${FLAG}`, records);
}

// --- the card ---------------------------------------------------------------

const getRecords = (message) => message?.getFlag(MODULE_ID, FLAG) ?? null;

function cardActor(message) {
  const uuid = message?.system?.actor;
  return (uuid ? fromUuidSync(uuid) : null) ?? ChatMessage.getSpeakerActor(message?.speaker);
}

/** The attacker's owners and the GM; the same audience as an `ownerOf` card button. */
function canRoll(message) {
  if (game.user.isGM) return true;
  return !!cardActor(message)?.testUserPermission?.(game.user, "OWNER");
}

/* PF1's confirmation cell, or one made beside the attack roll when the card was posted without a
 * threat (a reroll made it one). The same split astora-mod's roll amendments draw. */
function confirmCell(attack) {
  const existing = attack.querySelector("tr.attack td.roll.critical");
  if (existing) return existing;

  const normal = attack.querySelector("tr.attack td.roll.normal");
  if (!normal) return null;
  normal.colSpan = 2;
  const cell = document.createElement("td");
  cell.colSpan = 2;
  cell.className = "roll critical ce-confirm-made";
  normal.after(cell);
  return cell;
}

/** A made cell has no header above it, so it carries its own label. */
function fill(cell, content) {
  if (!cell.classList.contains("ce-confirm-made")) return cell.replaceChildren(content);
  const label = document.createElement("span");
  label.className = "ce-confirm-label";
  label.textContent = "Confirm";
  cell.replaceChildren(label, " ", content);
}

function decorateConfirmations(message, root) {
  const records = getRecords(message);
  if (!records) return;

  const label = game.i18n.localize("PF1.CriticalConfirmation");

  for (const [index, record] of Object.entries(records)) {
    if (!record) continue;
    const attack = root.querySelector(`.chat-attack[data-index="${index}"]`);
    const cell = attack ? confirmCell(attack) : null;
    if (!cell || cell.dataset.ceConfirm) continue;
    cell.dataset.ceConfirm = "1";

    // Empty at template time: PF1 renders `{{atk.critConfirm.flavor}}` off a null confirmation.
    const header = attack.querySelector("th.attack-flavor.crit-confirm");
    if (header && !header.textContent.trim()) header.textContent = label;

    if (record.rolled) {
      const roll = message.systemRolls?.attacks?.[index]?.critConfirm;
      if (roll instanceof Roll) fill(cell, matchLittleHelper(confirmAnchor(roll), roll, attack));
      continue;
    }

    if (!canRoll(message)) {
      const waiting = document.createElement("span");
      waiting.className = "ce-confirm-waiting";
      waiting.textContent = "Pending";
      fill(cell, waiting);
      continue;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ce-confirm-btn";
    btn.dataset.tooltip = "Shift-click: toggle the roll dialog";
    btn.append(
      Object.assign(document.createElement("i"), { className: "fa-solid fa-dice-d20" }),
      document.createTextNode(" Roll")
    );
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      rollConfirmation(message, Number(index), { event }).catch((err) => {
        console.error(`${MODULE_ID} | rolling the confirmation failed:`, err);
        ui.notifications.error(`${MODULE_ID}: the confirmation roll failed – see the console.`);
      });
    });
    fill(cell, btn);
  }
}

// --- the click --------------------------------------------------------------

/** PF1's skip-dialog setting, inverted by Shift. */
function skipDialog(event) {
  const skip = game.settings.get("pf1", "skipActionDialogs") === true;
  return event?.shiftKey ? !skip : skip;
}

const isStandardD20 = (term) =>
  term instanceof foundry.dice.terms.Die && term.number === 1 && term.faces === 20 && !term.modifiers?.length;

/**
 * A confirmation from the kept formula, carrying earlier settings so a prompt opens prefilled
 * (§9.2, "Explosions").
 * @param {object} settings  `{ d20, bonus, staticRoll }` from {@link settingsOf}
 */
function buildRoll(record, rollData, { d20 = null, bonus = "", staticRoll = null } = {}) {
  const D20 = pf1.dice.D20RollPF;
  const roll = new D20(record.formula, rollData, {
    critical: record.critRange,
    flavor: game.i18n.localize("PF1.CriticalConfirmation"),
    bonus,
    staticRoll,
  });
  if (d20) {
    const dice = D20.parse(d20, rollData);
    if (dice[0] instanceof foundry.dice.terms.Die) {
      roll.terms = [...dice, ...roll.terms.slice(1)];
      roll._formula = D20.getFormula(roll.terms);
    }
  }
  return roll;
}

/** What the next prompt should default to. Read before the bonus is folded into the terms. */
function settingsOf(roll) {
  const head = roll.d20;
  return {
    bonus: roll.options.bonus || "",
    staticRoll: Number.isFinite(roll.options.staticRoll) ? roll.options.staticRoll : null,
    d20: head && !isStandardD20(head) ? head.formula : null,
  };
}

/* Only the Normal button: Take 10 / Take 20 are not allowed on an attack roll. The roll mode select
 * is dropped because the result lands on the attack card and takes that card's visibility. */
async function prompt(roll, message, record, title) {
  const speaker = message.speaker;
  const alias = speaker?.alias ?? cardActor(message)?.name;

  // A prefilled d20 override the user clears falls back to the kept formula's own die.
  const head = new pf1.dice.D20RollPF(record.formula, roll.data).terms[0];

  const result = await roll.promptDialog({
    title: alias ? `${alias}: ${title}` : title,
    speaker,
    dialogOptions: {
      buttons: [{
        action: "normal",
        default: true,
        icon: "fa-solid fa-dice-d20",
        label: game.i18n.localize("PF1.Roll"),
        callback: (_event, _button, dialog) => {
          roll.terms = [head, ...roll.terms.slice(1)];
          return roll._onDialogSubmit(dialog, null);
        },
      }],
      render: (_event, dialog) => {
        dialog.element?.querySelector('[name="rollMode"]')?.closest(".form-group")?.remove();
      },
    },
  });
  if (result === null || result === undefined) return null;
  delete roll.options.rollMode;
  return roll;
}

/**
 * One confirmation: optional prompt, evaluate, animate.
 * @returns {Promise<{ roll: Roll, settings: object }|null>} null when the prompt was cancelled
 */
async function rollOnce(message, record, rollData, { settings, skip, title, visibility }) {
  let roll = buildRoll(record, rollData, settings);
  if (!skip) {
    roll = await prompt(roll, message, record, title);
    if (!roll) return null;
  }

  const next = settingsOf(roll);
  if (next.bonus) {
    roll.addBonus(next.bonus);
    delete roll.options.bonus;
  }
  await roll.evaluate();
  await animateRolls([roll], visibility);
  return { roll, settings: next };
}

/**
 * Roll a deferred confirmation from its card, then its explosions, each with its own prompt.
 *
 * @param {ChatMessage} message  the attack card
 * @param {number} index         the attack on that card
 * @param {object} [opts]
 * @param {Event} [opts.event]   the click; Shift toggles the dialog
 * @param {boolean} [opts.skipDialog]  overrides the setting and the event
 * @returns {Promise<Roll|null>} the confirmation; null when cancelled or already rolled
 */
export async function rollConfirmation(message, index, { event = null, skipDialog: skip = null } = {}) {
  const key = `${message?.id}:${index}`;
  if (!message || IN_FLIGHT.has(key)) return null;

  const record = getRecords(message)?.[index];
  if (!record || record.rolled) return null;

  IN_FLIGHT.add(key);
  try {
    const rollData = cardActor(message)?.getRollData?.() ?? {};
    const flavor = game.i18n.localize("PF1.CriticalConfirmation");
    const visibility = { whisper: message.whisper?.length ? message.whisper : null, blind: message.blind };
    const opts = { skip: skip ?? skipDialog(event), visibility };

    const first = await rollOnce(message, record, rollData, { ...opts, settings: {}, title: flavor });
    if (!first) return null;

    // §9.2, "Explosions": count = confirmations that threatened. A cancelled prompt ends the chain.
    let explosions = 0;
    const chain = [];
    if (!record.fumble && suppressionEnabled()) {
      let last = first;
      while (last?.roll.isCrit && explosions < EXPLOSION_CAP) {
        explosions++;
        last = await rollOnce(message, record, rollData, {
          ...opts,
          settings: last.settings,
          title: `${flavor} (Explosion ${explosions})`,
        });
        if (last) chain.push(last.roll);
      }
      if (explosions >= EXPLOSION_CAP) {
        ui.notifications.warn(`${MODULE_ID}: the confirmation explosion hit its ${EXPLOSION_CAP}-iteration cap.`);
      }
    }

    await store(message, index, first.roll, explosions, chain);
    await offerAttackButton(message, { kind: record.fumble ? "fumble" : "crit", attackIndex: index });
    return first.roll;
  } finally {
    IN_FLIGHT.delete(key);
  }
}

function enqueue(message, mutate) {
  const prev = QUEUES.get(message.id) ?? Promise.resolve();
  const next = prev.then(mutate, mutate);
  QUEUES.set(message.id, next);
  next.finally(() => {
    if (QUEUES.get(message.id) === next) QUEUES.delete(message.id);
  }).catch(() => {});
  return next;
}

async function write(message, updates) {
  if (message.isOwner) await message.update(updates);
  else await gmRequest("updateDocument", { uuid: message.uuid, updates });
}

/* JSON round trip rather than deepClone: see storeCritDamage in pf1-pipeline.mjs. */
function store(message, index, roll, explosions, chain) {
  return enqueue(message, async () => {
    const rolls = JSON.parse(JSON.stringify(message.toObject().system?.rolls ?? {}));
    const attack = rolls.attacks?.[index];
    if (!attack) {
      console.error(`${MODULE_ID} | no attack ${index} on ${message.id} to store the confirmation on`);
      return;
    }
    attack.critConfirm = roll.toJSON();

    const updates = {
      "system.rolls": rolls,
      [`flags.${MODULE_ID}.${FLAG}.${index}.rolled`]: true,
    };
    if (explosions) updates[`flags.${MODULE_ID}.${EXPLOSION_FLAG}.${index}`] = explosions;
    if (chain.length) updates[`flags.${MODULE_ID}.${EXPLOSION_ROLLS_FLAG}.${index}`] = chain.map((r) => r.toJSON());
    await write(message, updates);
  });
}

/**
 * Put a Roll button on an attack whose threat or natural 1 appeared after the card posted (a
 * reroll through astora-mod's roll amendments). Replaces any earlier confirmation at that index,
 * rolled or not: a threat that lapsed and came back confirms afresh (§9.2, "Rerolled attacks").
 *
 * @param {ChatMessage} message
 * @param {number} index
 * @param {object} record
 * @param {string} record.formula   the confirmation formula, plain d20 first
 * @param {number} record.critRange
 * @param {boolean} [record.fumble] a natural 1's confirmation: no explosions, offers Resolve Fumble
 * @returns {Promise<boolean>} false when deferral is off and the caller should roll it itself
 */
export async function deferConfirmation(message, index, { formula, critRange, fumble = false } = {}) {
  if (!message || !formula || !deferralEnabled()) return false;
  await enqueue(message, () => write(message, {
    [`flags.${MODULE_ID}.${FLAG}.${index}`]: {
      formula,
      critRange: Number(critRange) || 20,
      fumble: !!fumble,
      rolled: false,
      reroll: true,
    },
    [`flags.${MODULE_ID}.${EXPLOSION_FLAG}.-=${index}`]: null,
    [`flags.${MODULE_ID}.${EXPLOSION_ROLLS_FLAG}.-=${index}`]: null,
  }));
  return true;
}

/**
 * Take back a confirmation when its attack no longer threatens or fumbles (a reroll through
 * astora-mod's roll amendments, via `attacks.withdraw`). An unrolled one always goes. A rolled
 * one goes only if a reroll made it; the card's own stays, for roll amendments to strike.
 */
export function dropPendingConfirmation(message, index, { fumble } = {}) {
  const record = getRecords(message)?.[index];
  if (!record || (record.rolled && !record.reroll)) return;
  if (fumble !== undefined && !!record.fumble !== fumble) return;
  const updates = { [`flags.${MODULE_ID}.${FLAG}.-=${index}`]: null };
  if (record.rolled) {
    updates[`flags.${MODULE_ID}.${EXPLOSION_FLAG}.-=${index}`] = null;
    updates[`flags.${MODULE_ID}.${EXPLOSION_ROLLS_FLAG}.-=${index}`] = null;
  }
  return enqueue(message, () => write(message, updates));
}

// --- registration -----------------------------------------------------------

/* Must be called after registerFumbleFlow: both listen on pf1PreActionUse, and the forced fumble
 * confirmation has to exist before it can be deferred. */
export function registerConfirmDeferral() {
  Hooks.on("pf1PreActionUse", (actionUse) => {
    if (!deferralEnabled()) return;
    try {
      deferConfirmations(actionUse);
    } catch (err) {
      console.error(`${MODULE_ID} | deferring the confirmation failed:`, err);
    }
  });

  Hooks.on("pf1PreDisplayActionUse", (actionUse) => {
    try {
      recordOnCard(actionUse);
    } catch (err) {
      console.error(`${MODULE_ID} | recording the deferred confirmation failed:`, err);
    }
  });

  if (typeof libWrapper === "undefined") {
    console.error(`${MODULE_ID} | lib-wrapper is not available; deferred confirmations would animate a null roll`);
  } else {
    libWrapper.register(MODULE_ID, DSN_TARGET, withoutPendingDice, "WRAPPER");
  }

  // Unconditional: cards posted while the setting was on keep their buttons after it goes off.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    try {
      decorateConfirmations(message, root);
    } catch (err) {
      console.error(`${MODULE_ID} | drawing the deferred confirmation failed:`, err);
    }
  });
}
