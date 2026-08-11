/* Applying the conditions an entry inflicts (DESIGN.md §6).
 *
 * ── Why there is no buff in here ────────────────────────────────────────────
 *
 * The obvious way to give a condition a duration is to synthesize a buff that supplies it and let
 * the buff's duration carry the clock. That is what pf1-bleed-effects does for buff-supplied bleed,
 * and it is the wrong tool here: PF1 has native condition durations and has had them all along.
 *
 * `ActorPF#setCondition(id, data)` merges `data` into the Active Effect it creates, and
 * `setConditions` stamps `flags.pf1.autoDelete` on every condition AE, so an expired one is
 * DELETED rather than left disabled — the condition genuinely goes away. `expireActiveEffects`
 * reads `duration.seconds` against world time and honours `system.end`, which PF1's base AE data
 * model declares. A GM can then right-click the condition on the sheet and see (or change) the
 * remaining rounds in the system's own dialog.
 *
 * So a condition here is a condition, not a buff wearing one. `buff` remains the channel for
 * anything that needs `changes`, context notes, or a healing lifecycle.
 *
 * ── Bleed ───────────────────────────────────────────────────────────────────
 *
 * `bleed` is the one condition that carries a payload, because PF1's own bleed is an inert marker:
 * the system tracks that you are bleeding and never asks how much. pf1-bleed-effects supplies the
 * per-round damage, and an entry's `bleed` block is its configuration.
 *
 * Both halves degrade independently, which is the point. No block means the vanilla marker. No
 * pf1-bleed-effects means the vanilla marker. Neither is an error and neither is reported at the
 * table — a world without that module gets exactly what PF1 alone would have given it.
 */

import { MODULE_ID } from "../const.mjs";
import { BLEED_CONDITION, CONDITION_DURATION_UNITS, bleedKind } from "../catalog/schema.mjs";
import { showDice } from "./dice.mjs";

/** pf1-bleed-effects' API, or null when it isn't there to ask. */
export function bleedApi() {
  if (!game.modules.get("pf1-bleed-effects")?.active) return null;
  return globalThis.pf1BleedEffects ?? game.modules.get("pf1-bleed-effects")?.api ?? null;
}

/** A condition's display name, from PF1's registry. Falls back to the raw id. */
export const conditionLabel = (id) => pf1.registry.conditions.get(id)?.name || id;

/**
 * How long a duration descriptor lasts, rolling its formula if it has one — and handing back the
 * `Roll` so the caller can put the dice on the table.
 *
 * `timing` is null for "no duration" — a condition that stays until something takes it off — which
 * is a real and common answer, not a failure. A formula that will not evaluate lands there too
 * rather than throwing: an unparseable `1d4 rouns` should cost the entry its timer, not the whole
 * resolution.
 *
 * **No roll data, deliberately.** A duration is a bare number or a simple die — `1d4 minutes` —
 * and never a scaling expression. Passing roll data would invite `@cl`-style formulas that the
 * validator's own pattern rejects anyway, so the two limits agree rather than one silently
 * catching what the other let through.
 *
 * @param {{ value: number|string, units: string }} [duration]
 * @returns {Promise<{ timing: { seconds: number, rolled: number, label: string }|null, roll: Roll|null }>}
 */
export async function rollDuration(duration) {
  if (!duration) return { timing: null, roll: null };

  const per = CONDITION_DURATION_UNITS[duration.units];
  if (!per) return { timing: null, roll: null };

  let rolled;
  let roll = null;

  if (typeof duration.value === "number") {
    rolled = duration.value;
  } else {
    try {
      roll = await new Roll(String(duration.value)).evaluate();
      rolled = roll.total;
    } catch (err) {
      console.error(`${MODULE_ID} | condition duration "${duration.value}" would not roll:`, err);
      return { timing: null, roll: null };
    }
  }

  rolled = Math.max(1, Math.round(Number(rolled) || 0));
  const plural = rolled === 1 ? duration.units : `${duration.units}s`;
  return { timing: { seconds: rolled * per, rolled, label: `${rolled} ${plural}` }, roll };
}

/**
 * Apply one condition descriptor to an actor.
 *
 * The condition is set first and the bleed payload second, deliberately. pf1-bleed-effects creates
 * its own actor-level marker only when it cannot find one, so setting ours first means one bleed
 * condition on the sheet rather than two — and it is ours that carries the duration.
 *
 * @param {Actor} actor
 * @param {object} condition  a validated descriptor: { id, duration?, bleed? }
 * @param {object} [opts]
 * @param {object|null} [opts.timing]  a pre-rolled duration from `rollDuration`. Passing it is how
 *   `applyConditions` gets every die of one apply press into a single animation — the roll has
 *   already happened by the time this runs. Omitting it rolls here, for a direct caller with one
 *   condition and nothing to pool it with.
 * @returns {Promise<string|null>} a one-line summary of what was applied, or null if nothing was
 */
export async function applyCondition(actor, condition, { timing } = {}) {
  const { id } = condition ?? {};
  if (!actor || !id) return null;

  // `undefined` means "not pre-rolled"; an explicit null means "pre-rolled, and there is no
  // duration". The two must not collapse, or a pre-rolled untimed condition would be re-rolled.
  if (timing === undefined) ({ timing } = await rollDuration(condition.duration));

  /* An AE update object, not a boolean: this is the whole of what native condition durations
   * needed. `startTime` is set explicitly rather than left to Foundry because expireActiveEffects
   * measures from it and reads an absent one as 0 — which would expire the condition on creation. */
  const aeData = timing
    ? {
        duration: { seconds: timing.seconds, startTime: game.time.worldTime },
        ...(condition.duration?.end ? { system: { end: condition.duration.end } } : {}),
      }
    : true;

  try {
    await actor.setCondition(id, aeData);
  } catch (err) {
    console.error(`${MODULE_ID} | could not set condition "${id}" on ${actor.name}:`, err);
    return null;
  }

  let summary = timing ? `${conditionLabel(id)} (${timing.label})` : conditionLabel(id);

  if (id === BLEED_CONDITION && condition.bleed) {
    const api = bleedApi();
    if (api?.apply) {
      const { formula, ability = null, mode = "damage", deep = null } = condition.bleed;
      try {
        await api.apply(actor, {
          formula,
          kind: bleedKind({ ability, mode }),
          ...(deep ? { deepRequired: deep } : {}),
        });
        summary += ` — ${formula}${ability ? ` ${ability.toUpperCase()} ${mode}` : ""}${deep ? `, ${deep} HP to close` : ""}`;
      } catch (err) {
        console.error(`${MODULE_ID} | could not apply bleed to ${actor.name}:`, err);
      }
    }
    // No API: the condition is on and inert, which is vanilla PF1 bleed. Nothing to report.
  }

  return summary;
}

/**
 * Apply every condition an entry carries.
 *
 * Sequential rather than parallel, because two `setCondition` calls racing on the same actor both
 * read `actor.statuses` before either writes and PF1's condition-track handling can then drop one
 * of them. Conditions are one or two per entry, so the cost of doing this in order is nothing.
 *
 * One failing condition does not stop the rest — the same isolation the buff channel has.
 *
 * @param {Actor} actor
 * @param {object[]} conditions
 * @returns {Promise<string[]>} summaries of what actually landed
 */
export async function applyConditions(actor, conditions = []) {
  const list = conditions ?? [];

  /* Every duration is rolled BEFORE anything is applied, so all of one press's dice go into one
   * animation. Rolling inside the apply loop instead would animate 1d4 rounds of dazed, apply it,
   * then animate 1d4 minutes of deafened — two throws for one blow, with a condition landing in
   * between them. */
  const timings = [];
  const rolls = [];
  for (const condition of list) {
    const { timing, roll } = await rollDuration(condition.duration);
    timings.push(timing);
    if (roll) rolls.push(roll);
  }

  // Awaited, so the conditions land as the dice come to rest rather than before anyone has read
  // them. Bare-number durations produce no roll and therefore no animation.
  await showDice(rolls);

  const applied = [];
  for (const [index, condition] of list.entries()) {
    const summary = await applyCondition(actor, condition, { timing: timings[index] });
    if (summary) applied.push(summary);
  }
  return applied;
}

/**
 * How an entry's conditions read on a card, before anything is applied.
 *
 * Dice are NOT rolled here — `1d4 minutes` stays `1d4 minutes` — because this is the label on a
 * button that has not been pressed. Rolling for a preview would either mislead (the applied value
 * differs) or commit (the preview becomes the value), and both are worse than showing the formula.
 *
 * @param {object[]} conditions
 * @returns {string} e.g. "Dazed (1 round), Deafened (1d4 minutes)"
 */
export function describeConditions(conditions = []) {
  return (conditions ?? [])
    .map((c) => {
      const duration = durationLabel(c.duration);
      return duration ? `${conditionLabel(c.id)} (${duration})` : conditionLabel(c.id);
    })
    .join(", ");
}

/**
 * A duration as **authored** — `1d4 minutes`, not the number a roll would produce.
 *
 * The distinction is the whole reason this is separate from `rollDuration`: that one rolls,
 * because it is applying the condition; this one does not, because it is labelling one that has
 * not been applied yet. Rolling here would either mislead (the applied value differs) or commit
 * (the preview becomes the value).
 *
 * @param {{ value: number|string, units: string }} [duration]
 * @returns {string|null} null for a condition that lasts until something removes it
 */
export function durationLabel(duration) {
  if (!duration) return null;
  const { value, units } = duration;
  return `${value} ${value === 1 ? units : `${units}s`}`;
}

/** The icon PF1 draws for a condition, for a card that wants to name one. */
export const conditionIcon = (id) => pf1.registry.conditions.get(id)?.texture || null;
