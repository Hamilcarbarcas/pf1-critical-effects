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

export const SEVERITIES = ["minor", "moderate", "severe", "grave", "lethal"];

/** Body locations the d12 location tables can produce (§5.3). Unknown values are warned about,
 *  not rejected — content may legitimately introduce a location before the tables catch up. */
export const LOCATIONS = ["head", "torso", "arm", "leg", "wing", "tail"];

/** PF1 physical damage-type keys. */
export const DAMAGE_TYPES = ["b", "p", "s"];

export const FUMBLE_TABLES = ["melee", "bow", "thrown", "natural"];

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Structural validation of data/effects.json.
 * @returns {{ errors: string[], warnings: string[], entries: object[] }}
 *   `entries` contains only the rows that passed; a bad row is dropped, not fatal.
 */
export function validateEffects(data) {
  const errors = [];
  const warnings = [];
  const entries = [];

  if (!isPlainObject(data)) return { errors: ["effects.json: root is not an object"], warnings, entries };
  if (data.version !== 1) warnings.push(`effects.json: version is ${data.version}, expected 1`);
  if (!Array.isArray(data.entries)) return { errors: ["effects.json: `entries` is not an array"], warnings, entries };

  const seen = new Set();

  for (const [i, entry] of data.entries.entries()) {
    const where = `effects.json entry #${i}${entry?.id ? ` (${entry.id})` : ""}`;
    const problems = [];

    if (!isNonEmptyString(entry?.id)) problems.push("missing `id`");
    else if (seen.has(entry.id)) problems.push(`duplicate id "${entry.id}"`);
    if (!isNonEmptyString(entry?.name)) problems.push("missing `name`");

    if (!Array.isArray(entry?.locations) || entry.locations.length === 0) problems.push("`locations` must be a non-empty array");
    else for (const loc of entry.locations) if (!LOCATIONS.includes(loc)) warnings.push(`${where}: unknown location "${loc}"`);

    if (!Array.isArray(entry?.damageTypes) || entry.damageTypes.length === 0) problems.push("`damageTypes` must be a non-empty array");
    else for (const dt of entry.damageTypes) if (!DAMAGE_TYPES.includes(dt)) warnings.push(`${where}: unknown damage type "${dt}"`);

    if (!SEVERITIES.includes(entry?.severity)) problems.push(`\`severity\` must be one of ${SEVERITIES.join(" | ")}`);

    if (entry?.journal !== undefined && !isNonEmptyString(entry.journal)) problems.push("`journal` must be a uuid string when present");
    if (entry?.weight !== undefined && !(typeof entry.weight === "number" && entry.weight > 0)) problems.push("`weight` must be a positive number when present");
    if (entry?.outcomes !== undefined && !Array.isArray(entry.outcomes)) problems.push("`outcomes` must be an array when present");
    if (entry?.tags !== undefined && !Array.isArray(entry.tags)) problems.push("`tags` must be an array when present");
    if (entry?.anatomy !== undefined && !Array.isArray(entry.anatomy)) problems.push("`anatomy` must be an array when present");

    // "Critical effects are not negatable, though they may be mitigatable" — enforced
    // structurally: a save must replace the outcome, never delete it (§3).
    if (entry?.save !== undefined) {
      const save = entry.save;
      if (!isPlainObject(save)) problems.push("`save` must be an object when present");
      else {
        if (!["fort", "ref", "will"].includes(save.type)) problems.push("`save.type` must be fort | ref | will");
        if (!isNonEmptyString(save.dc)) problems.push("`save.dc` must be a formula string");
        if (!Array.isArray(save.onSuccess) || save.onSuccess.length === 0) {
          problems.push("`save.onSuccess` must be a non-empty outcome array — a save mitigates, it never negates");
        }
      }
    }

    if (problems.length) {
      errors.push(`${where}: ${problems.join("; ")}`);
      continue;
    }

    seen.add(entry.id);
    entries.push(entry);
  }

  return { errors, warnings, entries };
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
