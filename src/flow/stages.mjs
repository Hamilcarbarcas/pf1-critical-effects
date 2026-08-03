/* The crit resolution stage list, as data (DESIGN.md §7.2).
 *
 * Pure and synchronous — no dialog, no world. Building the sequence as data rather than as
 * control flow is what lets a stage be skipped without any downstream code knowing: `applies()`
 * decides, and the walk in `nextStage` does the rest.
 *
 * Four stages, and the shape is deliberately flat:
 *
 *   trigger   the only branch point — damage alone ends the resolution here
 *   location  which body part, rolled or chosen by the player
 *   power     the die pool, its modifiers, and the roll that indexes the effect table
 *   result    the drawn row, adjustable by the GM, committed to the attack card
 *
 * The confirmation explosion is NOT a stage. It happens with the attack roll itself
 * (flow/explosion.mjs), because it is a property of the dice that were already thrown rather
 * than a decision anyone makes.
 */

/** @typedef {"trigger"|"location"|"power"|"result"} StageKey */

export const STAGES = [
  {
    key: "trigger",
    label: "Trigger",
    hint: "Critical damage, a critical effect, or both?",
  },
  {
    key: "location",
    label: "Location",
    hint: "Check the creature type, then have the player roll the hit location or pick one.",
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
 * The stages that apply to a given resolution.
 *
 * @param {object} opts
 * @param {object} opts.state  the resolution's current state, for conditional stages
 * @returns {object[]}
 */
export function stagesFor({ state = {} } = {}) {
  return STAGES.filter((stage) => typeof stage.applies !== "function" || stage.applies(state));
}

/** Look up a stage by key, regardless of whether it currently applies. */
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
