/* Suppressing and re-injecting PF1's critical damage (DESIGN.md §9) — the risky part.
 *
 * Concept §9 wants the crit-damage / crit-effect pairing broken: the card shows base damage and a
 * threat, and crit damage is rolled *later*, only if chosen. PF1 does not leave room for that —
 * `ChatAttack.addDamage({ critical: true })` runs inline while the card is still being built.
 *
 * ── Why suppression rather than hiding ──────────────────────────────────────
 * The cheaper option was to let PF1 roll crit damage and hide only its display. Dice So Nice
 * kills that: PF1 builds one PoolTerm containing the crit confirmation AND the crit damage rolls
 * and hands the whole thing to `game.dice3d.showForRoll` (action-use.mjs ~958). Crit damage dice
 * would physically tumble across every player's screen before anyone chose anything.
 *
 * ── Why this is safe ────────────────────────────────────────────────────────
 * Skipping the call leaves `chatAttack.critDamage.rolls` empty, and every consumer of it in the
 * system is already guarded by a length check:
 *   - action-use.mjs:961   critPool.rolls.push(...(atk.critDamage?.rolls ?? []))
 *   - action-use.mjs:1413  if (chatAttack.critDamage.rolls.length)
 *   - action-message.mjs:82 if (!atk.critDamage?.length) delete atk.critDamage
 *   - chat-attack.mjs finalize() builds damageRows from max(damage, critDamage) lengths
 * The confirmation still rolls, still animates and still shows on the card: `critPool` remains
 * non-empty because `critConfirm` is pushed into it first, so the `if (critPool.rolls.length)`
 * guard still passes and only the crit-damage dice are gone.
 *
 * ── Why MIXED ───────────────────────────────────────────────────────────────
 * Never OVERRIDE — ckl-roll-bonuses already OVERRIDEs `handleConditionals` in this neighbourhood,
 * and manual prototype patches get bypassed by it. But not WRAPPER either: WRAPPER is a contract
 * that the wrapper *always* chains, and libWrapper unregisters one that doesn't. Suppression is
 * precisely a decision not to chain, so MIXED is the honest type — it still sorts ahead of any
 * OVERRIDE, and it is allowed to stop the chain.
 */

import { MODULE_ID } from "../const.mjs";

const SETTING = "suppressCritDamage";
const TARGET = "pf1.actionUse.ChatAttack.prototype.addDamage";
const ATTACK_TARGET = "pf1.actionUse.ChatAttack.prototype.addAttack";

export const suppressionEnabled = () => {
  try {
    return game.settings.get(MODULE_ID, SETTING) === true;
  } catch {
    return false; // setting not registered yet
  }
};

export function registerPipelineSettings() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "Defer critical damage",
    hint:
      "Don't roll critical damage with the attack. The confirmation still rolls and shows; " +
      "critical damage is rolled later, only if it is chosen over a critical effect. " +
      "Turn off to restore PF1's normal behaviour.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
  });
}

export function registerPipeline() {
  if (typeof libWrapper === "undefined") {
    console.error(`${MODULE_ID} | lib-wrapper is not available; critical damage cannot be deferred`);
    return;
  }

  libWrapper.register(
    MODULE_ID,
    TARGET,
    function (wrapped, options = {}) {
      // Only the critical pass is skipped. Base damage is untouched.
      if (options?.critical === true && suppressionEnabled()) return;
      return wrapped(options);
    },
    "MIXED"
  );

  registerConfirmationOverride();
}

/* --- the d20 override does not carry into a confirmation --------------------
 *
 * PF1's attack dialog lets you replace the d20 with any formula — `20` for an auto-hit, `2d20kh`
 * for a re-roll effect — stored as `rollData.d20` and spliced in at
 * `action.mjs` (`[rollData.d20 || D20RollPF.standardRoll, ...parts]`). The critical confirmation
 * is rolled through the same path with the same rollData, so it inherits the override: a `20`
 * override confirms every critical automatically, and `2d20kh` confirms with advantage.
 *
 * House rule: an override buys you the attack it was spent on, not a free confirmation as well.
 * The confirmation is its own roll and gets a plain d20. This matches the fumble path, which
 * builds its forced confirmation the same way (fumble-flow.mjs).
 *
 * WRAPPER, not MIXED — this one always chains; it only edits the data on the way through. That
 * matters because ckl-roll-bonuses also registers a WRAPPER on this exact method, and both are
 * expected to run.
 */
export async function withoutD20Override(wrapped, options = {}) {
  if (options?.critical !== true) return wrapped(options);

  const override = this.rollData?.d20;
  if (!override) return wrapped(options);

  // Restored in a `finally`: the same rollData drives the remaining attacks of a full attack,
  // which should each still get the override on their own attack roll — and a throw inside the
  // wrapped call must not leave the override stripped for the rest of the sequence.
  this.rollData.d20 = "";
  try {
    return await wrapped(options);
  } finally {
    this.rollData.d20 = override;
  }
}

function registerConfirmationOverride() {
  libWrapper.register(MODULE_ID, ATTACK_TARGET, withoutD20Override, "WRAPPER");
}

// --- re-injection -----------------------------------------------------------

/**
 * Roll the critical damage that was deferred, now that it has been chosen.
 *
 * Rolled fresh rather than reconstructed from a stored roll, and animated through the same DSN
 * API PF1 uses — so the dice land at the moment they are actually determined, which is better
 * theatre than the current behaviour anyway.
 *
 * The rolls are then written into `message.system.rolls.attacks[i].critDamage`, in the same
 * serialised form PF1 stores its own (`generateChatMetadata`, action-use.mjs ~1413). That is not
 * bookkeeping — it is what makes the card's own Apply button work. PF1's handler
 * (utils/chat.mjs ~448) rebuilds damage *instances* from those stored rolls to compute DR and
 * energy resistance per damage type; a total painted into the DOM would apply as an untyped lump.
 *
 * @param {ChatMessage} message  the attack card
 * @param {object} [opts]
 * @param {number} [opts.attackIndex]  which attack on the card crit
 * @returns {Promise<{ total: number, formula: string, rolls: object[] }|null>}
 */
export async function rollDeferredCritDamage(message, { attackIndex = 0 } = {}) {
  const context = resolveAction(message);
  if (!context) {
    ui.notifications.warn(`${MODULE_ID}: could not find the action behind this card to roll critical damage.`);
    return null;
  }

  const { action, item, critMult } = context;

  // PF1 rolls the critical pass (critMult - 1) times, incrementing critCount each pass; the
  // multiplier is "the normal hit plus this many extra instances", not a multiplication.
  const rollData = action.getRollData?.() ?? item.getRollData?.() ?? {};
  rollData.critCount = 0;

  const rolls = [];
  const repeats = Math.max(1, (Number(critMult) || 2) - 1);

  for (let i = 0; i < repeats; i++) {
    rollData.critCount++;
    rolls.push(...(await action.rollDamage({ data: rollData, critical: true })));
  }

  if (!rolls.length) return null;

  if (game.dice3d) {
    const pool = new foundry.dice.terms.PoolTerm();
    pool.rolls.push(...rolls);
    await game.dice3d.showForRoll(pool, game.user, true);
  }

  const serialised = rolls.map((r) => r.toJSON());
  await storeCritDamage(message, attackIndex, serialised);

  return {
    // PF1's critical column is the WHOLE critical total — the base damage plus the extra passes,
    // not the extra passes alone (chat-attack.mjs ~248). Reporting the same number here keeps the
    // dialog and the card from quoting two different figures for one hit.
    total: criticalTotal(message, attackIndex),
    extra: rolls.reduce((sum, r) => sum + (r.total ?? 0), 0),
    formula: rolls.map((r) => r.formula).join(" + "),
    rolls: serialised,
  };
}

/**
 * The full critical damage for an attack, composed the way PF1 composes it.
 *
 * Read back off the message rather than from the rolls in hand, so this is the same computation
 * whether it runs right after the roll or at render time on another client.
 */
export function criticalTotal(message, attackIndex = 0) {
  const attack = message?.systemRolls?.attacks?.[attackIndex];
  if (!attack?.critDamage?.length) return null;

  const sum = (list) => (list ?? []).reduce((total, roll) => total + (roll?.total ?? 0), 0);
  const total = sum(attack.damage) + sum(attack.critDamage);

  // PF1's minimum damage rule: a hit never lands for less than 1.
  return Math.max(1, total);
}

/**
 * Put the rolled crit damage where PF1 would have put it.
 *
 * `system.rolls` is a plain ObjectField holding an array, so the whole `rolls` object is read,
 * mutated and written back — a dotted path into an array index is not something Foundry's update
 * semantics handle predictably.
 */
async function storeCritDamage(message, attackIndex, serialised) {
  /* Round-tripped through JSON rather than `deepClone`d, deliberately. PF1's `_initRollObject`
   * walks `system.rolls` at prepare time and replaces every serialised roll with a live `Roll`
   * **in place** (chat-message.mjs:58-77), and `deepClone` passes class instances through by
   * reference — so a plain clone would write live Rolls back into the field. JSON forces each one
   * through its own `toJSON()`, which is precisely the stored form PF1 wrote in the first place. */
  const rolls = JSON.parse(JSON.stringify(message.toObject().system?.rolls ?? {}));
  rolls.attacks ??= [];

  const attack = rolls.attacks[attackIndex];
  if (!attack) {
    // The index came from the attack that threatened; if it is gone the card has been rewritten
    // underneath us, and guessing which attack to credit would be worse than not crediting one.
    console.error(`${MODULE_ID} | no attack ${attackIndex} on ${message.id} to store critical damage on`);
    return;
  }

  attack.critDamage = serialised;
  await message.update({ "system.rolls": rolls });
}

/** Walk a chat card back to the live action that produced it. */
function resolveAction(message) {
  const actorUuid = message?.system?.actor;
  const actor = (actorUuid ? fromUuidSync(actorUuid) : null) ?? ChatMessage.getSpeakerActor(message?.speaker);
  if (!actor) return null;

  const item = actor.items?.get(message?.system?.item?.id);
  if (!item) return null;

  const action = item.actions?.get(message?.system?.action?.id) ?? item.defaultAction;
  if (!action) return null;

  const critMult = message?.system?.config?.critMult ?? action.data?.ability?.critMult ?? 2;
  return { actor, item, action, critMult };
}
