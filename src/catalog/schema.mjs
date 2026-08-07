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

/**
 * Which locations each anatomy can actually be hit in — the effect grid's real shape.
 *
 * Derived from what the three d20 location layouts can produce, and the reason the grid is 13
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

/**
 * Every (anatomy, location) pair a damage type's tables cover, in a stable order.
 *
 * Omit `damageType` for the **localized** shape — the 13 body-part pairs, which is what `mortal`
 * and the location layer are built on. Pass one and a non-localized type answers with its three
 * `general` pairs instead (see `LOCALIZED_DAMAGE_TYPES`).
 */
export const anatomyLocationPairs = (damageType = null) =>
  Object.entries(ANATOMY_LOCATIONS).flatMap(([anatomy, locations]) =>
    (damageType === null ? locations : slotsFor(damageType, anatomy)).map((location) => ({ anatomy, location }))
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
 * Narrower than PF1's registry on purpose: `untyped`, `precision`, `nonlethal` and `areaOfEffect`
 * describe how damage is dealt rather than what it does to a body, and there is no table for them.
 * `force` is in, and follows the energy types in every respect — no hit location, its own mortal.
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
  "force",
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
  force: "Force",
  positive: "Positive Energy",
  negative: "Negative Energy",
};

/** The list a `<select>` wants. */
export const damageTypeOptions = () =>
  DAMAGE_TYPES.map((key) => ({ key, label: DAMAGE_TYPE_LABELS[key] ?? key }));

/**
 * The damage types whose effects depend on WHERE they landed — the three weapon types.
 *
 * Everything else (fire, cold, electric, acid, sonic, force, positive, negative) is
 * **non-localized**: it arrives as an area or a wash rather than as a blow, so there is no body part
 * to roll for and no called shot to make. Those types still vary by anatomy — a fire critical does
 * something different to a humanoid than to an ooze — so the grid keeps its anatomy axis and drops
 * only the location one, collapsing to a single `general` table per anatomy.
 *
 * This is a **rules** distinction, not a data-shape one: keeping it named here rather than
 * inferring it from which tables happen to exist is what stops "this type has no arm table" and
 * "this type has no arms" from being the same statement.
 */
export const LOCALIZED_DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing"];

/** Does this damage type roll for a hit location? Unknown and absent types read as non-localized. */
export const isLocalized = (damageType) => LOCALIZED_DAMAGE_TYPES.includes(damageType);

/**
 * The one pseudo-location a non-localized damage type's tables live under.
 *
 * Deliberately NOT in `LOCATIONS` or `SLOTS`: no location table can ever produce it, and nothing
 * in `resolve/location.mjs` knows it exists. It is a table key, not a body part — which is what
 * keeps the catalog's shape uniform (`tables[dt][anatomy][slot]`) without pretending a fire
 * critical hit someone's leg.
 */
export const GENERAL_SLOT = "general";

/** Which slots a damage type's tables cover for one anatomy: the body parts, or just `general`. */
export const slotsFor = (damageType, anatomy) =>
  isLocalized(damageType) ? (ANATOMY_LOCATIONS[anatomy] ?? []) : [GENERAL_SLOT];

/**
 * The table key a lookup should use.
 *
 * The single normalization point for the whole engine: a caller may hand over whatever location it
 * has — a rolled one, a stale one, or none — and a non-localized damage type answers `general`
 * regardless. That is why `effectFor("fire", "beast", "wing", 7)` is not a bug, it is a lookup that
 * quietly ignores an axis that does not apply.
 */
export const slotFor = (damageType, location) => (isLocalized(damageType) ? (location ?? null) : GENERAL_SLOT);

/** Every (damage type, anatomy, location) cell of the effect grid — 63 tables, 756 rows. */
export const gridCells = () =>
  DAMAGE_TYPES.flatMap((damageType) =>
    anatomyLocationPairs(damageType).map((pair) => ({ damageType, ...pair }))
  );

/** The non-localized damage types, in DAMAGE_TYPES order. Each keeps one mortal row. */
export const generalDamageTypes = () => DAMAGE_TYPES.filter((dt) => !isLocalized(dt));

/**
 * Every cell `mortal` covers, and the two are keyed by **different axes** — which is the whole of
 * what makes mortal awkward and is why it is enumerated here rather than derived at each use.
 *
 * | | Keyed by | Agnostic to | Count |
 * |---|---|---|---|
 * | `part` | anatomy × location | damage type | 13 |
 * | `damageType` | damage type | anatomy | 8 |
 *
 * The asymmetry is a rules judgement, not an oversight. For a weapon wound, past row 12 the injury
 * has stopped being characterised by what made it — a torn-off arm is a torn-off arm whether a
 * sword or a mace did it — so the body part is what is left to name. For non-localized damage there
 * is no body part to name and the *damage type* is the whole of what distinguishes it: burned to
 * ash and blasted apart are not one result. Anatomy drops out on that side because a mortal fire
 * result is the same story for a humanoid and a beast.
 *
 * @returns {{ kind: "part"|"damageType", key: string, anatomy?: string, location?: string,
 *             damageType?: string }[]}
 */
export const mortalCells = () => [
  ...anatomyLocationPairs().map(({ anatomy, location }) => ({
    kind: "part",
    key: `${anatomy}/${location}`,
    anatomy,
    location,
  })),
  ...generalDamageTypes().map((damageType) => ({ kind: "damageType", key: damageType, damageType })),
];

/**
 * The six fumble tables, keyed by how the attack was delivered.
 *
 * `bows` and `crossbows` are separate because PF1's own weapon groups are (`pf1.config.weaponGroups`)
 * and because they fail differently — a bowstring snaps, a crossbow's mechanism jams. `unarmed` and
 * `natural` are likewise distinct: a natural attack is a claw or a bite, an unarmed strike is a
 * person's fist, and "you break a finger" only reads for one of them.
 */
export const FUMBLE_TABLES = ["melee", "thrown", "bows", "crossbows", "unarmed", "natural"];

/**
 * Rows in a fumble table. A d20, unlike the effect tables' d12.
 *
 * The two ladders are not the same scale and are not meant to be: an effect table's twelve rows
 * run from a bruise to a mortal wound, while a fumble table's twenty are **unordered peers** — all
 * equally likely, none worse than another, the die picking flavour rather than severity. Fumbles
 * never threaten mortal peril (concept doc §2), so there is nothing for a severity ladder to
 * measure and fumble pool entries carry no rank.
 */
export const FUMBLE_ROWS = 20;

export const ANATOMIES = ["humanoid", "beast", "aberrant"];

/**
 * Body parts a d20 location table row may name (§5.3) — every location the effect grid's localized
 * half is keyed by. `appendage` is what the aberrant table produces and is a location in its own
 * right, not a synonym for `arm`.
 *
 * `GENERAL_SLOT` is deliberately absent: it is a table key for the damage types that never roll
 * here at all.
 */
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
 * twelve rows even though they share a slot name. There is no inheritance between anatomies in the
 * data — every table is written out in full.
 *
 * **Location is a dimension only for the three weapon types** (v4). A non-localized damage type
 * arrives as a wash rather than as a blow, so it keeps the anatomy axis and drops the location one:
 * its tables live under the single `general` slot. The grid is therefore 3 localized types × 13
 * anatomy/location pairs, plus 8 non-localized types × 3 anatomies — 63 tables, 756 rows.
 * `gridCells()` is the definition of it, and `slotsFor()` is the per-cell shape.
 *
 * **12 rows is an invariant, not a convention.** The resolution indexes into the table with a
 * clamped roll and never checks for a hole, so a short table is an error here rather than a
 * surprise at the table. Unwritten content is expressed as `placeholder: true` entries, which
 * keeps the invariant true while `lint()` reports how much is still to author.
 *
 * `mortal` is the 13+ addendum, read on top of row 12 rather than instead of it, and it has **two
 * halves keyed by different axes** (see `mortalCells`): `mortal.byPart[anatomy][location]` for the
 * weapon types, `mortal.byDamageType[damageType]` for everything else. Optional throughout: an
 * absent entry leaves the 13+ result as "row 12 plus the Fort save", which is what the rules said
 * before any of them were written.
 *
 * @returns {{ errors: string[], warnings: string[], entries: object[], tables: object,
 *             mortal: object }}
 */
export function validateEffects(data) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const tables = {};
  const mortal = { byPart: {}, byDamageType: {} };

  const bail = (message) => ({ errors: [...errors, message], warnings, entries, tables, mortal });

  if (!isPlainObject(data)) return bail("effects.json: root is not an object");
  if (data.version !== 4) warnings.push(`effects.json: version is ${data.version}, expected 4`);
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
        /* Harmless but dead: nothing can ever ask for these twelve rows. Two ways to get there —
         * a body part this anatomy does not have, or any body part at all under a damage type
         * that does not roll for one. */
        if (!slotsFor(damageType, anatomy).includes(location)) {
          warnings.push(
            isLocalized(damageType)
              ? `${where}: a ${anatomy} is never hit in the ${location}; this table is unreachable`
              : `${where}: ${damageType} does not roll for a location, so only "${GENERAL_SLOT}" is read; this table is unreachable`
          );
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

  /* Mortal: optional entry ids, in two halves keyed by different axes (see mortalCells). Missing is
   * fine and silent — the 13+ clamp degrades to "row 12 plus the save", which is the rule as
   * written. A mortal pointing at an entry that does not exist is NOT fine, because the card would
   * render a blank addendum on the one result that kills someone. */
  const readMortalId = (id, where) => {
    if (id == null) return null;
    if (!isNonEmptyString(id)) { errors.push(`${where}: must be an entry id string`); return null; }
    if (!seen.has(id)) { errors.push(`${where}: references unknown entry "${id}"`); return null; }
    return id;
  };

  if (data.mortal != null && !isPlainObject(data.mortal)) {
    errors.push("effects.json: `mortal` is not an object");
  } else {
    const byPart = data.mortal?.byPart;
    if (byPart != null && !isPlainObject(byPart)) {
      errors.push("effects.json: `mortal.byPart` is not an object");
    } else {
      for (const [anatomy, locations] of Object.entries(byPart ?? {})) {
        if (anatomy.startsWith("_")) continue;
        if (!ANATOMIES.includes(anatomy)) warnings.push(`effects.json: mortal.byPart.${anatomy}: unknown anatomy`);
        if (!isPlainObject(locations)) {
          errors.push(`effects.json: mortal.byPart.${anatomy} is not an object`);
          continue;
        }

        mortal.byPart[anatomy] = {};
        for (const [location, id] of Object.entries(locations)) {
          const where = `effects.json mortal.byPart.${anatomy}.${location}`;
          /* The half that is keyed by body part is the LOCALIZED half. `general` here would be a
           * mortal nothing can reach: the non-localized types read the other map entirely. */
          if (location === GENERAL_SLOT) {
            warnings.push(`${where}: non-localized damage reads mortal.byDamageType, so this entry is unreachable`);
          }
          const entryId = readMortalId(id, where);
          if (entryId) mortal.byPart[anatomy][location] = entryId;
        }
      }
    }

    const byDamageType = data.mortal?.byDamageType;
    if (byDamageType != null && !isPlainObject(byDamageType)) {
      errors.push("effects.json: `mortal.byDamageType` is not an object");
    } else {
      for (const [damageType, id] of Object.entries(byDamageType ?? {})) {
        if (damageType.startsWith("_")) continue;
        const where = `effects.json mortal.byDamageType.${damageType}`;
        if (!DAMAGE_TYPES.includes(damageType)) warnings.push(`${where}: unknown damage type`);
        else if (isLocalized(damageType)) {
          warnings.push(`${where}: ${damageType} rolls a location, so its mortal comes from mortal.byPart; this entry is unreachable`);
        }
        const entryId = readMortalId(id, where);
        if (entryId) mortal.byDamageType[damageType] = entryId;
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
  if (data.version !== 2) warnings.push(`fumbles.json: version is ${data.version}, expected 2`);
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

    if (expected !== FUMBLE_ROWS + 1) {
      warnings.push(`fumbles.json: table "${key}" covers 1-${expected - 1}, expected 1-${FUMBLE_ROWS}`);
    }
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
 * broken location table has no partial-credit reading — either the d20 resolves or it doesn't —
 * so there is nothing here to salvage row by row.
 *
 * Since v2 only humanoid is a written table; beast and aberrant are generated from the creature's
 * own layout (resolve/location.mjs). So this checks two different things: the humanoid table row
 * by row, and the PARAMETERS the generator works from — the bands, the category order, and the
 * appendage cap — because a bad band leaves a hole in every generated table at once.
 *
 * @returns {string[]}
 */
export function validateAnatomy(data) {
  const problems = [];

  if (!isPlainObject(data)) return ["anatomy.json: root is not an object"];
  if (data.version !== 2) problems.push(`anatomy.json: version is ${data.version}, expected 2`);
  if (!ANATOMIES.includes(data.default?.anatomy)) problems.push("anatomy.json: `default.anatomy` must be a known anatomy");

  const die = data.die;
  if (!Number.isInteger(die) || die < 2) problems.push(`anatomy.json: \`die\` must be an integer face count, found ${die}`);

  /* The bands have to tile 1..die with no gap and no overlap, in this order: a hole here is a roll
   * that resolves to no body part at all. */
  const bands = data.bands;
  if (!isPlainObject(bands)) {
    problems.push("anatomy.json: `bands` is not an object");
  } else {
    let expected = 1;
    for (const key of ["limbs", "torso", "head"]) {
      const [min, max] = bands[key] ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        problems.push(`anatomy.json: band "${key}" is not a valid [min, max]`);
        expected = null;
        continue;
      }
      if (expected !== null && min !== expected) {
        problems.push(`anatomy.json: band "${key}" starts at ${min}, expected ${expected}`);
      }
      expected = max + 1;
    }
    if (expected !== null && Number.isInteger(die) && expected !== die + 1) {
      problems.push(`anatomy.json: bands cover 1-${expected - 1}, expected 1-${die}`);
    }
  }

  const order = data.beastOrder;
  if (!Array.isArray(order) || !order.length) {
    problems.push("anatomy.json: `beastOrder` must be a non-empty array of slots");
  } else {
    for (const slot of order) {
      if (!SLOTS.includes(slot)) problems.push(`anatomy.json: \`beastOrder\` names unknown slot "${slot}"`);
      /* The two halves of the grid's shape have to agree. A slot the generator can produce but
       * ANATOMY_LOCATIONS doesn't list is a hit location with no effect table behind it — the one
       * failure mode that surfaces as "nothing happened" at the table rather than as a load-time
       * complaint. */
      else if (!ANATOMY_LOCATIONS.beast?.includes(slot)) {
        problems.push(`anatomy.json: \`beastOrder\` can produce "${slot}", which ANATOMY_LOCATIONS does not list for beast`);
      }
    }
  }

  if (!ANATOMY_LOCATIONS.aberrant?.includes("appendage")) {
    problems.push("anatomy.json: aberrant layouts produce \"appendage\", which ANATOMY_LOCATIONS does not list for aberrant");
  }

  /* Every count up to the cap has to divide the limb band evenly, or some appendage silently gets
   * a wider slice than its neighbour. The generator handles a remainder rather than breaking, so
   * this is a warning about the layout being lopsided, not about it being invalid. */
  const cap = data.maxAppendages;
  const faces = Array.isArray(bands?.limbs) ? bands.limbs[1] - bands.limbs[0] + 1 : null;
  if (!Number.isInteger(cap) || cap < 1) {
    problems.push(`anatomy.json: \`maxAppendages\` must be a positive integer, found ${cap}`);
  } else if (Number.isInteger(faces)) {
    for (let n = 1; n <= cap; n++) {
      if (faces % n) problems.push(`anatomy.json: ${faces} limb faces do not divide evenly by ${n}, so a ${n}-appendage layout is lopsided`);
    }
  }

  // The terminal fallback has to be a slot every creature is guaranteed to have.
  const fallback = data._fallbackSlot ?? "torso";
  if (!["torso", "head"].includes(fallback)) problems.push(`anatomy.json: \`_fallbackSlot\` "${fallback}" is not a universal slot`);

  // Only humanoid is written out; the other two have no table to check.
  if (!isPlainObject(data.tables)) return [...problems, "anatomy.json: `tables` is not an object"];

  const rows = data.tables.humanoid;
  if (!Array.isArray(rows)) {
    problems.push("anatomy.json: no \"humanoid\" table");
  } else {
    let expected = 1;
    for (const row of [...rows].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0))) {
      const [min, max] = row?.range ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        problems.push("anatomy.json: \"humanoid\" has a row with an invalid `range`");
        continue;
      }
      if (min !== expected) problems.push(`anatomy.json: "humanoid" expected coverage to resume at ${expected}, found ${min}`);
      expected = max + 1;

      if (!SLOTS.includes(row.slot)) problems.push(`anatomy.json: "humanoid" row ${min}-${max} names unknown slot "${row.slot}"`);
      else if (!ANATOMY_LOCATIONS.humanoid?.includes(row.slot)) {
        problems.push(`anatomy.json: "humanoid" row ${min}-${max} can produce "${row.slot}", which ANATOMY_LOCATIONS does not list for it`);
      }
    }
    if (Number.isInteger(die) && expected !== die + 1) {
      problems.push(`anatomy.json: "humanoid" covers 1-${expected - 1}, expected 1-${die}`);
    }
  }

  for (const [type, entry] of Object.entries(data.byCreatureType ?? {})) {
    if (!ANATOMIES.includes(entry?.anatomy)) problems.push(`anatomy.json: creature type "${type}" maps to unknown anatomy "${entry?.anatomy}"`);

    // Both lists are optional — a humanoid type needs neither — but a present one must be usable.
    if (entry?.beastLimbs != null) {
      if (!Array.isArray(entry.beastLimbs)) problems.push(`anatomy.json: creature type "${type}" has a non-array \`beastLimbs\``);
      else for (const limb of entry.beastLimbs) {
        if (!Array.isArray(order) || !order.includes(limb)) problems.push(`anatomy.json: creature type "${type}" lists "${limb}", which is not in \`beastOrder\``);
      }
    }
    if (entry?.appendages != null) {
      if (!Array.isArray(entry.appendages)) problems.push(`anatomy.json: creature type "${type}" has a non-array \`appendages\``);
      else if (Number.isInteger(cap) && entry.appendages.length > cap) {
        problems.push(`anatomy.json: creature type "${type}" lists ${entry.appendages.length} appendages, more than \`maxAppendages\` (${cap})`);
      }
    }
  }

  return problems;
}
