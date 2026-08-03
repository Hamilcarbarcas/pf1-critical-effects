#!/usr/bin/env node
/* effect-tables-to-json — transcribe the critical-effect RollTables into data/effects.json
 *
 * The shipped content is already in the shape the resolution needs: `packs-source/critical-tables`
 * holds one **1d12 table per damage type × location** (`Slashing - Arms`, `Piercing - Head`, …),
 * each row pointing at a journal in the effects pack. The Critical Power roll indexes straight
 * into that table — 1 is the mildest outcome for that body part, 12 the worst — so there is no
 * severity band, no weighted draw, and no query: the number the player rolled IS the row.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * The shipped tables are ALPHABETICAL, because they were auto-generated from folder contents
 * ("A random table created from the contents of the … Folder"). The mechanic needs them ordered
 * by severity, ascending. That is content work, not code: this tool emits the rows in their
 * current order and the JSON is then reordered by hand. Emitting to JSON is the point — the
 * ordering becomes a text edit rather than twelve drags per table in the Foundry UI.
 *
 * ── Completeness ────────────────────────────────────────────────────────────
 * Every table is padded to exactly 12 rows, and every anatomy slot gets a table even when no
 * content exists for it yet (wings, tails, appendages). Missing rows become marked placeholders,
 * so the engine can rely on "12 rows, always" and `lint()` can report how much is still unwritten.
 * A table row covering a range (e.g. 5–6) fills both indices with the same entry, which is also
 * how a deliberate repeat is expressed.
 *
 * Usage:  node tools/effect-tables-to-json.mjs [--write]
 * Without --write it prints a summary and changes nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANATOMY_LOCATIONS, DAMAGE_TYPES, TABLE_ROWS, anatomyLocationPairs } from "../src/catalog/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE_ROOT = path.join(ROOT, "packs-source", "critical-tables");
const JOURNAL_DIR = path.join(ROOT, "packs-source", "critical-effects");
const OUT = path.join(ROOT, "data", "effects.json");

/* Folder-name prefix -> damage type.
 *
 * The keys are PF1's own registry ids (`pf1.registry.damageTypes`), not abbreviations, so that one
 * vocabulary runs from the action's damage part through the catalog to the dialog's dropdown. The
 * earlier `b`/`p`/`s` had no source: PF1 calls them `bludgeoning`/`piercing`/`slashing`, and the
 * code that tried to read an attack's type off its action was comparing against letters PF1 never
 * produces — so it always came back empty. */
const FROM_FOLDER = { Bludgeoning: "bludgeoning", Piercing: "piercing", Slashing: "slashing" };

/** Folder-name suffix -> the slot key location.mjs produces. Sides are flavour and collapse. */
const LOCATIONS = { Arms: "arm", Head: "head", Legs: "leg", Torso: "torso" };

/* The shipped RollTables are all HUMANOID anatomy — "Bludgeoning - Arms" describes a hand that
 * drops a weapon and a wrist that shatters, which is not what happens to a wolf's foreleg. So the
 * transcription lands under `humanoid` and the other two anatomies generate as placeholders.
 * Copying humanoid's rows sideways into beast would have been cheaper and would have lied to
 * lint() about how much content exists. */
const TRANSCRIBED_ANATOMY = "humanoid";

const ROWS = TABLE_ROWS;

async function loadYaml() {
  try {
    const mod = await import("js-yaml");
    return mod.default ?? mod;
  } catch { /* not installed here */ }
  const { createRequire } = await import("node:module");
  const require = createRequire(path.join(ROOT, "..", "pack-tools", "package.json"));
  return require("js-yaml");
}

const slug = (name) =>
  String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every directory under `root`, inclusive. */
function* walkFolders(root) {
  if (!fs.existsSync(root)) return;
  yield root;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) yield* walkFolders(path.join(root, entry.name));
  }
}

/** Journal id -> { name, uuid }, so a table row's documentUuid can be given a name. */
function readJournals(yaml) {
  const byId = new Map();
  for (const dir of walkFolders(JOURNAL_DIR)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".yml") || file === "_Folder.yml") continue;
      const doc = yaml.load(fs.readFileSync(path.join(dir, file), "utf8"));
      if (!doc?.pages) continue; // a folder, not a journal
      byId.set(doc._id, doc.name);
    }
  }
  return byId;
}

/** Locate every `<DamageType> - <Location>` table file under the sub-tables folder. */
function findTableFiles() {
  const found = [];
  for (const dir of walkFolders(TABLE_ROOT)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".yml") || file === "_Folder.yml") continue;
      // "Slashing___Arms_<id>.yml" — and note the shipped "Blugeoning" typo, matched loosely.
      const m = /^(Bludgeoning|Blugeoning|Piercing|Slashing)___(Arms|Head|Legs|Torso)_/.exec(file);
      if (!m) continue;
      const damage = FROM_FOLDER[m[1] === "Blugeoning" ? "Bludgeoning" : m[1]];
      found.push({ damage, location: LOCATIONS[m[2]], file: path.join(dir, file), label: `${m[1]} - ${m[2]}` });
    }
  }
  return found;
}

async function main() {
  const yaml = await loadYaml();
  const journals = readJournals(yaml);
  const pairs = anatomyLocationPairs();
  const notes = [];

  /** id -> entry, shared across every table so a repeat costs one row. */
  const entries = new Map();
  const tables = {};

  const addEntry = (entry) => {
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
    return entry.id;
  };

  for (const { damage, location, file, label } of findTableFiles()) {
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    if (doc.formula !== `1d${ROWS}`) notes.push(`${label}: formula is "${doc.formula}", expected "1d${ROWS}"`);

    const row = new Array(ROWS).fill(null);

    for (const result of doc.results ?? []) {
      const id = String(result.documentUuid ?? "").split(".").pop();
      const name = journals.get(id) ?? String(result.text ?? "").trim();
      if (!name) { notes.push(`${label}: a row has no resolvable journal; left unwritten`); continue; }

      const key = addEntry({ id: slug(name), name, journal: result.documentUuid ?? null, buff: null, note: null });

      // A row covering a range fills every index in it — that is how a repeat is expressed.
      const [min, max] = result.range ?? [];
      for (let i = min; i <= max; i++) if (i >= 1 && i <= ROWS) row[i - 1] = key;
    }

    tables[damage] ??= {};
    tables[damage][TRANSCRIBED_ANATOMY] ??= {};
    tables[damage][TRANSCRIBED_ANATOMY][location] = row;
  }

  // Pad every table to 12, and give every anatomy x location pair a table even where no content
  // exists. The grid walks ANATOMY_LOCATIONS, so pairs that cannot happen (a humanoid tail) are
  // never generated and never count against the progress metric.
  let placeholders = 0;
  for (const damage of DAMAGE_TYPES) {
    tables[damage] ??= {};
    for (const { anatomy, location } of pairs) {
      tables[damage][anatomy] ??= {};
      const row = (tables[damage][anatomy][location] ??= new Array(ROWS).fill(null));
      for (let i = 0; i < ROWS; i++) {
        if (row[i]) continue;
        const id = `todo-${damage}-${anatomy}-${location}-${String(i + 1).padStart(2, "0")}`;
        addEntry({
          id,
          name: `(unwritten — ${damage} ${anatomy} ${location} ${i + 1})`,
          journal: null, buff: null, note: null, placeholder: true,
        });
        row[i] = id;
        placeholders++;
      }
    }
  }

  /* Mortal: the 13+ addendum, one per anatomy x location and damage-type agnostic. Emitted as an
   * explicit null rather than omitted, so the file shows all thirteen slots and the content track
   * can see at a glance which are still empty. */
  const mortal = {};
  for (const { anatomy, location } of pairs) {
    mortal[anatomy] ??= {};
    mortal[anatomy][location] ??= null;
  }

  const output = {
    version: 3,
    _generated: "transcribed from the critical-effect RollTables by tools/effect-tables-to-json.mjs",
    _shape:
      "tables[damageType][anatomy][location] = 12 entry ids. Anatomy is a real dimension: `arm` is " +
      "a weapon hand on a humanoid and a foreleg on a beast, and the two ladders diverge from row 1. " +
      "Every pair is written out in full — there is no inheritance between anatomies in this file.",
    _ordering:
      "Each table is 12 rows, indexed by the Critical Power roll: row 1 is the MILDEST outcome " +
      "for that location, row 12 the worst. Authored three at a time, as the four severity bands " +
      "(1-3 minor, 4-6 moderate, 7-9 severe, 10-12 grave); see content/README.md.",
    _mortal:
      "mortal[anatomy][location] is the 13+ addendum — read ON TOP of row 12, not instead of it, " +
      "and damage-type agnostic. null means unwritten, which leaves 13+ as row 12 plus the Fort save.",
    _placeholders:
      "Rows marked `placeholder` have no content yet. The engine treats them as real rows so that " +
      "'12 rows, always' holds; lint() reports how many remain.",
    entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)),
    tables,
    mortal,
  };

  // --- report ---------------------------------------------------------------
  const real = output.entries.filter((e) => !e.placeholder).length;
  const cells = DAMAGE_TYPES.length * pairs.length;
  console.error(`entries: ${output.entries.length} (${real} written, ${output.entries.length - real} placeholder)`);
  console.error(`tables : ${DAMAGE_TYPES.length} damage types x ${pairs.length} anatomy/location pairs = ${cells}`);
  console.error(`rows   : ${placeholders} of ${cells * ROWS} still unwritten`);
  console.error(`mortal : 0 of ${pairs.length} written`);

  for (const damage of DAMAGE_TYPES) {
    for (const [anatomy, locations] of Object.entries(ANATOMY_LOCATIONS)) {
      const line = locations
        .map((loc) => {
          const written = tables[damage][anatomy][loc].filter((id) => !entries.get(id)?.placeholder).length;
          return `${loc} ${written}/${ROWS}`;
        })
        .join("  ");
      console.error(`  ${damage.padEnd(12)} ${anatomy.padEnd(9)} ${line}`);
    }
  }
  for (const note of notes) console.error(`  ! ${note}`);

  if (process.argv.includes("--write")) {
    fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.error(`\nwrote ${path.relative(ROOT, OUT)}`);
  } else {
    console.error("\n(dry run — pass --write to update data/effects.json)");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
