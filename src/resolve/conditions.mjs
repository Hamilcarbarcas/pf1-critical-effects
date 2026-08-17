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

  let summary = timing ? `${conditionLabel(id)} (${timing.label})` : conditionLabel(id);

  /* ── Configured bleed registers BEFORE its marker ──────────────────────────
   *
   * pf1-bleed-effects prompts for an amount from `pf1ToggleActorCondition` whenever bleed turns on
   * with nothing stored for it, which is the right behaviour for a GM ticking the box on the token
   * HUD and the wrong one here: this entry already knows how much it bleeds. Setting the condition
   * first raised that dialog over a bleed that was about to be configured a line later.
   *
   * `BleedAPI.apply` sets the marker itself once it has written its stored effects, so the marker
   * arrives from inside the module that owns it with the amount already there and the prompt's own
   * "already configured" guard satisfied. Calling `setCondition` afterwards would be a no-op in any
   * case — PF1's `setConditions` drops a condition whose AE already exists rather than updating it,
   * so the duration below has to be written to the effect directly. */
  const bleed = id === BLEED_CONDITION ? condition.bleed : null;
  const api = bleed ? bleedApi() : null;

  if (bleed && api?.apply) {
    const { formula, ability = null, mode = "damage", deep = null } = bleed;
    let registered = false;
    try {
      await api.apply(actor, {
        formula,
        kind: bleedKind({ ability, mode }),
        ...(deep ? { deepRequired: deep } : {}),
      });
      registered = true;
      summary += ` — ${formula}${ability ? ` ${ability.toUpperCase()} ${mode}` : ""}${deep ? `, ${deep} HP to close` : ""}`;
    } catch (err) {
      // Fall through to the plain marker: a bleed that could not be registered should still show.
      console.error(`${MODULE_ID} | could not apply bleed to ${actor.name}:`, err);
    }

    if (registered) {
      /* No entry in the catalog gives bleed a duration — it runs until it is closed — but the
       * channel allows one, and the marker it would have gone on was created by someone else. */
      if (timing) {
        const marker = actor.effects.find((ae) => ae.statuses?.has(BLEED_CONDITION));
        if (marker) {
          try {
            await marker.update(aeData);
          } catch (err) {
            console.error(`${MODULE_ID} | could not time the bleed on ${actor.name}:`, err);
          }
        }
      }
      return summary;
    }
  }

  /* Everything else, and bleed with no configuration or no pf1-bleed-effects to configure — the
   * condition goes on and, for bleed, is the inert marker vanilla PF1 would have given it. */
  try {
    await actor.setCondition(id, aeData);
  } catch (err) {
    console.error(`${MODULE_ID} | could not set condition "${id}" on ${actor.name}:`, err);
    return null;
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

/**
 * How much a bleed bleeds, short enough to sit on a card row: `3d6`, `4d6 deep`, `1d4 Con`.
 *
 * Bleed is the one condition whose name says nothing about its severity — every other one on a
 * card is the whole of what it does, while *Bleed* is the same word for a scratch and a severed
 * femoral. It is also the one condition an entry may carry twice, and two identical *Bleed* rows
 * are unreadable without this.
 *
 * `damage` is omitted because it is the default and the unremarkable half of the pair; `drain` is
 * named because it is not. `deep` says only that the wound is deep, not the hit points it takes to
 * close — that number is the dedicated-healing threshold and belongs to the healing UI, not here.
 *
 * @param {{ formula: string, ability?: string|null, mode?: string, deep?: number|null }} [bleed]
 * @returns {string|null} null when there is no configured bleed to describe
 */
export function bleedLabel(bleed) {
  if (!bleed?.formula) return null;
  const parts = [String(bleed.formula)];

  if (bleed.ability) {
    // The config carries i18n keys; localize passes an already-localized string through unchanged.
    const key = pf1.config.abilitiesShort?.[bleed.ability];
    parts.push(key ? game.i18n.localize(key) : bleed.ability.toUpperCase());
  }
  if (bleed.mode === "drain") parts.push("drain");
  if (bleed.deep) parts.push("deep");

  return parts.join(" ");
}

/** The icon PF1 draws for a condition, for a card that wants to name one. */
export const conditionIcon = (id) => pf1.registry.conditions.get(id)?.texture || null;
