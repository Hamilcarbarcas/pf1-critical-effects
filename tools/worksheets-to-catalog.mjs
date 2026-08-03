#!/usr/bin/env node
/* worksheets-to-catalog — content/*.md -> data/effects.json
 *
 * The review gate. Sections marked `**Status:** approved` are folded into the catalog; sections
 * left at `draft` are ignored entirely, so a worksheet can be half-written on disk without any
 * of it reaching the module. Content lands one reviewed table at a time.
 *
 * ── Merge, not regenerate ───────────────────────────────────────────────────
 *
 * The existing catalog is loaded and approved tables are written OVER it. A table nobody has
 * approved keeps whatever it had, and an entry's `journal` and `buff` survive being renamed or
 * re-banded in a worksheet — the worksheets carry names and rules text, not compendium uuids,
 * and must never be able to sever an entry from its journal.
 *
 * ── Entries are shared by name ──────────────────────────────────────────────
 *
 * An entry's id is the slug of its name, and the same name in two tables is the SAME entry — a
 * "Dropped Weapon" is a dropped weapon whether it was a mace or an axe that did it. That is what
 * keeps the pool at a few hundred entries rather than 1,560, and what lets one buff, once
 * attached, apply everywhere the effect appears.
 *
 * The cost is that two different wounds may not share a name. If the same name turns up with
 * conflicting rules text the fold is refused, because silently keeping one of the two would put
 * text on a card that nobody wrote for it. Rename one of them — "Severed Wing" and "Severed Tail"
 * read better on a card than two "Severed"s anyway.
 *
 * Usage:  node tools/worksheets-to-catalog.mjs [--write] [--all]
 *   --all  fold in draft sections too. For round-trip testing; not for content.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DAMAGE_TYPES, ANATOMY_LOCATIONS, TABLE_ROWS, anatomyLocationPairs } from "../src/catalog/schema.mjs";
import { parseWorksheet, parseMortalWorksheet, slug, sectionHeading } from "./worksheets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "data", "effects.json");
const CONTENT = path.join(ROOT, "content");

const args = process.argv.slice(2);
const write = args.includes("--write");
const includeDrafts = args.includes("--all");

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const entries = new Map(catalog.entries.map((e) => [e.id, { ...e }]));
const tables = catalog.tables;
const mortal = catalog.mortal ?? {};

const problems = [];
const warnings = [];
/** id -> where its rules text was first seen, so a conflict can name both sides. */
const mechanicSource = new Map();

/**
 * Fold one worksheet row into the entry pool, returning the id the table should reference.
 *
 * Merging rather than replacing is what protects `journal` and `buff`: a worksheet knows an
 * effect's name and what it does, and nothing else about it.
 */
function upsert(name, mechanic, where) {
  const id = slug(name);
  const existing = entries.get(id);

  if (existing?.note && mechanic && existing.note !== mechanic) {
    problems.push(
      `"${name}" has conflicting rules text:\n      ${mechanicSource.get(id)}: ${existing.note}\n      ${where}: ${mechanic}`
    );
    return id;
  }
  if (existing && !existing.placeholder && existing.journal && mechanic && !existing.note) {
    // Not a fault: the journal is the prose and this is the rules line. Worth seeing once, though,
    // because the two are edited apart and this is where they start being able to disagree.
    warnings.push(`${where}: "${name}" already has a journal; its worksheet rules text is now also stored as \`note\``);
  }

  entries.set(id, {
    id,
    name,
    journal: existing?.journal ?? null,
    buff: existing?.buff ?? null,
    note: mechanic || existing?.note || null,
  });
  if (mechanic) mechanicSource.set(id, where);
  return id;
}

const placeholderId = (damageType, anatomy, location, row) =>
  `todo-${damageType}-${anatomy}-${location}-${String(row).padStart(2, "0")}`;

function placeholder(damageType, anatomy, location, row) {
  const id = placeholderId(damageType, anatomy, location, row);
  entries.set(id, {
    id,
    name: `(unwritten — ${damageType} ${anatomy} ${location} ${row})`,
    journal: null, buff: null, note: null, placeholder: true,
  });
  return id;
}

// --- fold in the per-damage-type worksheets ---------------------------------

let approved = 0;
let skipped = 0;
/** `= humanoid` rows, resolved after every section of the file has been read. */
const deferred = [];

for (const damageType of DAMAGE_TYPES) {
  const file = path.join(CONTENT, `${damageType}.md`);
  if (!fs.existsSync(file)) continue;

  const { sections, problems: parseProblems } = parseWorksheet(fs.readFileSync(file, "utf8"), `${damageType}.md`);
  problems.push(...parseProblems);

  for (const section of sections) {
    const { anatomy, location, status, rows } = section;
    const where = `${damageType}.md ${sectionHeading(anatomy, location)}`;

    if (!ANATOMY_LOCATIONS[anatomy]?.includes(location)) {
      problems.push(`${where}: a ${anatomy} is never hit in the ${location}`);
      continue;
    }
    if (status !== "approved" && !includeDrafts) { skipped++; continue; }

    const ids = new Array(TABLE_ROWS).fill(null);
    for (const { row, name, mechanic, sameAs } of rows) {
      if (sameAs) { deferred.push({ damageType, anatomy, location, row, sameAs, where }); continue; }
      ids[row - 1] = name ? upsert(name, mechanic, `${where} row ${row}`) : placeholder(damageType, anatomy, location, row);
    }

    tables[damageType] ??= {};
    tables[damageType][anatomy] ??= {};
    tables[damageType][anatomy][location] = ids;
    approved++;
  }
}

/* `= humanoid` resolves against the FOLDED catalog, not against the worksheet, so it can point at
 * a table approved in an earlier run as readily as one approved in this one. Pointing at a row
 * that is itself still unwritten is allowed and simply inherits the placeholder — the alternative
 * would be forbidding you to write beast before humanoid. */
for (const { damageType, anatomy, location, row, sameAs, where } of deferred) {
  const source = tables[damageType]?.[sameAs]?.[location]?.[row - 1];
  if (!source) {
    problems.push(`${where} row ${row}: "= ${sameAs}" has no ${sameAs}/${location} table to copy from`);
    continue;
  }
  if (sameAs === anatomy) {
    problems.push(`${where} row ${row}: "= ${sameAs}" points at its own table`);
    continue;
  }
  tables[damageType][anatomy][location][row - 1] = source;
}

// --- fold in the mortal worksheet -------------------------------------------

const mortalFile = path.join(CONTENT, "mortal.md");
let mortalWritten = 0;
if (fs.existsSync(mortalFile)) {
  const { status, rows, problems: parseProblems } = parseMortalWorksheet(fs.readFileSync(mortalFile, "utf8"));
  problems.push(...parseProblems);

  if (status === "approved" || includeDrafts) {
    for (const { anatomy, location, name, mechanic } of rows) {
      mortal[anatomy] ??= {};
      mortal[anatomy][location] = name ? upsert(name, mechanic, `mortal.md ${anatomy}/${location}`) : null;
      if (name) mortalWritten++;
    }
  } else {
    skipped++;
  }
}

// --- prune, verify, emit ----------------------------------------------------

/* An entry nothing references is dead weight — usually a placeholder whose row has just been
 * written over. Dropping it here is what keeps the pool honest as a count of real content. */
const referenced = new Set([
  ...Object.values(tables).flatMap((a) => Object.values(a).flatMap((l) => Object.values(l).flat())),
  ...Object.values(mortal).flatMap((l) => Object.values(l)),
].filter(Boolean));

const pruned = [...entries.keys()].filter((id) => !referenced.has(id));
for (const id of pruned) entries.delete(id);

// Every cell of the grid still has to be twelve rows of real entry ids.
for (const damageType of DAMAGE_TYPES) {
  for (const { anatomy, location } of anatomyLocationPairs()) {
    const ids = tables[damageType]?.[anatomy]?.[location];
    if (!ids) { problems.push(`tables.${damageType}.${anatomy}.${location}: missing`); continue; }
    if (ids.length !== TABLE_ROWS) problems.push(`tables.${damageType}.${anatomy}.${location}: ${ids.length} rows, expected ${TABLE_ROWS}`);
    const holes = ids.map((id, i) => (id && entries.has(id) ? null : i + 1)).filter(Boolean);
    if (holes.length) problems.push(`tables.${damageType}.${anatomy}.${location}: rows ${holes.join(", ")} reference nothing`);
  }
}

const output = {
  ...catalog,
  entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)),
  tables,
  mortal,
};

const real = output.entries.filter((e) => !e.placeholder).length;
console.error(`sections: ${approved} folded in, ${skipped} still draft`);
console.error(`entries : ${output.entries.length} (${real} written, ${output.entries.length - real} placeholder, ${pruned.length} pruned)`);
console.error(`mortal  : ${Object.values(mortal).flatMap((l) => Object.values(l)).filter(Boolean).length} of ${anatomyLocationPairs().length} written`);
for (const warning of warnings) console.error(`  ~ ${warning}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — nothing written:`);
  for (const problem of problems) console.error(`  ! ${problem}`);
  process.exit(1);
}

if (write) {
  fs.writeFileSync(CATALOG, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.error(`\nwrote ${path.relative(ROOT, CATALOG)}`);
} else {
  console.error("\n(dry run — pass --write to update data/effects.json)");
}
