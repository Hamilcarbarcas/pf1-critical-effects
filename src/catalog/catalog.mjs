/* The catalog: load and look up the effect tables (DESIGN.md §3, §4).
 *
 * Loaded once at `ready` and exposed read-only. Everything here is pure and synchronous after
 * the load — no `game.*` mutation, no dialogs, no chat (§2).
 *
 * **At runtime, effects are tables, not a pool**: one 1d12 table per damage type × anatomy × body
 * part, so a resolution is a lookup rather than a query. The Critical Power total indexes straight
 * into the row — no severity band, no weighting, no draw. `effectFor()` is the whole of it.
 *
 * The body-part axis exists only for the three weapon damage types. Everything else is
 * non-localized and has one `general` table per anatomy; `slotFor` in schema.mjs is where that is
 * decided, once, so no caller has to know which kind of damage type it is holding.
 *
 * Content is *authored* as a tagged pool (`data/pool.json`) and compiled into those tables ahead of
 * time by `tools/pool-to-tables.mjs`; fumbles work the same way from `data/fumble-pool.json`. That
 * is a build step, not a runtime one — nothing in this file has ever seen a pool.
 */

import { MODULE_ID } from "../const.mjs";
import {
  validateEffects,
  validateFumbles,
  validateAnatomy,
  validateLethal,
  ANATOMIES,
  CONDITION_IDS,
  DAMAGE_TYPES,
  GENERAL_SLOT,
  MOVEMENT_CONDITIONS,
  gridCells,
  isLocalized,
  mortalCells,
  slotFor,
} from "./schema.mjs";

/** @type {{ entries: object[], byId: Map<string, object>, tables: object, mortal: object }} */
let effects = { entries: [], byId: new Map(), tables: {}, mortal: {} };

/** @type {{ entries: object[], byId: Map<string, object>, tables: object }} */
let fumbles = { entries: [], byId: new Map(), tables: {} };

/** Anatomy defaults + the d20 band layout and humanoid table. Consumed by resolve/location.mjs. */
let anatomy = null;

/** Lethal flavour entries (§7.4) — no severity, no location, no outcomes. */
let lethal = { entries: [], byId: new Map() };

let loaded = false;


async function loadJson(file) {
  const path = `modules/${MODULE_ID}/data/${file}`;
  const response = await foundry.utils.fetchJsonWithTimeout(path);
  if (!response) throw new Error(`empty response for ${path}`);
  return response;
}

/** Load and index both catalogs. Call once, at `ready`. */
export async function loadCatalogs() {
  const problems = [];

  try {
    const raw = await loadJson("effects.json");
    const { errors, warnings, entries, tables, mortal } = validateEffects(raw);
    problems.push(...errors, ...warnings);
    effects = { entries, byId: new Map(entries.map((e) => [e.id, e])), tables, mortal };
  } catch (err) {
    problems.push(`effects.json failed to load: ${err.message}`);
  }

  try {
    const raw = await loadJson("fumbles.json");
    const { errors, warnings, tables, entries } = validateFumbles(raw);
    problems.push(...errors, ...warnings);
    fumbles = { entries, byId: new Map(entries.map((e) => [e.id, e])), tables };
  } catch (err) {
    problems.push(`fumbles.json failed to load: ${err.message}`);
  }

  try {
    anatomy = await loadJson("anatomy.json");
    problems.push(...validateAnatomy(anatomy));
  } catch (err) {
    problems.push(`anatomy.json failed to load: ${err.message}`);
  }

  try {
    const raw = await loadJson("lethal.json");
    const { problems: lethalProblems, entries } = validateLethal(raw);
    problems.push(...lethalProblems);
    lethal = { entries, byId: new Map(entries.map((e) => [e.id, e])) };
  } catch (err) {
    problems.push(`lethal.json failed to load: ${err.message}`);
  }

  loaded = true;

  if (problems.length) {
    console.error(`${MODULE_ID} | catalog loaded with ${problems.length} issue(s):\n  ${problems.join("\n  ")}`);
  }

  return { effects: effects.entries.length, fumbles: fumbles.entries.length, problems };
}

export const isLoaded = () => loaded;

/** Anatomy defaults and location tables, for resolve/location.mjs. */
export const getAnatomyData = () => anatomy;

// --- lethal (§7.4) ----------------------------------------------------------

export const getLethalEntry = (id) => lethal.byId.get(id) ?? null;

/** Every lethal flavour available for a damage type. Omit the type for all of them. */
export function lethalFor(damageType = null) {
  if (!damageType) return [...lethal.entries];
  return lethal.entries.filter((e) => e.damageTypes?.includes(damageType));
}

/**
 * Draw one lethal flavour. Returns null when nothing matches — a real outcome, not a failure:
 * the content track fills these unevenly and a damage type may legitimately have none yet.
 */
export function drawLethal(damageType = null, rng = Math.random) {
  const candidates = lethalFor(damageType);
  if (!candidates.length) return null;
  return candidates[Math.floor(rng() * candidates.length)] ?? candidates[0];
}

// --- effect pool -----------------------------------------------------------

export const getEntry = (id) => effects.byId.get(id) ?? null;
export const allEntries = () => [...effects.entries];

/** How many rows every effect table has. The Critical Power roll indexes straight into it. */
export const TABLE_ROWS = 12;

/**
 * The 12-row effect table for a damage type, anatomy and location.
 *
 * This is the whole lookup — there is no query and no draw. The content is authored as one 1d12
 * table per damage type × anatomy × body part, so the number the player rolled IS the row: 1 is
 * the mildest outcome for that location, 12 the worst.
 *
 * Anatomy is part of the key, not implied by the location: `arm` is a weapon hand on a humanoid
 * and a foreleg on a beast, and the two ladders diverge from row 1.
 *
 * **Location is only part of the key for the three weapon types.** Everything else is non-localized
 * (`isLocalized`) and has one `general` table per anatomy, so whatever location is passed is
 * ignored — `slotFor` is the single place that decision is made, which is what lets every caller
 * hand over the location it happens to have without first asking whether it means anything.
 *
 * Always 12 entries or null; unwritten rows are real placeholder entries rather than holes, so
 * callers never have to handle a gap.
 *
 * @returns {object[]|null} 12 entries, index 0 = row 1
 */
export function effectTable(damageType, anatomy, location) {
  const ids = effects.tables?.[damageType]?.[anatomy]?.[slotFor(damageType, location)];
  if (!ids?.length) return null;
  return ids.map((id) => getEntry(id));
}

/**
 * The mortal addendum — the 13+ clamp's extra text. Reads ON TOP of row 12, never instead of it,
 * which is why it is a separate lookup rather than a fourteenth row.
 *
 * **Which axes it is keyed by depends on the damage type** (see `mortalCells` in schema.mjs):
 *
 *   weapon damage    by damage type × anatomy × location — a mace, a spear and an axe end a head
 *                    three different ways, and the 13+ result exists to say which
 *   everything else  by damage type, anatomy agnostic — there is no body part to name, and burned
 *                    to ash and blasted apart are not one result
 *
 * @returns {object|null} null when unwritten — the 13+ result is then row 12 plus the save alone
 */
export function mortalFor(damageType, anatomy, location) {
  const id = isLocalized(damageType)
    ? effects.mortal?.byPart?.[damageType]?.[anatomy]?.[location]
    : effects.mortal?.byDamageType?.[damageType];
  return id ? getEntry(id) : null;
}

/**
 * Which of the fourteen outcomes a Critical Power total lands on.
 *
 * The two ends are clamped rather than being out of range, which is what makes the total
 * meaningful at both extremes (concept §2): 0 is "no effect", 13 is the save-or-die.
 */
export const optionIndexFor = (total) => {
  const value = Math.trunc(Number(total) || 0);
  return value <= 0 ? 0 : Math.min(value, TABLE_ROWS + 1);
};

/**
 * The outcome at a given index of `effectResultTable`.
 *
 * Index and total are separate arguments because the GM can override the index at the Result
 * stage (§7.2) while the total stays what was actually rolled — and the save-or-die DC is a
 * property of the ROLL, not of the row. An override up to the deadly row on a total that never
 * reached 13 takes the minimum DC rather than inventing a higher one.
 *
 * @param {string} damageType
 * @param {string} anatomy
 * @param {string} location
 * @param {number} index  0 = no effect, 1-12 = that row, 13 = row 12 + save-or-die
 * @param {number} [total]  the Critical Power roll, for the save DC
 * @returns {{ entry: object|null, row: number|null, index: number, deadly: boolean,
 *             save: object|null, mortal: object|null }|null} null when there is no table at all
 */
export function effectAt(damageType, anatomy, location, index, total = index) {
  const table = effectTable(damageType, anatomy, location);
  if (!table) return null;

  const slot = slotFor(damageType, location);

  const i = Math.max(0, Math.min(Math.trunc(Number(index) || 0), TABLE_ROWS + 1));
  if (i === 0) return { entry: null, row: null, index: 0, deadly: false, save: null, mortal: null };

  const deadly = i > TABLE_ROWS;
  const row = Math.min(i, TABLE_ROWS);

  return {
    entry: table[row - 1] ?? null,
    row,
    index: i,
    deadly,
    // "13+ will be as 12 plus Fort save DC equal to result or die."
    save: deadly ? { type: "fort", dc: Math.max(Math.trunc(Number(total) || 0), TABLE_ROWS + 1) } : null,
    // Additive to row 12, and only on the deadly index. Null when that body part has no mortal
    // written yet, which leaves the save as the whole of it.
    mortal: deadly ? mortalFor(damageType, anatomy, slot) : null,
  };
}

/**
 * The entry a Critical Power total lands on, with no GM override in play.
 *
 * @param {number} total  the Critical Power roll plus modifiers
 * @returns {{ entry: object|null, row: number|null, index: number, deadly: boolean,
 *             save: object|null, mortal: object|null }|null}
 */
export function effectFor(damageType, anatomy, location, total) {
  return effectAt(damageType, anatomy, location, optionIndexFor(total), total);
}

/** The label the 13+ row carries, both on the roll request and in the GM's override list. The
 *  mortal addendum's name displaces row 12's when the body part has one written. */
export const deadlyLabel = (name, mortalName = null) =>
  `${mortalName ?? name ?? "As row 12"} + Fort save (DC = total) or die`;

/**
 * The effect table as the fourteen outcomes a Critical Power total can produce.
 *
 * Twelve rows, plus the two clamped ends that `effectFor` implements — "no effect" below and the
 * save-or-die above. Fourteen entries is the whole outcome space, which is why one list serves
 * both the roll request the player sees and the override dropdown the GM adjusts it with: the
 * index into this list IS the result.
 *
 * Rows are thresholds for roll-requests (see `locationOptions`), so the lowest carries no `min`.
 *
 * @returns {{ min?: number, label: string }[]|null} 14 rows, or null when there is no such table
 */
export function effectResultTable(damageType, anatomy, location) {
  const table = effectTable(damageType, anatomy, location);
  if (!table) return null;

  const rows = [{ label: "No effect" }];
  table.forEach((entry, index) => rows.push({ min: index + 1, label: entry?.name ?? `Row ${index + 1}` }));
  rows.push({
    min: TABLE_ROWS + 1,
    label: deadlyLabel(table.at(-1)?.name, mortalFor(damageType, anatomy, slotFor(damageType, location))?.name),
  });

  return rows;
}

/** Damage types that have tables, for a picker. */
export const effectDamageTypes = () => Object.keys(effects.tables ?? {}).sort();

/** Locations that have a table under a damage type and anatomy, for a picker. */
export const effectLocations = (damageType, anatomy) =>
  Object.keys(effects.tables?.[damageType]?.[anatomy] ?? {}).sort();

// --- fumbles ---------------------------------------------------------------

export const getFumbleEntry = (id) => fumbles.byId.get(id) ?? null;
export const getFumbleTable = (key) => fumbles.tables[key] ?? null;
export const fumbleTableKeys = () => Object.keys(fumbles.tables);

/** Resolve a d12 total against a fumble table. */
export function drawFumble(tableKey, total) {
  const rows = fumbles.tables[tableKey];
  if (!rows) return null;
  const row = rows.find(({ range: [min, max] }) => total >= min && total <= max);
  return row ? getFumbleEntry(row.id) : null;
}

/**
 * A fumble table shaped for pf1-roll-requests' `resultTable`.
 *
 * Its rows are THRESHOLDS, not ranges: each covers from its `min` up to the next row's
 * `min - 1`, which is why a table cannot contain a gap (see roll-requests api.md). Our rows are
 * contiguous 1-12 by construction, so the conversion is just "take the low end of each range".
 */
export function fumbleResultTable(tableKey) {
  const rows = fumbles.tables[tableKey];
  if (!rows) return null;
  return rows.map(({ range: [min], id }) => ({
    min,
    label: getFumbleEntry(id)?.name ?? id,
  }));
}

// --- lint ------------------------------------------------------------------

/**
 * Dev-only content report (§3). Everything reported is a warning — nothing here stops the module
 * working.
 *
 * The journal-drift checks this used to lead with are gone with the journals (v5): prose lives in
 * the catalog now, so there is no second document to fall out of step with. What replaced them is
 * **condition drift**, which is the same class of problem one layer down — `CONDITION_IDS` in
 * schema.mjs is a written-out copy of PF1's registry, kept static because the Node build tools
 * import that module and have no `pf1` global. A system update that renames or drops a condition
 * is reported here rather than discovered when a critical silently fails to apply.
 */
export async function lint() {
  const report = {
    conditions: { unknownToPf1: [], used: {}, bleedWithoutModule: [] },
    mechanics: { damage: 0, saves: 0, savesWithoutBranch: [], damageTypesUnknownToPf1: [] },
    tables: { written: 0, placeholder: 0, percent: 0, missing: [], byTable: {} },
    mortal: { written: 0, of: 0, missing: [] },
    fumbles: { unreferencedEntries: [] },
    lethal: { byDamageType: {}, emptyDamageTypes: [] },
  };

  /* Every condition any catalog inflicts, checked against the live registry and counted. The count
   * is the useful half day to day: it is how you notice that six entries impose `staggered` and
   * none impose `sickened`. */
  const bleedLive = !!game.modules.get("pf1-bleed-effects")?.active;
  for (const entry of [...effects.entries, ...fumbles.entries, ...lethal.entries]) {
    for (const condition of entry.conditions ?? []) {
      report.conditions.used[condition.id] = (report.conditions.used[condition.id] ?? 0) + 1;

      if (!pf1.registry.conditions.get(condition.id)) {
        report.conditions.unknownToPf1.push({ id: entry.id, condition: condition.id });
      }
      /* Not a defect — an inert bleed marker is exactly what PF1 alone provides, and the entry is
       * written to degrade to it. Reported because "the bleed did nothing" is otherwise a puzzle
       * with no visible cause. */
      if (condition.id === "bleed" && condition.bleed && !bleedLive) {
        report.conditions.bleedWithoutModule.push(entry.id);
      }
    }
  }

  /* The v6 channels, counted the same way and for the same reason — the useful figure is how much
   * of the grid has grown mechanics, not whether any one entry is well-formed (the validator has
   * already said so at load).
   *
   * The damage-type check is the exact counterpart of the condition drift check above:
   * `DAMAGE_PART_TYPES` is a static list in a module that cannot see `pf1.registry.damageTypes`,
   * so a type PF1 does not recognise is reported here rather than discovered as an instance that
   * silently applied as untyped. */
  for (const entry of [...effects.entries, ...fumbles.entries]) {
    for (const branch of [entry, entry.onFail]) {
      for (const part of branch?.damage ?? []) {
        report.mechanics.damage += 1;
        if (!pf1.registry.damageTypes.get(part.type)) {
          report.mechanics.damageTypesUnknownToPf1.push({ id: entry.id, type: part.type });
        }
      }
    }
    if (entry.save != null) {
      report.mechanics.saves += 1;
      if (entry.onFail == null) report.mechanics.savesWithoutBranch.push(entry.id);
    }
  }

  /* The other direction: conditions PF1 knows about that our static list does not. Catches a
   * system update that ADDS one, which is otherwise invisible until an author tries to use it and
   * the validator rejects a perfectly good id. */
  for (const condition of pf1.registry.conditions) {
    if (!CONDITION_IDS.includes(condition.id) && !MOVEMENT_CONDITIONS.includes(condition.id)) {
      report.conditions.unknownToPf1.push({ id: "(schema.mjs)", condition: `${condition.id} — in PF1, missing from CONDITION_IDS` });
    }
  }

  /* Table coverage is the content track's progress metric: every table is 12 rows by construction,
   * so what matters is how many of those rows are still placeholders. Reported per table, because
   * "60% written" is far less actionable than "slashing/beast/wing is entirely unwritten".
   *
   * The grid is walked from gridCells() rather than from what the file happens to contain, so a
   * table that is absent altogether counts against the total instead of quietly shrinking the
   * denominator — and a non-localized damage type contributes its three `general` tables rather
   * than thirteen body parts it never rolls for. */
  for (const { damageType, anatomy, location } of gridCells()) {
    const key = `${damageType}/${anatomy}/${location}`;
    const ids = effects.tables?.[damageType]?.[anatomy]?.[location];

    if (!ids) {
      report.tables.missing.push(key);
      report.tables.placeholder += TABLE_ROWS;
      continue;
    }

    const written = ids.filter((id) => !getEntry(id)?.placeholder).length;
    report.tables.byTable[key] = { written, of: ids.length };
    report.tables.written += written;
    report.tables.placeholder += ids.length - written;
  }
  const totalRows = report.tables.written + report.tables.placeholder;
  report.tables.percent = totalRows ? Math.round((report.tables.written / totalRows) * 100) : 0;

  /* Mortal's two halves are keyed by different axes, so the walk asks each cell its own question:
   * a body-part cell carries its own damage type, a damage-type cell is looked up through any
   * anatomy. `mortalCells` is what keeps that asymmetry in one place. */
  for (const cell of mortalCells()) {
    report.mortal.of += 1;
    const written =
      cell.kind === "part"
        ? mortalFor(cell.damageType, cell.anatomy, cell.location)
        : mortalFor(cell.damageType, ANATOMIES[0], GENERAL_SLOT);
    if (written) report.mortal.written += 1;
    else report.mortal.missing.push(cell.key);
  }

  const usedByTable = new Set(Object.values(fumbles.tables).flat().map((r) => r.id));
  for (const entry of fumbles.entries) {
    if (!usedByTable.has(entry.id)) report.fumbles.unreferencedEntries.push(entry.id);
  }

  // Lethal coverage: a progress metric for the content track, which is why it lives here rather
  // than in the load-time validation.
  for (const type of DAMAGE_TYPES) {
    const count = lethalFor(type).length;
    report.lethal.byDamageType[type] = count;
    if (count === 0) report.lethal.emptyDamageTypes.push(type);
  }

  console.error(`${MODULE_ID} | lint:`, report);
  return report;
}
