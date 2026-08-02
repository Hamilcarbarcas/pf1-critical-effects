#!/usr/bin/env node
/* tables-to-json — one-off transcription of the Fumble RollTables into data/fumbles.json
 *
 * The RollTables in packs-source/critical-tables stay as GM-facing browsable content; the
 * fumble flow draws from JSON so it can attach outcomes, reason about bands, and run without
 * a compendium round-trip (DESIGN.md §4).
 *
 * The three shipped tables (Bow / Melee / Thrown) each carry their own copy of every journal
 * — "Dislocated Elbow" exists three times, with three UUIDs and identical prose. This tool
 * collapses them: one `entries` row per distinct effect name, with the tables referencing it
 * by id. Duplicate journals are left in the pack; `lint()` reports them as unreferenced.
 *
 * Usage:  node tools/tables-to-json.mjs [--write]
 * Without --write it prints the JSON to stdout and changes nothing.
 *
 * The `natural` table is NOT generated here — no such RollTable exists. It is authored by
 * hand in data/fumbles.json and this tool preserves it across re-runs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE_DIR = path.join(ROOT, "packs-source", "critical-tables", "Critical_Tables_z7PvpigOgvVDTBtl");
const OUT = path.join(ROOT, "data", "fumbles.json");

/** Which RollTable file feeds which table key. Order matters: the first table to
 *  introduce an effect name donates its journal UUID as the canonical one. */
const SOURCES = [
  { key: "melee", file: "Fumble___Melee_P6YNu9DxGQJx5Ux1.yml" },
  { key: "bow", file: "Fumble___Bow_ieggqcvMCzBMIx2L.yml" },
  { key: "thrown", file: "Fumble___Thrown_mNOVVbSb4YEycTMM.yml" },
];

/** js-yaml lives in the workspace's pack-tools install rather than here — this is a dev-only
 *  script and the module ships no node dependencies of its own. Falls back to resolving the
 *  package from pack-tools' node_modules when it isn't installed locally. */
async function loadYaml() {
  try {
    const mod = await import("js-yaml");
    return mod.default ?? mod;
  } catch { /* not installed here — fall through */ }

  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(path.join(ROOT, "..", "pack-tools", "package.json"));
    return require("js-yaml");
  } catch { /* fall through to the error below */ }

  throw new Error("js-yaml not found. Run `npm install js-yaml` here, or work from a checkout that has pack-tools/node_modules alongside this module.");
}

const slug = (name) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const yaml = await loadYaml();

  /** id -> entry. Populated in SOURCES order, so the first table wins the journal UUID. */
  const entries = new Map();
  const tables = {};
  const warnings = [];

  for (const { key, file } of SOURCES) {
    const full = path.join(TABLE_DIR, file);
    if (!fs.existsSync(full)) throw new Error(`Missing source table: ${full}`);
    const doc = yaml.load(fs.readFileSync(full, "utf8"));

    if (doc.formula !== "1d12") warnings.push(`${key}: formula is "${doc.formula}", expected "1d12"`);

    const rows = [];
    for (const result of doc.results ?? []) {
      const name = String(result.name ?? "").trim();
      if (!name) { warnings.push(`${key}: a result row has no name; skipped`); continue; }

      const id = slug(name);
      const [min, max] = result.range ?? [];
      rows.push({ range: [min, max], id });

      if (!entries.has(id)) {
        entries.set(id, { id, name, journal: result.documentUuid ?? null, band: null, sources: [key] });
      } else {
        const existing = entries.get(id);
        existing.sources.push(key);
        // Expected and harmless: the duplicate journals hold identical prose. Recorded only
        // so a genuine divergence (same name, deliberately different text) is visible.
        if (result.documentUuid && result.documentUuid !== existing.journal) {
          existing.duplicateJournals ??= [];
          existing.duplicateJournals.push(result.documentUuid);
        }
      }
    }

    rows.sort((a, b) => a.range[0] - b.range[0]);
    verifyCoverage(key, rows, warnings);
    tables[key] = rows;
  }

  // Preserve a hand-authored `natural` table (and any hand-added entry fields) across re-runs.
  let previous = null;
  if (fs.existsSync(OUT)) {
    try { previous = JSON.parse(fs.readFileSync(OUT, "utf8")); }
    catch (err) { warnings.push(`existing ${path.basename(OUT)} is not valid JSON, not merging: ${err.message}`); }
  }
  if (previous?.tables?.natural) tables.natural = previous.tables.natural;

  const out = {
    version: 1,
    _generated: "tables (melee/bow/thrown) transcribed by tools/tables-to-json.mjs; `natural` is hand-authored",
    ...(previous?._naturalNote ? { _naturalNote: previous._naturalNote } : {}),
    tables,
    entries: [...entries.values()].map((e) => {
      const prior = previous?.entries?.find((p) => p.id === e.id);
      // Hand-added fields (band, outcomes) survive regeneration.
      return { ...e, band: prior?.band ?? e.band, ...(prior?.outcomes ? { outcomes: prior.outcomes } : {}) };
    }),
  };

  // Any entry only the hand-authored `natural` table references must survive too.
  for (const row of tables.natural ?? []) {
    if (out.entries.some((e) => e.id === row.id)) continue;
    const prior = previous?.entries?.find((p) => p.id === row.id);
    if (prior) out.entries.push(prior);
    else warnings.push(`natural: row "${row.id}" has no matching entry`);
  }

  // Collapse the two-element `range` arrays onto one line — pretty-printing them across four
  // lines each turns a 12-row table into 60 lines of noise and makes the file hard to scan.
  const json = JSON.stringify(out, null, 2)
    .replace(/\[\s+(\d+),\s+(\d+)\s+\]/g, "[$1, $2]") + "\n";

  for (const w of warnings) console.error(`WARN  ${w}`);
  console.error(`\n${out.entries.length} distinct effects across ${Object.keys(tables).length} tables.`);

  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json, "utf8");
    console.error(`Wrote ${path.relative(ROOT, OUT)}`);
  } else {
    process.stdout.write(json);
    console.error("(dry run — pass --write to save)");
  }
}

/** A d12 table with a hole in it silently produces no result for that roll. */
function verifyCoverage(key, rows, warnings) {
  let expected = 1;
  for (const { range: [min, max] } of rows) {
    if (min !== expected) warnings.push(`${key}: expected coverage to resume at ${expected}, found ${min}`);
    expected = max + 1;
  }
  if (expected !== 13) warnings.push(`${key}: coverage ends at ${expected - 1}, expected 12`);
}

main().catch((err) => { console.error(err); process.exit(1); });
