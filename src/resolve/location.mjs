/* Hit location — anatomy selection, the d20 band layout, and the generated beast/aberrant tables
 * (concept §5, DESIGN.md §5.3).
 *
 * The table walk is pure: it takes an anatomy, that creature's limb layout, and a d20 total, and
 * returns a location. Reading which anatomy and layout an actor *has* is a separate step, so the
 * interesting logic stays testable without an actor.
 *
 * ── Why the tables are generated ────────────────────────────────────────────
 *
 * Through v1 the three tables were enumerated in anatomy.json, and a creature that lacked a limb
 * the table named fell through a chain of candidates to something it did have. That put the odds
 * at the mercy of the fallback: a wolf and a dragon read the same rows, and the wolf's missing
 * wings quietly became extra legs.
 *
 * Now the GM says which categories the creature actually has and the limb band is DIVIDED between
 * them. Twelve faces (1-12) over 1, 2, 3 or 4 categories is 12 / 6 / 4 / 3 apiece with no
 * remainder, so every layout is even by construction and no fallback chain is needed. Torso and
 * head sit above the band and are the same for every anatomy.
 *
 * Sides are gone with it (v2). A location is a body part, not a left or right one — which side of
 * the creature it was is the GM's call in the moment it matters, and enumerating it doubled every
 * table to say something the effect content never keyed off.
 */

import { MODULE_ID } from "../const.mjs";
import { getAnatomyData } from "../catalog/catalog.mjs";

export const ANATOMIES = ["humanoid", "beast", "aberrant"];

/** Fallbacks for the layout parameters, used only if anatomy.json is missing or broken. */
const DEFAULT_BANDS = { limbs: [1, 12], torso: [13, 18], head: [19, 20] };
const DEFAULT_BEAST_ORDER = ["leg", "arm", "wing", "tail"];
const DEFAULT_MAX_APPENDAGES = 4;

/** Display names for the beast categories — plural, because each covers every limb of that kind. */
const BEAST_LABELS = { leg: "Legs", arm: "Arms", wing: "Wings", tail: "Tail" };

export const locationBandsOf = (data = getAnatomyData()) => data?.bands ?? DEFAULT_BANDS;
export const beastOrder = (data = getAnatomyData()) => data?.beastOrder ?? DEFAULT_BEAST_ORDER;
export const maxAppendages = (data = getAnatomyData()) => data?.maxAppendages ?? DEFAULT_MAX_APPENDAGES;
export const beastLimbLabel = (slot) => BEAST_LABELS[slot] ?? capitalize(slot);

/** The die the hit location is rolled on, as a formula. Data-driven so a world can retune it. */
export const locationFormula = (data = getAnatomyData()) => `1d${data?.die ?? 20}`;

// --- reading a creature's layout --------------------------------------------

/**
 * Which anatomy table an actor uses.
 *
 * Precedence: an explicit per-actor flag, then the creature-type default from anatomy.json,
 * then the file's own default. A creature with several types takes the first that maps.
 */
export function anatomyFor(actor, data = getAnatomyData()) {
  const override = actor?.getFlag?.(MODULE_ID, "anatomy");
  if (ANATOMIES.includes(override)) return override;

  for (const type of creatureTypesOf(actor)) {
    const mapped = data?.byCreatureType?.[type]?.anatomy;
    if (ANATOMIES.includes(mapped)) return mapped;
  }

  return data?.default?.anatomy ?? "humanoid";
}

/**
 * The creature's limb layout: which beast categories it has, and what its appendages are called.
 *
 * Both lists are carried regardless of anatomy — the GM can switch the dropdown mid-resolution,
 * and dropping the layout that isn't currently showing would lose their work on the way back.
 *
 * @returns {{ beastLimbs: string[], appendages: string[] }}
 */
export function limbConfigFor(actor, data = getAnatomyData()) {
  return {
    beastLimbs: beastLimbsFor(actor, data),
    appendages: appendagesFor(actor, data),
  };
}

/**
 * Which beast categories this creature has, in table order.
 *
 * A flag replaces the creature-type default outright rather than merging — the point of the
 * override is to describe a creature the defaults get wrong, and merging would make it impossible
 * to take a limb away.
 */
export function beastLimbsFor(actor, data = getAnatomyData()) {
  const order = beastOrder(data);
  const inOrder = (list) => order.filter((slot) => list.includes(slot));

  const flag = actor?.getFlag?.(MODULE_ID, "beastLimbs");
  if (Array.isArray(flag)) return inOrder(flag);

  // v1 stored one `limbs` array for both anatomies. Its beast half maps over unchanged.
  const legacy = actor?.getFlag?.(MODULE_ID, "limbs");
  if (Array.isArray(legacy)) return inOrder(legacy);

  for (const type of creatureTypesOf(actor)) {
    const entry = data?.byCreatureType?.[type];
    const list = entry?.beastLimbs ?? entry?.limbs;
    if (Array.isArray(list)) return inOrder(list);
  }

  return inOrder(data?.default?.beastLimbs ?? []);
}

/**
 * This creature's appendage types, as raw names — `""` for one the GM never named.
 *
 * The name is descriptive only. Every appendage reads the same `appendage` effect table however it
 * is labelled, so naming three of them costs nothing in content and buys a card that says
 * "Tentacle" instead of "Appendage".
 */
export function appendagesFor(actor, data = getAnatomyData()) {
  const max = maxAppendages(data);
  const clean = (list) => list.slice(0, max).map((name) => String(name ?? "").trim());

  const flag = actor?.getFlag?.(MODULE_ID, "appendages");
  if (Array.isArray(flag)) return clean(flag);

  // v1's single `limbs` array said only whether there were appendages at all, never how many.
  const legacy = actor?.getFlag?.(MODULE_ID, "limbs");
  if (Array.isArray(legacy)) return legacy.includes("appendage") ? [""] : [];

  for (const type of creatureTypesOf(actor)) {
    const entry = data?.byCreatureType?.[type];
    if (Array.isArray(entry?.appendages)) return clean(entry.appendages);
    if (Array.isArray(entry?.limbs)) return entry.limbs.includes("appendage") ? [""] : [];
  }

  return clean(data?.default?.appendages ?? []);
}

/** v11 stores these as a Set of creature-type keys. */
const creatureTypesOf = (actor) => actor?.system?.traits?.creatureTypes?.standard ?? [];

/**
 * Unnamed appendages, resolved to display names.
 *
 * One blank is just "Appendage"; several have to be told apart, so they number off — "Appendage 1",
 * "Appendage 2". The numbering counts only the blanks, so naming two of three leaves the odd one
 * out as plain "Appendage" rather than "Appendage 3".
 */
export function appendageLabels(names = []) {
  const raw = names.map((name) => String(name ?? "").trim());
  const blanks = raw.filter((name) => !name).length;

  let n = 0;
  return raw.map((name) => name || (blanks > 1 ? `Appendage ${++n}` : "Appendage"));
}

// --- building the table -----------------------------------------------------

/**
 * The d20 location table for one creature: `[{ range: [min, max], slot, label? }]`.
 *
 * Humanoid is read from anatomy.json — its two categories are not a choice. Beast and aberrant are
 * generated from the layout, because their rows depend on which categories the creature has.
 *
 * @param {object} opts
 * @param {string} opts.anatomy
 * @param {{ beastLimbs?: string[], appendages?: string[] }} [opts.limbConfig]
 */
export function locationTable({ anatomy, limbConfig = {} } = {}, data = getAnatomyData()) {
  if (anatomy === "humanoid") return data?.tables?.humanoid ?? null;
  if (!ANATOMIES.includes(anatomy)) return null;

  const parts =
    anatomy === "beast"
      ? beastOrder(data)
          .filter((slot) => (limbConfig.beastLimbs ?? []).includes(slot))
          .map((slot) => ({ slot }))
      : appendageLabels((limbConfig.appendages ?? []).slice(0, maxAppendages(data)))
          .map((label) => ({ slot: "appendage", label }));

  const bands = locationBandsOf(data);
  const [limbMin, limbMax] = bands.limbs;

  /* No limbs at all — an ooze, or a beast the GM has unchecked everything on. The limb band is
   * simply unclaimed and the torso row grows down to cover it, so the creature reads "1-18 Torso"
   * rather than resolving a third of its rolls to nothing. */
  if (!parts.length) {
    return [
      { range: [limbMin, bands.torso[1]], slot: data?._fallbackSlot ?? "torso" },
      { range: [...bands.head], slot: "head" },
    ];
  }

  return [
    ...divideBand([limbMin, limbMax], parts),
    { range: [...bands.torso], slot: "torso" },
    { range: [...bands.head], slot: "head" },
  ];
}

/**
 * Split a band of faces between body parts, in order.
 *
 * With the shipped numbers this is always exact — twelve faces over one to four parts — but the
 * remainder is handled anyway, going to the earlier parts, so retuning `bands` or `maxAppendages`
 * in anatomy.json cannot produce a table with a hole in it.
 */
function divideBand([min, max], parts) {
  const faces = max - min + 1;
  const each = Math.floor(faces / parts.length);
  const remainder = faces % parts.length;

  const rows = [];
  let cursor = min;

  for (const [index, part] of parts.entries()) {
    const width = each + (index < remainder ? 1 : 0);
    if (width <= 0) continue;
    rows.push({ range: [cursor, cursor + width - 1], ...part });
    cursor += width;
  }

  return rows;
}

/**
 * Resolve a d20 total into a hit location.
 *
 * @param {object} opts
 * @param {string} opts.anatomy
 * @param {{ beastLimbs?: string[], appendages?: string[] }} [opts.limbConfig]
 * @param {number} opts.total   the d20 result
 * @returns {{ slot: string, label: string|null, rolled: number, chosen: false }|null}
 */
export function locationFor({ anatomy, limbConfig, total, data = getAnatomyData() } = {}) {
  const table = locationTable({ anatomy, limbConfig }, data);
  if (!table) return null;

  const value = Math.trunc(Number(total) || 0);
  const row = table.find(({ range: [min, max] }) => value >= min && value <= max);
  if (!row) return null;

  return { slot: row.slot, label: row.label ?? null, rolled: value, chosen: false };
}

/**
 * A location picked rather than rolled — a called shot the player picked (§7.2).
 *
 * Recorded as `chosen` so the card can say "chosen" instead of "rolled" (DESIGN.md §5.3); the
 * distinction is visible to players and shouldn't be inferred from a missing roll.
 */
export function chooseLocation(slot, label = null) {
  return { slot, label: label ?? null, rolled: null, chosen: true };
}

// --- presenting the table ---------------------------------------------------

/**
 * This creature's table as labelled bands — `[{ min, max, range: "1-3", label }]`.
 *
 * The GM-facing view: shown under the layout controls so the odds the checkboxes just bought are
 * visible before anything is rolled.
 */
export function locationBands({ anatomy, limbConfig, data = getAnatomyData() } = {}) {
  const table = locationTable({ anatomy, limbConfig }, data) ?? [];
  return table.map(({ range: [min, max], slot, label }) => ({
    min,
    max,
    range: min === max ? `${min}` : `${min}-${max}`,
    label: label ?? capitalize(slot),
  }));
}

/**
 * The same table as threshold rows that keep their location.
 *
 * Rows are **thresholds**, not ranges: each covers from its `min` to the next row's `min - 1`, and
 * the lowest omits `min` entirely. That shape cannot contain a gap, which is why roll-requests
 * uses it — and it is why this walks the table's ranges rather than passing them through.
 *
 * Adjacent rows resolving to the same label are merged, so two appendages the GM gave the same
 * name read as one wide band instead of two identical ones.
 *
 * The resolved `location` rides along because the same list serves both ways of settling a hit
 * location (§7.2): rolled, where the d20 total is looked up, and CHOSEN, where roll-requests hands
 * back the index of the row a player picked and there is no total to look anything up with.
 *
 * @returns {{ min?: number, label: string, location: object|null }[]}
 */
export function locationOptions({ anatomy, limbConfig, data = getAnatomyData() } = {}) {
  const out = [];

  for (const band of locationBands({ anatomy, limbConfig, data })) {
    // Merge into the previous row when it resolves to the same place.
    if (out.length && out.at(-1).label === band.label) continue;
    out.push({
      min: band.min,
      label: band.label,
      location: locationFor({ anatomy, limbConfig, total: band.min, data }),
    });
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

/** Human-readable label — "Tentacle", "Torso". Display only; nothing keys off this. */
export function locationLabel(location) {
  if (!location?.slot) return "";
  return location.label || capitalize(location.slot);
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
}

// --- writing a creature's layout back ---------------------------------------

/**
 * The actor a layout should be SAVED to, which is not always the one it was read from.
 *
 * An unlinked token's `actor` is a synthetic document built from its ActorDelta, and a flag written
 * there describes that one token. The layout describes the creature — a hydra has three heads
 * whichever hydra it is — so it belongs on the world actor, where every token of that creature
 * picks it up. Reads still go through the token's own actor, which inherits base flags unless the
 * delta deliberately overrides them.
 *
 * @param {TokenDocument|Actor|null} target
 */
export function configActorFor(target) {
  if (!target) return null;

  const token = target.documentName === "Token" ? target : (target.token ?? null);
  if (token) return token.baseActor ?? token.actor ?? null;

  return target.documentName === "Actor" ? target : null;
}

/**
 * Persist part of a creature's layout.
 *
 * Written as the GM edits rather than on Confirm: the layout describes the creature, not the
 * resolution, so an abandoned resolution should still leave it correct.
 *
 * @param {TokenDocument|Actor|null} target
 * @param {{ anatomy?: string, beastLimbs?: string[], appendages?: string[] }} patch
 */
export async function saveLimbConfig(target, patch = {}) {
  const actor = configActorFor(target);
  if (!actor) return null;

  const update = {};
  if (patch.anatomy != null) update[`flags.${MODULE_ID}.anatomy`] = patch.anatomy;
  if (Array.isArray(patch.beastLimbs)) update[`flags.${MODULE_ID}.beastLimbs`] = [...patch.beastLimbs];
  if (Array.isArray(patch.appendages)) update[`flags.${MODULE_ID}.appendages`] = [...patch.appendages];
  if (!Object.keys(update).length) return actor;

  /* The v1 `limbs` flag is what these replace. Left behind it is dead weight that reads as a
   * still-live override, so it goes — but only once something has actually superseded it. Dropping
   * it on an anatomy-only save would throw away a layout that had not been migrated yet. */
  const superseded = Array.isArray(patch.beastLimbs) && Array.isArray(patch.appendages);
  if (superseded && Array.isArray(actor.getFlag(MODULE_ID, "limbs"))) {
    update[`flags.${MODULE_ID}.-=limbs`] = null;
  }

  await actor.update(update);
  return actor;
}
