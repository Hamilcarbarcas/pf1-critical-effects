/* The crit resolution stage list, as data (DESIGN.md §7.2).
 *
 * Pure and synchronous — no dialog, no world. Building the sequence as data rather than as
 * control flow is what lets a stage be skipped without any downstream code knowing: `applies()`
 * decides, and the walk in `nextStage` does the rest.
 *
 * Four stages, and the shape is deliberately flat:
 *
 *   trigger   the only branch point — damage alone ends the resolution here; skipped entirely
 *             when the caller has already made the choice
 *   location  the target: creature type and damage type, and — for the three weapon damage types —
 *             which body part, rolled or chosen by the player
 *   power     the die pool, its modifiers, and the roll that indexes the effect table
 *   result    the drawn row, adjustable by the GM, committed to the attack card
 *
 * The confirmation explosion is NOT a stage. It happens with the attack roll itself
 * (flow/explosion.mjs), because it is a property of the dice that were already thrown rather
 * than a decision anyone makes.
 *
 * ── Why `location` survives a damage type with no location ──────────────────
 *
 * A non-localized damage type (fire, cold, acid, …) rolls no hit location, but the stage that
 * would have rolled one is also the only place the creature type and the damage type are settled —
 * and the effect tables are keyed by both. So the stage stays and *narrows*: it presents itself as
 * "Target", drops the limb layout and the two location buttons, and offers Continue instead. That
 * is why `label` and `hint` may be functions of state; the alternative was moving the damage-type
 * select somewhere the standalone resolver (which skips Trigger entirely) could not reach it.
 */

import { isLocalized } from "../catalog/schema.mjs";

/** @typedef {"trigger"|"location"|"power"|"result"} StageKey */

/** A stage's `label`/`hint` may be a plain string or a function of the resolution state. */
const resolveField = (field, state) => (typeof field === "function" ? field(state) : field);

export const STAGES = [
  {
    key: "trigger",
    label: "Trigger",
    hint: "Critical damage, a critical effect, or both?",
    /* A resolution opened with its choice already made never sees this stage — not even as a
     * completed step on the rail, because it was never a question. That is the standalone
     * resolver: no attack card behind it means no suppressed critical damage to release, so two
     * of the three answers here are unavailable rather than merely unchosen. */
    applies: (state) => !state?.choiceLocked,
  },
  {
    key: "location",
    label: (state) => (isLocalized(state?.damageType) ? "Location" : "Target"),
    hint: (state) => {
      if (!state?.damageType) return "Check the creature type and pick the damage type — the effect tables are keyed by both.";
      return isLocalized(state.damageType)
        ? "Check the creature type, then have the player roll the hit location or pick one."
        : "Check the creature type and the damage type. This damage doesn't land in one place, so there is no location to roll.";
    },
    // Damage alone never reaches here: it ends at the trigger.
    applies: (state) => state?.choice === "effect" || state?.choice === "both",
  },
  {
    key: "power",
    label: "Power",
    hint: "Adjust the grade and modifier if you need to, then ask for the roll.",
    applies: (state) => state?.choice === "effect" || state?.choice === "both",
  },
  {
    key: "result",
    label: "Result",
    hint: "The row the power roll landed on. Change it if you need to, then confirm.",
    applies: (state) => state?.choice === "effect" || state?.choice === "both",
  },
];

/**
 * The stages that apply to a given resolution, with `label` and `hint` already resolved against
 * the state — a caller gets strings, whether the stage declared strings or functions.
 *
 * @param {object} opts
 * @param {object} opts.state  the resolution's current state, for conditional stages
 * @returns {object[]}
 */
export function stagesFor({ state = {} } = {}) {
  return STAGES.filter((stage) => typeof stage.applies !== "function" || stage.applies(state)).map((stage) => ({
    ...stage,
    label: resolveField(stage.label, state),
    hint: resolveField(stage.hint, state),
  }));
}

/** Look up a stage by key, regardless of whether it currently applies. Unresolved: see stagesFor. */
export const getStage = (key) => STAGES.find((s) => s.key === key) ?? null;

/**
 * The stage after `current`, skipping any that don't apply.
 *
 * Returns `null` at the end of the sequence. An unknown `current` starts from the beginning, so a
 * resolution resumed from an odd state walks forward rather than dead-ending.
 */
export function nextStage(current, { state = {} } = {}) {
  const applicable = stagesFor({ state });
  const index = applicable.findIndex((s) => s.key === current);
  if (index < 0) return applicable[0] ?? null;
  return applicable[index + 1] ?? null;
}

/** Zero-based position of a stage within the applicable sequence, for a progress display. */
export function stagePosition(current, { state = {} } = {}) {
  const applicable = stagesFor({ state });
  return { index: applicable.findIndex((s) => s.key === current), total: applicable.length };
}
