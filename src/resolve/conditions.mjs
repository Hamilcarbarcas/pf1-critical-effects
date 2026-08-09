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

/** pf1-bleed-effects' API, or null when it isn't there to ask. */
export function bleedApi() {
  if (!game.modules.get("pf1-bleed-effects")?.active) return null;
  return globalThis.pf1BleedEffects ?? game.modules.get("pf1-bleed-effects")?.api ?? null;
}

/** A condition's display name, from PF1's registry. Falls back to the raw id. */
export const conditionLabel = (id) => pf1.registry.conditions.get(id)?.name || id;

/**
 * How many seconds a duration descriptor is worth, rolling its formula if it has one.
 *
 * Returns null for "no duration" — a condition that stays until something takes it off — which is
 * a real and common answer, not a failure. A formula that will not evaluate also lands here rather
 * than throwing: an unparseable `1d4 rouns` should cost the entry its timer, not the whole
 * resolution.
 *
 * @param {{ value: number|string, units: string }} [duration]
 * @returns {Promise<{ seconds: number, rolled: number, label: string }|null>}
 */
export async function durationSeconds(duration) {
  if (!duration) return null;

  const per = CONDITION_DURATION_UNITS[duration.units];
  if (!per) return null;

  let rolled;
  if (typeof duration.value === "number") {
    rolled = duration.value;
  } else {
    try {
      const roll = await new Roll(String(duration.value)).evaluate();
      rolled = roll.total;
    } catch (err) {
      console.error(`${MODULE_ID} | condition duration "${duration.value}" would not roll:`, err);
      return null;
    }
  }

  rolled = Math.max(1, Math.round(Number(rolled) || 0));
  const plural = rolled === 1 ? duration.units : `${duration.units}s`;
  return { seconds: rolled * per, rolled, label: `${rolled} ${plural}` };
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
 * @returns {Promise<string|null>} a one-line summary of what was applied, or null if nothing was
 */
export async function applyCondition(actor, condition) {
  const { id } = condition ?? {};
  if (!actor || !id) return null;

  const timing = await durationSeconds(condition.duration);

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
  const applied = [];
  for (const condition of conditions ?? []) {
    const summary = await applyCondition(actor, condition);
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
      const label = conditionLabel(c.id);
      if (!c.duration) return label;
      const { value, units } = c.duration;
      const plural = value === 1 ? units : `${units}s`;
      return `${label} (${value} ${plural})`;
    })
    .join(", ");
}
