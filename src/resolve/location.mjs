/* Hit location — anatomy selection, the three d12 tables, and the beast fallback chain
 * (concept §5, DESIGN.md §5.3).
 *
 * The table walk is pure: it takes an anatomy, a set of limbs the target has, and a d12 total,
 * and returns a location. Reading which anatomy and limbs an actor *has* is a separate step, so
 * the interesting logic stays testable without an actor.
 */

import { MODULE_ID } from "../const.mjs";
import { getAnatomyData } from "../catalog/catalog.mjs";

/** Slots that every creature has, so a candidate naming one always matches. */
const UNIVERSAL = new Set(["torso", "head"]);

export const ANATOMIES = ["humanoid", "beast", "aberrant"];

/**
 * Which anatomy table an actor uses.
 *
 * Precedence: an explicit per-actor flag, then the creature-type default from anatomy.json,
 * then the file's own default. A creature with several types takes the first that maps.
 */
export function anatomyFor(actor, data = getAnatomyData()) {
  const override = actor?.getFlag?.(MODULE_ID, "anatomy");
  if (ANATOMIES.includes(override)) return override;

  // v11 stores these as a Set of creature-type keys.
  const types = actor?.system?.traits?.creatureTypes?.standard ?? [];
  for (const type of types) {
    const mapped = data?.byCreatureType?.[type]?.anatomy;
    if (ANATOMIES.includes(mapped)) return mapped;
  }

  return data?.default?.anatomy ?? "humanoid";
}

/**
 * Which limbs an actor has, as a Set of slot names.
 *
 * A `limbs` flag replaces the creature-type default outright rather than merging — the point of
 * the override is to describe a creature the defaults get wrong, and merging would make it
 * impossible to take a limb away.
 */
export function limbsFor(actor, data = getAnatomyData()) {
  const override = actor?.getFlag?.(MODULE_ID, "limbs");
  if (Array.isArray(override)) return new Set(override);

  const types = actor?.system?.traits?.creatureTypes?.standard ?? [];
  for (const type of types) {
    const mapped = data?.byCreatureType?.[type]?.limbs;
    if (Array.isArray(mapped)) return new Set(mapped);
  }

  return new Set(data?.default?.limbs ?? []);
}

export function locationTable(anatomy, data = getAnatomyData()) {
  return data?.tables?.[anatomy] ?? null;
}

/**
 * Resolve a d12 total into a hit location.
 *
 * Beast rows list several candidates in priority order ("Tail/Left Leg"); the first slot the
 * target actually has wins. A row whose candidates all miss falls back to the torso rather than
 * resolving to nothing — an ooze that rolls an appendage it doesn't have is hit in the body.
 *
 * @param {object} opts
 * @param {string} opts.anatomy
 * @param {Set<string>|string[]} opts.limbs  slots the target has
 * @param {number} opts.total                the d12 result
 * @returns {{ slot: string, side: string|null, rolled: number, chosen: false,
 *             fellBack: boolean, from: object|null }|null}
 */
export function locationFor({ anatomy, limbs, total, data = getAnatomyData() } = {}) {
  const table = locationTable(anatomy, data);
  if (!table) return null;

  const value = Math.trunc(Number(total) || 0);
  const row = table.find(({ range: [min, max] }) => value >= min && value <= max);
  if (!row) return null;

  const has = limbs instanceof Set ? limbs : new Set(limbs ?? []);
  const [first] = row.candidates;

  for (const candidate of row.candidates) {
    if (!UNIVERSAL.has(candidate.slot) && !has.has(candidate.slot)) continue;
    return {
      slot: candidate.slot,
      side: candidate.side ?? null,
      rolled: value,
      chosen: false,
      fellBack: candidate !== first,
      from: candidate === first ? null : { slot: first.slot, side: first.side ?? null },
    };
  }

  // Every candidate named a limb this creature lacks.
  return {
    slot: data?._fallbackSlot ?? "torso",
    side: null,
    rolled: value,
    chosen: false,
    fellBack: true,
    from: { slot: first.slot, side: first.side ?? null },
  };
}

/**
 * A location picked rather than rolled — a called shot the player picked (§7.2).
 *
 * Recorded as `chosen` so the card can say "chosen" instead of "rolled" (DESIGN.md §5.3); the
 * distinction is visible to players and shouldn't be inferred from a missing roll.
 */
export function chooseLocation(slot, side = null) {
  return { slot, side: side ?? null, rolled: null, chosen: true, fellBack: false, from: null };
}

/**
 * The d12 location table resolved for one creature, as threshold rows that keep their location.
 *
 * Rows are **thresholds**, not ranges: each covers from its `min` to the next row's `min - 1`, and
 * the lowest omits `min` entirely. That shape cannot contain a gap, which is why roll-requests
 * uses it — and it is why this walks the anatomy table's ranges rather than passing them through.
 *
 * Every row is resolved through `locationFor` for THIS creature, so the beast fallback chain is
 * already applied: a wolf's table says "Left Leg" where a naga's says "Torso" for the same face.
 * Adjacent rows that resolve to the same place are merged, so a creature that lacks most limbs
 * shows one wide Torso band instead of six identical rows.
 *
 * The resolved `location` rides along because the same list serves both ways of settling a hit
 * location (§7.2): rolled, where the d12 total is looked up, and CHOSEN, where roll-requests hands
 * back the index of the row a player picked and there is no total to look anything up with.
 *
 * @returns {{ min?: number, label: string, location: object|null }[]}
 */
export function locationOptions({ anatomy, limbs, data = getAnatomyData() } = {}) {
  const table = locationTable(anatomy, data);
  if (!table) return [];

  const rows = [...table].sort((a, b) => a.range[0] - b.range[0]);
  const out = [];

  for (const row of rows) {
    const min = row.range[0];
    const location = locationFor({ anatomy, limbs, total: min, data });
    const label = locationLabel(location) || "—";

    // Merge into the previous row when it resolves to the same place.
    if (out.length && out.at(-1).label === label) continue;
    out.push({ min, label, location });
  }

  // The lowest row is open-ended below, so it carries no `min`.
  if (out.length) delete out[0].min;
  return out;
}

/**
 * The same table, stripped to what pf1-roll-requests' `resultTable` takes.
 *
 * @returns {{ min?: number, label: string }[]}
 */
export function locationResultTable(opts = {}) {
  return locationOptions(opts).map(({ min, label }) => (min === undefined ? { label } : { min, label }));
}

/** Human-readable label — "Left Leg", "Torso". Display only; nothing keys off this. */
export function locationLabel(location) {
  if (!location?.slot) return "";
  const slot = location.slot.charAt(0).toUpperCase() + location.slot.slice(1);
  if (!location.side) return slot;
  return `${location.side.charAt(0).toUpperCase() + location.side.slice(1)} ${slot}`;
}
