/* Catalog validation and dev-time lint (DESIGN.md §3).
 *
 * Two jobs, deliberately kept apart:
 *
 *   validate*()  — structural. Refuses data the engine cannot use at all. Pure and synchronous.
 *   lint()       — see catalog.mjs. Content-quality reporting: dead journal links, thin buckets,
 *                  outcome coverage. Everything it reports is a warning; none of it stops a load.
 *
 * The content strategy is journal-first (§3): an entry with id / name / journal / locations /
 * damageTypes / severity is COMPLETE. `outcomes` is optional, starts absent, and its absence is
 * never an error — the lint reports coverage as a progress metric.
 */

/**
 * The four severity bands, as **authoring** structure only.
 *
 * The engine has no severity layer: the Critical Power total indexes straight into the twelve
 * rows (see `effectAt`). But the twelve rows are *written* three at a time — a table is four
 * bands of three, mildest band first — and that grouping is what the content worksheets in
 * `content/` are organised by, what the fold-in tool checks, and what the GM's override
 * dropdown groups by. Keeping it here means the ladder is defined once rather than in the
 * tool, the worksheet template, and the dialog separately.
 *
 * `mortal` is not one of these. It sits past row 12 (the 13+ clamp) and is authored once per
 * anatomy × location rather than per damage type.
 */
export const SEVERITY_BANDS = [
  { key: "minor", label: "Minor", rows: [1, 3] },
  { key: "moderate", label: "Moderate", rows: [4, 6] },
  { key: "severe", label: "Severe", rows: [7, 9] },
  { key: "grave", label: "Grave", rows: [10, 12] },
];

/** Which band a 1-12 row sits in. Rows outside that span have no band — 13+ is mortal. */
export const bandForRow = (row) =>
  SEVERITY_BANDS.find(({ rows: [min, max] }) => row >= min && row <= max) ?? null;

/** Body locations the d12 location tables can produce (§5.3). Unknown values are warned about,
 *  not rejected — content may legitimately introduce a location before the tables catch up. */
export const LOCATIONS = ["head", "torso", "arm", "leg", "wing", "tail", "appendage"];

/**
 * Which locations each anatomy can actually be hit in — the effect grid's real shape.
 *
 * Derived from the three d12 location tables in anatomy.json, and the reason the grid is 13
 * anatomy × location pairs rather than 3 × 7 = 21: a humanoid has no tail to shatter and an
 * ooze has no arm to break, so those tables are not merely unwritten, they are meaningless.
 * The validator uses this to tell "still to author" apart from "does not exist", which is what
 * keeps the content progress metric honest.
 *
 * Kept in step with anatomy.json by `validateAnatomy`, which reports any slot a location table
 * can produce that is missing from here.
 */
export const ANATOMY_LOCATIONS = {
  humanoid: ["arm", "leg", "torso", "head"],
  beast: ["arm", "leg", "torso", "head", "tail", "wing"],
  aberrant: ["appendage", "torso", "head"],
};

/** Every (anatomy, location) pair the grid covers, in a stable order. 13 of them. */
export const anatomyLocationPairs = () =>
  Object.entries(ANATOMY_LOCATIONS).flatMap(([anatomy, locations]) =>
    locations.map((location) => ({ anatomy, location }))
  );

/**
 * Damage types the catalog keeps tables for — **PF1's own registry ids**, not abbreviations.
 *
 * One vocabulary, running from an action's damage part through the catalog to the dialog's
 * dropdown. The earlier `b`/`p`/`s` had no source outside this module: PF1 calls them
 * `bludgeoning`/`piercing`/`slashing` (`pf1.registry.damageTypes`), so code that read an attack's
 * damage type and compared it against a letter never matched, and the dropdown was never
 * pre-filled.
 *
 * Narrower than PF1's registry on purpose: `untyped`, `force`, `precision`, `nonlethal` and
 * `areaOfEffect` describe how damage is dealt rather than what it does to a body, and there is no
 * table for them.
 */
export const DAMAGE_TYPES = [
  "bludgeoning",
  "piercing",
  "slashing",
  "fire",
  "cold",
  "electric",
  "acid",
  "sonic",
  "positive",
  "negative",
];

/** Display names, for the pickers. PF1's own labels, except where its are terser than useful. */
export const DAMAGE_TYPE_LABELS = {
  bludgeoning: "Bludgeoning",
  piercing: "Piercing",
  slashing: "Slashing",
  fire: "Fire",
  cold: "Cold",
  electric: "Electricity",
  acid: "Acid",
  sonic: "Sonic",
  positive: "Positive Energy",
  negative: "Negative Energy",
};

/** The list a `<select>` wants. */
export const damageTypeOptions = () =>
  DAMAGE_TYPES.map((key) => ({ key, label: DAMAGE_TYPE_LABELS[key] ?? key }));

export const FUMBLE_TABLES = ["melee", "bow", "thrown", "natural"];

export const ANATOMIES = ["humanoid", "beast", "aberrant"];

/** Slots a location table row may name. Superset of LOCATIONS: `appendage` is what the aberrant
 *  table produces, and is a real catalog location rather than a synonym for `arm`. */
export const SLOTS = ["head", "torso", "arm", "leg", "wing", "tail", "appendage"];

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Structural validation of data/effects.json.
 * @returns {{ errors: string[], warnings: string[], entries: object[] }}
 *   `entries` contains only the rows that passed; a bad row is dropped, not fatal.
 */
/** Every effect table is exactly this many rows — see the invariant note in validateEffects. */
export const TABLE_ROWS = 12;

/**
 * Structural validation of data/effects.json.
 *
 * The shape is a flat entry pool plus `tables[damageType][anatomy][location]` — an array of
 * exactly 12 entry ids, indexed by the Critical Power roll, mildest first. Same shape as
 * fumbles.json: entries are shared and a table references them by id, so a repeat costs one id
 * rather than a duplicated row.
 *
 * **Anatomy is a real dimension** (v3), not something location implies. `arm` means a hand that
 * drops a weapon on a humanoid and a foreleg that buckles on a beast, and the two want different
 * twelve rows even though they share a slot name. The grid is therefore 10 damage types × the 13
 * anatomy × location pairs in `ANATOMY_LOCATIONS`, each fully written out — there is no
 * inheritance between anatomies in the data. (The *worksheets* have a "same as humanoid"
 * shorthand; it expands at fold-in time, so the JSON stays explicit.)
 *
 * **12 rows is an invariant, not a convention.** The resolution indexes into the table with a
 * clamped roll and never checks for a hole, so a short table is an error here rather than a
 * surprise at the table. Unwritten content is expressed as `placeholder: true` entries, which
 * keeps the invariant true while `lint()` reports how much is still to author.
 *
 * `mortal[anatomy][location]` is the 13+ addendum — one entry per body part, damage-type
 * agnostic, read on top of row 12 rather than instead of it. Optional: an absent mortal entry
 * leaves the 13+ result as "row 12 plus the Fort save", which is what the rules said before any
 * of them were written.
 *
 * @returns {{ errors: string[], warnings: string[], entries: object[], tables: object,
 *             mortal: object }}
 */
export function validateEffects(data) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const tables = {};
  const mortal = {};

  const bail = (message) => ({ errors: [...errors, message], warnings, entries, tables, mortal });

  if (!isPlainObject(data)) return bail("effects.json: root is not an object");
  if (data.version !== 3) warnings.push(`effects.json: version is ${data.version}, expected 3`);
  if (!Array.isArray(data.entries)) return bail("effects.json: `entries` is not an array");

  const seen = new Set();

  for (const [i, entry] of data.entries.entries()) {
    const where = `effects.json entry #${i}${entry?.id ? ` (${entry.id})` : ""}`;
    const problems = [];

    if (!isNonEmptyString(entry?.id)) problems.push("missing `id`");
    else if (seen.has(entry.id)) problems.push(`duplicate id "${entry.id}"`);
    if (!isNonEmptyString(entry?.name)) problems.push("missing `name`");

    if (entry?.journal != null && !isNonEmptyString(entry.journal)) problems.push("`journal` must be a uuid string when present");
    if (entry?.buff != null && !isNonEmptyString(entry.buff)) problems.push("`buff` must be a uuid string when present");
    if (entry?.note != null && typeof entry.note !== "string") problems.push("`note` must be a string when present");
    if (entry?.tags !== undefined && !Array.isArray(entry.tags)) problems.push("`tags` must be an array when present");

    if (problems.length) {
      errors.push(`${where}: ${problems.join("; ")}`);
      continue;
    }

    seen.add(entry.id);
    entries.push(entry);
  }

  if (!isPlainObject(data.tables)) return bail("effects.json: `tables` is not an object");

  for (const [damageType, anatomies] of Object.entries(data.tables)) {
    if (damageType.startsWith("_")) continue; // annotation key, not a damage type
    if (!DAMAGE_TYPES.includes(damageType)) warnings.push(`effects.json: unknown damage type "${damageType}"`);
    if (!isPlainObject(anatomies)) {
      errors.push(`effects.json: tables.${damageType} is not an object`);
      continue;
    }

    tables[damageType] = {};
    for (const [anatomy, locations] of Object.entries(anatomies)) {
      if (!ANATOMIES.includes(anatomy)) warnings.push(`effects.json: tables.${damageType}.${anatomy}: unknown anatomy`);
      if (!isPlainObject(locations)) {
        errors.push(`effects.json: tables.${damageType}.${anatomy} is not an object`);
        continue;
      }

      tables[damageType][anatomy] = {};
      for (const [location, ids] of Object.entries(locations)) {
        const where = `effects.json tables.${damageType}.${anatomy}.${location}`;
        if (!LOCATIONS.includes(location)) warnings.push(`${where}: unknown location`);
        else if (!ANATOMY_LOCATIONS[anatomy]?.includes(location)) {
          // Harmless but dead: the location table for this anatomy can never produce that slot,
          // so nothing will ever read these twelve rows.
          warnings.push(`${where}: a ${anatomy} is never hit in the ${location}; this table is unreachable`);
        }

        if (!Array.isArray(ids)) {
          errors.push(`${where}: not an array`);
          continue;
        }
        if (ids.length !== TABLE_ROWS) {
          errors.push(`${where}: has ${ids.length} rows, expected exactly ${TABLE_ROWS}`);
          continue;
        }

        const missing = ids.filter((id) => !seen.has(id));
        if (missing.length) {
          errors.push(`${where}: references unknown entries ${[...new Set(missing)].join(", ")}`);
          continue;
        }

        tables[damageType][anatomy][location] = ids;
      }
    }
  }

  /* Mortal: one optional entry id per anatomy × location, damage-type agnostic. Missing is fine
   * and silent — the 13+ clamp degrades to "row 12 plus the save", which is the rule as written.
   * A mortal pointing at an entry that does not exist is not fine, because the card would render
   * a blank addendum on the one result that kills someone. */
  if (data.mortal != null && !isPlainObject(data.mortal)) {
    errors.push("effects.json: `mortal` is not an object");
  } else {
    for (const [anatomy, locations] of Object.entries(data.mortal ?? {})) {
      if (anatomy.startsWith("_")) continue;
      if (!ANATOMIES.includes(anatomy)) warnings.push(`effects.json: mortal.${anatomy}: unknown anatomy`);
      if (!isPlainObject(locations)) {
        errors.push(`effects.json: mortal.${anatomy} is not an object`);
        continue;
      }

      mortal[anatomy] = {};
      for (const [location, id] of Object.entries(locations)) {
        const where = `effects.json mortal.${anatomy}.${location}`;
        if (id == null) continue;
        if (!isNonEmptyString(id)) { errors.push(`${where}: must be an entry id string`); continue; }
        if (!seen.has(id)) { errors.push(`${where}: references unknown entry "${id}"`); continue; }
        mortal[anatomy][location] = id;
      }
    }
  }

  return { errors, warnings, entries, tables, mortal };
}

/**
 * Structural validation of data/fumbles.json.
 * @returns {{ errors: string[], warnings: string[], tables: object, entries: object[] }}
 */
export function validateFumbles(data) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const tables = {};

  if (!isPlainObject(data)) return { errors: ["fumbles.json: root is not an object"], warnings, tables, entries };
  if (data.version !== 1) warnings.push(`fumbles.json: version is ${data.version}, expected 1`);
  if (!Array.isArray(data.entries)) return { errors: ["fumbles.json: `entries` is not an array"], warnings, tables, entries };
  if (!isPlainObject(data.tables)) return { errors: ["fumbles.json: `tables` is not an object"], warnings, tables, entries };

  const byId = new Map();
  for (const [i, entry] of data.entries.entries()) {
    if (!isNonEmptyString(entry?.id) || !isNonEmptyString(entry?.name)) {
      errors.push(`fumbles.json entry #${i}: requires \`id\` and \`name\``);
      continue;
    }
    if (byId.has(entry.id)) { errors.push(`fumbles.json: duplicate entry id "${entry.id}"`); continue; }
    byId.set(entry.id, entry);
    entries.push(entry);
  }

  for (const [key, rows] of Object.entries(data.tables)) {
    if (key.startsWith("_")) continue; // annotation key, not a table
    if (!FUMBLE_TABLES.includes(key)) warnings.push(`fumbles.json: unknown table "${key}"`);
    if (!Array.isArray(rows)) { errors.push(`fumbles.json: table "${key}" is not an array`); continue; }

    const sorted = [...rows].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
    let expected = 1;
    let ok = true;

    for (const row of sorted) {
      const [min, max] = row?.range ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        errors.push(`fumbles.json: table "${key}" has a row with an invalid \`range\``);
        ok = false;
        continue;
      }
      if (!byId.has(row.id)) {
        errors.push(`fumbles.json: table "${key}" row ${min}-${max} references unknown entry "${row.id}"`);
        ok = false;
      }
      // A hole here means a d12 roll that resolves to nothing at the table.
      if (min !== expected) warnings.push(`fumbles.json: table "${key}" expected coverage to resume at ${expected}, found ${min}`);
      expected = max + 1;
    }

    if (expected !== 13) warnings.push(`fumbles.json: table "${key}" covers 1-${expected - 1}, expected 1-12`);
    if (ok) tables[key] = sorted;
  }

  // Absent, not merely rejected — a table that failed validation has already been reported and
  // saying "no melee table" about one that is plainly there just sends you looking in the wrong place.
  for (const key of FUMBLE_TABLES) {
    if (!(key in data.tables)) warnings.push(`fumbles.json: no "${key}" table`);
  }

  return { errors, warnings, tables, entries };
}

/**
 * Structural check of data/lethal.json (§7.4).
 *
 * Lethal entries are flavour only — no severity, no location, no outcomes — so there is very
 * little to be wrong. An empty damage type is reported but is not a defect: the content track
 * fills these unevenly.
 *
 * @returns {{ problems: string[], entries: object[] }}
 */
export function validateLethal(data) {
  const problems = [];
  const entries = [];

  if (!isPlainObject(data)) return { problems: ["lethal.json: root is not an object"], entries };
  if (data.version !== 1) problems.push(`lethal.json: version is ${data.version}, expected 1`);
  if (!Array.isArray(data.entries)) return { problems: [...problems, "lethal.json: `entries` is not an array"], entries };

  const seen = new Set();
  for (const [i, entry] of data.entries.entries()) {
    const where = `lethal.json entry #${i}${entry?.id ? ` (${entry.id})` : ""}`;

    if (!isNonEmptyString(entry?.id) || !isNonEmptyString(entry?.name)) {
      problems.push(`${where}: requires \`id\` and \`name\``);
      continue;
    }
    if (seen.has(entry.id)) { problems.push(`${where}: duplicate id`); continue; }
    if (!Array.isArray(entry.damageTypes) || entry.damageTypes.length === 0) {
      problems.push(`${where}: \`damageTypes\` must be a non-empty array`);
      continue;
    }
    for (const dt of entry.damageTypes) {
      if (!DAMAGE_TYPES.includes(dt)) problems.push(`${where}: unknown damage type "${dt}"`);
    }

    seen.add(entry.id);
    entries.push(entry);
  }

  // A damage type with no entries is NOT reported here. It is a content gap, not a structural
  // fault, and the content track fills these unevenly — reporting it on every load would print a
  // permanent "issue" that no amount of correct code can clear. `lint()` covers it instead.

  return { problems, entries };
}

/**
 * Structural check of data/anatomy.json.
 *
 * Returns a flat list of problems rather than the errors/warnings split the other two use: a
 * broken location table has no partial-credit reading — either the d12 resolves or it doesn't —
 * so there is nothing here to salvage row by row.
 *
 * @returns {string[]}
 */
export function validateAnatomy(data) {
  const problems = [];

  if (!isPlainObject(data)) return ["anatomy.json: root is not an object"];
  if (data.version !== 1) problems.push(`anatomy.json: version is ${data.version}, expected 1`);
  if (!ANATOMIES.includes(data.default?.anatomy)) problems.push("anatomy.json: `default.anatomy` must be a known anatomy");
  if (!isPlainObject(data.tables)) return [...problems, "anatomy.json: `tables` is not an object"];

  for (const anatomy of ANATOMIES) {
    const rows = data.tables[anatomy];
    if (!Array.isArray(rows)) { problems.push(`anatomy.json: no "${anatomy}" table`); continue; }

    let expected = 1;
    for (const row of [...rows].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0))) {
      const [min, max] = row?.range ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        problems.push(`anatomy.json: "${anatomy}" has a row with an invalid \`range\``);
        continue;
      }
      if (min !== expected) problems.push(`anatomy.json: "${anatomy}" expected coverage to resume at ${expected}, found ${min}`);
      expected = max + 1;

      if (!Array.isArray(row.candidates) || row.candidates.length === 0) {
        problems.push(`anatomy.json: "${anatomy}" row ${min}-${max} has no candidates`);
        continue;
      }
      for (const candidate of row.candidates) {
        if (!SLOTS.includes(candidate?.slot)) problems.push(`anatomy.json: "${anatomy}" row ${min}-${max} names unknown slot "${candidate?.slot}"`);
        if (candidate?.side && !["left", "right"].includes(candidate.side)) {
          problems.push(`anatomy.json: "${anatomy}" row ${min}-${max} has invalid side "${candidate.side}"`);
        }
        /* The two halves of the grid's shape have to agree. A slot this table can produce but
         * ANATOMY_LOCATIONS doesn't list is a hit location with no effect table behind it — the
         * one failure mode that surfaces as "nothing happened" at the table rather than as a
         * load-time complaint. */
        if (SLOTS.includes(candidate?.slot) && !ANATOMY_LOCATIONS[anatomy]?.includes(candidate.slot)) {
          problems.push(
            `anatomy.json: "${anatomy}" row ${min}-${max} can produce "${candidate.slot}", which ANATOMY_LOCATIONS does not list for it`
          );
        }
      }
    }
    if (expected !== 13) problems.push(`anatomy.json: "${anatomy}" covers 1-${expected - 1}, expected 1-12`);
  }

  // The terminal fallback has to be a slot every creature is guaranteed to have.
  const fallback = data._fallbackSlot ?? "torso";
  if (!["torso", "head"].includes(fallback)) problems.push(`anatomy.json: \`_fallbackSlot\` "${fallback}" is not a universal slot`);

  for (const [type, entry] of Object.entries(data.byCreatureType ?? {})) {
    if (!ANATOMIES.includes(entry?.anatomy)) problems.push(`anatomy.json: creature type "${type}" maps to unknown anatomy "${entry?.anatomy}"`);
    if (!Array.isArray(entry?.limbs)) problems.push(`anatomy.json: creature type "${type}" has no \`limbs\` array`);
    else for (const limb of entry.limbs) if (!SLOTS.includes(limb)) problems.push(`anatomy.json: creature type "${type}" lists unknown limb "${limb}"`);
  }

  return problems;
}
