/* The catalog: load, index and query the effect pool (DESIGN.md §3, §4).
 *
 * Loaded once at `ready` and exposed read-only. Everything here is pure and synchronous after
 * the load — no `game.*` mutation, no dialogs, no chat (§2). `query()` returns candidates;
 * `draw()` is a separate call so the GM can see the pool and re-roll against it.
 */

import { MODULE_ID } from "../const.mjs";
import { validateEffects, validateFumbles } from "./schema.mjs";

/** @type {{ entries: object[], byId: Map<string, object>, index: Map<string, object[]> }} */
let effects = { entries: [], byId: new Map(), index: new Map() };

/** @type {{ entries: object[], byId: Map<string, object>, tables: object }} */
let fumbles = { entries: [], byId: new Map(), tables: {} };

let loaded = false;

const bucketKey = (location, damageType, severity) => `${location}|${damageType}|${severity}`;

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
    const { errors, warnings, entries } = validateEffects(raw);
    problems.push(...errors, ...warnings);

    const byId = new Map();
    const index = new Map();
    for (const entry of entries) {
      byId.set(entry.id, entry);
      // An entry is inclusive across locations and damage types — one Knocked Prone serves
      // torso and leg, bludgeoning and slashing — so it lands in every bucket it covers (§3).
      for (const location of entry.locations) {
        for (const damageType of entry.damageTypes) {
          const key = bucketKey(location, damageType, entry.severity);
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(entry);
        }
      }
    }
    effects = { entries, byId, index };
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

  loaded = true;

  if (problems.length) {
    console.error(`${MODULE_ID} | catalog loaded with ${problems.length} issue(s):\n  ${problems.join("\n  ")}`);
  }

  return { effects: effects.entries.length, fumbles: fumbles.entries.length, problems };
}

export const isLoaded = () => loaded;

// --- effect pool -----------------------------------------------------------

export const getEntry = (id) => effects.byId.get(id) ?? null;
export const allEntries = () => [...effects.entries];

/**
 * Candidates for a resolved location / damage type / severity.
 * @param {object} opts
 * @param {string} opts.location
 * @param {string} opts.damageType
 * @param {string} opts.severity
 * @param {string[]} [opts.tags]     require all of these tags
 * @param {string} [opts.anatomy]    exclude entries gated to other anatomies
 * @returns {object[]}
 */
export function query({ location, damageType, severity, tags = [], anatomy = null } = {}) {
  let candidates = effects.index.get(bucketKey(location, damageType, severity)) ?? [];

  if (anatomy) candidates = candidates.filter((e) => !e.anatomy || e.anatomy.includes(anatomy));
  if (tags.length) candidates = candidates.filter((e) => tags.every((t) => e.tags?.includes(t)));

  return [...candidates];
}

/**
 * Weighted pick from a candidate list. Separate from `query` so a caller can show the pool,
 * draw, and re-draw without re-querying.
 * @param {object[]} candidates
 * @param {() => number} [rng]  injectable for testing; defaults to Math.random
 */
export function draw(candidates, rng = Math.random) {
  if (!candidates?.length) return null;

  const total = candidates.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  let roll = rng() * total;
  for (const entry of candidates) {
    roll -= entry.weight ?? 1;
    if (roll <= 0) return entry;
  }
  return candidates[candidates.length - 1];
}

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
 * Dev-only content report (§3, "Journals <-> catalog drift"). The catalog references journals by
 * uuid and the two are edited separately, so they will drift; this is what keeps the content
 * track honest. Everything reported is a warning — nothing here stops the module working.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.knownOutcomeTypes]  registered handler types; unregistered types in
 *   the catalog are reported. Defaults to the live registry once one exists (phase 5).
 * @param {number} [opts.thinBucket]  bucket size at or below which a bucket is called thin.
 */
export async function lint({ knownOutcomeTypes = null, thinBucket = 3 } = {}) {
  const report = {
    deadJournals: [],
    unreferencedJournals: [],
    thinBuckets: [],
    unknownOutcomeTypes: [],
    outcomeCoverage: { withOutcomes: 0, total: 0, percent: 0 },
    fumbles: { deadJournals: [], unreferencedEntries: [] },
  };

  const types = knownOutcomeTypes ?? game.criticalEffects?.outcomes?.registeredTypes?.() ?? null;
  const referenced = new Set();

  const checkJournal = async (uuid) => {
    if (!uuid) return true;
    referenced.add(uuid);
    return !!(await fromUuid(uuid));
  };

  for (const entry of effects.entries) {
    if (!(await checkJournal(entry.journal))) report.deadJournals.push({ id: entry.id, uuid: entry.journal });

    report.outcomeCoverage.total += 1;
    if (entry.outcomes?.length) {
      report.outcomeCoverage.withOutcomes += 1;
      if (types) {
        for (const outcome of entry.outcomes) {
          if (!types.includes(outcome?.type)) report.unknownOutcomeTypes.push({ id: entry.id, type: outcome?.type });
        }
      }
    }
  }

  const { total, withOutcomes } = report.outcomeCoverage;
  report.outcomeCoverage.percent = total ? Math.round((withOutcomes / total) * 100) : 0;

  for (const [key, bucket] of effects.index) {
    if (bucket.length <= thinBucket) report.thinBuckets.push({ bucket: key, count: bucket.length });
  }

  for (const entry of fumbles.entries) {
    if (!(await checkJournal(entry.journal))) report.fumbles.deadJournals.push({ id: entry.id, uuid: entry.journal });
    // Duplicate journals collapsed by tools/tables-to-json.mjs are expected to be unreferenced.
    for (const dup of entry.duplicateJournals ?? []) referenced.add(dup);
  }

  const usedByTable = new Set(Object.values(fumbles.tables).flat().map((r) => r.id));
  for (const entry of fumbles.entries) {
    if (!usedByTable.has(entry.id)) report.fumbles.unreferencedEntries.push(entry.id);
  }

  // Journals in the pack that no catalog entry points at.
  const pack = game.packs.get(`${MODULE_ID}.critical-effects`);
  if (pack) {
    const index = pack.index ?? (await pack.getIndex());
    for (const journal of index) {
      const uuid = `Compendium.${MODULE_ID}.critical-effects.JournalEntry.${journal._id}`;
      if (!referenced.has(uuid)) report.unreferencedJournals.push({ name: journal.name, uuid });
    }
  }

  console.error(`${MODULE_ID} | lint:`, report);
  return report;
}
