#!/usr/bin/env node
/* pool-to-tables — data/pool.json (+ content/mortal.md) -> data/effects.json
 *
 * The pool is the source of truth; effects.json is build output and is not hand-edited. Runtime is
 * unchanged by any of this: the engine still looks a row up by index in a stored 12-row table
 * (DESIGN.md §3). Nothing queries the pool at the table.
 *
 * ── Rank is a soft target, not an address ───────────────────────────────────
 *
 * The obvious reading of "rank 6" is "this effect goes on row 6", and it is the wrong one. It
 * makes the pool a set of 720 exact pegs for 720 exact holes: an effect written as a 6 for
 * bludgeoning cannot help a slashing table that already has a 6 and needs a 7, so every near-miss
 * demands a brand new effect and the pool never converges.
 *
 * So rank is a **severity score**, and placement is nearest-fit within a bounded window. For one
 * table the candidates are every pool entry tagged for that damage type and slot, and each may
 * occupy any row within `--drift` (default ±1) of its own rank. A lone rank-6 candidate fills row
 * 7 quite happily; it may not fill row 12. A row with nothing in range becomes a placeholder,
 * which is the honest report — see the drift cap note on assign().
 *
 * Consequences worth knowing:
 *   - Adding an effect can move existing rows. The assignment is global to a table, not
 *     incremental, which is the price of never being deadlocked. Pin what must not move.
 *   - Placement is fully deterministic: same pool in, same tables out, every time. Ties break on
 *     rank then id, never on iteration order.
 *   - An untriaged entry (`rank: null`) is not placed anywhere. It is inventory, not content.
 *
 * ── Pins ────────────────────────────────────────────────────────────────────
 *
 * `pins: { "bludgeoning/humanoid/head": 12 }` forces an effect onto a row of one table. Pins are
 * applied first and are immovable; everything else fits around them. This is the escape hatch for
 * the handful of placements that are a deliberate authorial decision rather than a consequence of
 * a severity score — Beheaded belongs at the bottom of slashing/head whatever the arithmetic says.
 *
 * Usage:  node tools/pool-to-tables.mjs [--write] [--drift <n>]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DAMAGE_TYPES,
  TABLE_ROWS,
  ANATOMY_LOCATIONS,
  GENERAL_SLOT,
  gridCells,
  isLocalized,
  mortalCells,
} from "../src/catalog/schema.mjs";
import { parseMortalWorksheet } from "./worksheets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POOL = path.join(ROOT, "data", "pool.json");
const MORTAL = path.join(ROOT, "content", "mortal.md");
const OUT = path.join(ROOT, "data", "effects.json");

const pool = JSON.parse(fs.readFileSync(POOL, "utf8"));

/* How far an effect may sit from its own rank. See assign(). Loose enough that one effect covers a
 * three-row band; tight enough that row 12 still means something. */
const driftAt = process.argv.indexOf("--drift");
const MAX_DRIFT = driftAt === -1 ? 1 : Number(process.argv[driftAt + 1]);
if (!Number.isInteger(MAX_DRIFT) || MAX_DRIFT < 0) {
  console.error("--drift must be a non-negative integer");
  process.exit(1);
}
const problems = [];
/** Non-fatal: tagging that costs coverage but leaves the build correct. */
const notes = [];

/** Does an effect's `slots` cover this anatomy/location? `*\/loc` matches every anatomy with it —
 *  including `*\/general`, which is how one effect covers all three anatomies of an energy type. */
const coversSlot = (entry, anatomy, location) =>
  entry.slots?.some((slot) => slot === `${anatomy}/${location}` || slot === `*/${location}`);

const coversDamage = (entry, damageType) =>
  entry.damageTypes?.includes("*") || entry.damageTypes?.includes(damageType);

/**
 * Assign candidates to the twelve rows of one table by nearest rank.
 *
 * Two phases, and the order of them is the whole trick.
 *
 * **Seat first.** Each candidate is placed at the free row nearest its own rank, in rank order.
 * This is what keeps the ladder calibrated: a table with five candidates ranked 2, 4, 6, 7, 8 puts
 * them on rows 2, 4, 6, 7, 8 and leaves the rest empty. The naive alternative — walking rows 1..12
 * and giving each the nearest unused candidate — looks equivalent and is not: row 1 grabs the
 * rank-2 effect, row 2 grabs the rank-4, and the entire ladder compresses into the bottom of the
 * table while the top becomes a wall of repeats. Row 12 has to mean something.
 *
 * **Then backfill.** Rows still empty take the nearest-ranked candidate, reused.
 *
 * ── The drift cap ───────────────────────────────────────────────────────────
 *
 * Both phases are bounded by `MAX_DRIFT` (±1 by default): a candidate may only occupy a row within
 * that distance of its own rank. A row with nothing in range stays empty and becomes a
 * **placeholder**, which is the honest answer — an unbounded fit would put a rank-8 effect on row
 * 12 and then count that row as *filled*, which corrupts the ladder and the progress metric at the
 * same time. "We have no grave slashing arm wound" is a fact worth being able to see.
 *
 * ±1 is deliberately loose enough that one effect can cover a whole three-row band, which is what
 * keeps the pool from having to contain an exact peg for all 720 holes: an effect written as a 6
 * for bludgeoning also serves a slashing table that needs a 7. Raise it with `--drift n` for a
 * more playable build with a thin pool, or `--drift 0` to see only exact fits.
 *
 * Pins are seated before either phase, are exempt from the cap, and never move.
 */
function assign(candidates, pins, maxDrift) {
  const rows = new Array(TABLE_ROWS).fill(null);
  const free = () => rows.map((id, i) => (id ? null : i + 1)).filter(Boolean);
  const inRange = (rank, row) => Math.abs(rank - row) <= maxDrift;

  for (const [id, row] of pins) {
    if (row >= 1 && row <= TABLE_ROWS) rows[row - 1] = id;
  }

  if (!candidates.length) return { rows, drift: [], repeats: [], surplus: [] };

  // Phase 1 — seat each candidate at the free row nearest its rank. Ties go to the lower row.
  const drift = [];
  const surplus = [];
  for (const entry of candidates) {
    const open = free().filter((r) => inRange(entry.rank, r));
    if (!open.length) { surplus.push(entry.id); continue; }

    const row = open.reduce((best, r) =>
      Math.abs(entry.rank - r) < Math.abs(entry.rank - best) ? r : best, open[0]);

    rows[row - 1] = entry.id;
    if (row !== entry.rank) drift.push({ row, id: entry.id, rank: entry.rank, cost: Math.abs(entry.rank - row) });
  }

  // Phase 2 — backfill the gaps by reusing the nearest-ranked candidate that is still in range.
  const repeats = [];
  for (let row = 1; row <= TABLE_ROWS; row++) {
    if (rows[row - 1]) continue;

    const reachable = candidates.filter((e) => inRange(e.rank, row));
    if (!reachable.length) continue; // stays empty -> placeholder, which is the honest answer

    const best = reachable.reduce((a, b) => {
      const ca = Math.abs(a.rank - row);
      const cb = Math.abs(b.rank - row);
      return cb < ca || (cb === ca && b.rank < a.rank) ? b : a;
    });

    rows[row - 1] = best.id;
    repeats.push({ row, id: best.id, rank: best.rank, cost: Math.abs(best.rank - row) });
  }

  return { rows, drift, repeats, surplus };
}

// --- build ------------------------------------------------------------------

const entries = new Map();
const tables = {};
const report = { cells: [], unplaced: new Set(pool.entries.filter((e) => e.rank != null).map((e) => e.id)) };

const addEntry = (entry) => {
  if (!entries.has(entry.id)) entries.set(entry.id, entry);
  return entry.id;
};

const catalogEntry = (e) => ({ id: e.id, name: e.name, journal: e.journal ?? null, buff: e.buff ?? null, note: e.note ?? null });

for (const entry of pool.entries) {
  if (entry.rank != null && (entry.rank < 1 || entry.rank > TABLE_ROWS)) {
    problems.push(`pool "${entry.id}": rank ${entry.rank} is outside 1-${TABLE_ROWS}`);
  }
  for (const slot of entry.slots ?? []) {
    const [anatomy, location] = slot.split("/");
    /* `general` is a real slot to tag for — it is where the non-localized damage types keep their
     * tables — but it belongs to no anatomy in particular, so it is checked separately rather than
     * being bolted into ANATOMY_LOCATIONS and leaking into the location roll. */
    const known = location === GENERAL_SLOT
      ? anatomy === "*" || anatomy in ANATOMY_LOCATIONS
      : anatomy === "*"
        ? Object.values(ANATOMY_LOCATIONS).some((ls) => ls.includes(location))
        : ANATOMY_LOCATIONS[anatomy]?.includes(location);
    if (!known) problems.push(`pool "${entry.id}": slot "${slot}" is not a real anatomy/location pair`);
  }
  for (const dt of entry.damageTypes ?? []) {
    if (dt !== "*" && !DAMAGE_TYPES.includes(dt)) problems.push(`pool "${entry.id}": unknown damage type "${dt}"`);
  }

  /* The two halves of the grid are tagged differently, so a tag can select nothing at all: a
   * `general` slot means nothing to a weapon damage type, and a body part means nothing to one
   * that never rolls for a location. Worth saying, but NOT fatal — `damageTypes: ["*"]` alongside
   * body-part slots is a reasonable thing to write, and it costs only the energy half. */
  if (entry.rank != null) {
    const tagged = DAMAGE_TYPES.filter((dt) => coversDamage(entry, dt));
    const hasGeneral = entry.slots?.some((s) => s.endsWith(`/${GENERAL_SLOT}`));
    const hasBodyPart = entry.slots?.some((s) => !s.endsWith(`/${GENERAL_SLOT}`));

    if (tagged.some((dt) => !isLocalized(dt)) && !hasGeneral) {
      notes.push(`"${entry.id}": tagged for damage types that roll no location, but has no "…/${GENERAL_SLOT}" slot — those tags select nothing`);
    }
    if (tagged.some(isLocalized) && !hasBodyPart) {
      notes.push(`"${entry.id}": tagged for weapon damage types, but has only "…/${GENERAL_SLOT}" slots — those tags select nothing`);
    }
  }
}

for (const { damageType, anatomy, location } of gridCells()) {
  const candidates = pool.entries
    .filter((e) => e.rank != null && coversDamage(e, damageType) && coversSlot(e, anatomy, location))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));

  const pins = new Map();
  for (const entry of pool.entries) {
    const row = entry.pins?.[`${damageType}/${anatomy}/${location}`];
    if (row != null) pins.set(entry.id, row);
  }

  const { rows, drift, repeats, surplus } = assign(candidates, pins, MAX_DRIFT);

  for (let i = 0; i < TABLE_ROWS; i++) {
    if (rows[i]) {
      const source = pool.entries.find((e) => e.id === rows[i]);
      addEntry(catalogEntry(source));
      report.unplaced.delete(rows[i]);
    } else {
      const id = `todo-${damageType}-${anatomy}-${location}-${String(i + 1).padStart(2, "0")}`;
      addEntry({ id, name: `(unwritten — ${damageType} ${anatomy} ${location} ${i + 1})`, journal: null, buff: null, note: null, placeholder: true });
      rows[i] = id;
    }
  }

  ((tables[damageType] ??= {})[anatomy] ??= {})[location] = rows;
  report.cells.push({
    key: `${damageType}/${anatomy}/${location}`,
    candidates: candidates.length,
    filled: rows.filter((id) => !entries.get(id)?.placeholder).length,
    distinct: new Set(rows.filter((id) => !entries.get(id)?.placeholder)).size,
    drift,
    repeats,
    surplus,
  });
}

// --- mortal -----------------------------------------------------------------

/* Two halves keyed by different axes — body part for the weapon types, damage type for the rest.
 * Both are pre-seeded to null from `mortalCells` so an unwritten cell is a visible hole in the
 * output rather than an absent key. */
const mortal = { byPart: {}, byDamageType: {} };
for (const cell of mortalCells()) {
  if (cell.kind === "part") (mortal.byPart[cell.anatomy] ??= {})[cell.location] = null;
  else mortal.byDamageType[cell.damageType] = null;
}

if (fs.existsSync(MORTAL)) {
  const { rows, problems: parseProblems } = parseMortalWorksheet(fs.readFileSync(MORTAL, "utf8"));
  problems.push(...parseProblems);
  for (const row of rows) {
    if (!row.name) continue;
    const id = row.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const existing = pool.entries.find((e) => e.id === id);
    addEntry({ id, name: row.name, journal: existing?.journal ?? null, buff: existing?.buff ?? null, note: row.mechanic || existing?.note || null });
    if (row.kind === "part") mortal.byPart[row.anatomy][row.location] = id;
    else mortal.byDamageType[row.damageType] = id;
  }
}

// --- emit -------------------------------------------------------------------

const output = {
  version: 4,
  _generated: "GENERATED by tools/pool-to-tables.mjs from data/pool.json — do not hand-edit. Edit the pool.",
  _shape:
    "tables[damageType][anatomy][location] = 12 entry ids. Anatomy is a real dimension: `arm` is " +
    "a weapon hand on a humanoid and a foreleg on a beast, and the two ladders diverge from row 1. " +
    "Location is a dimension only for bludgeoning/piercing/slashing; every other damage type rolls " +
    "no hit location and keeps one `general` table per anatomy.",
  _placement:
    "Rows are assigned by NEAREST RANK, not by exact match — a rank-6 effect fills row 7 when " +
    "nothing better is tagged for that table. See content/COVERAGE.md for per-table drift.",
  _mortal:
    "The 13+ addendum — read ON TOP of row 12, not instead of it. Two halves keyed by different " +
    "axes: mortal.byPart[anatomy][location] for the weapon damage types (damage-type agnostic), " +
    "mortal.byDamageType[damageType] for the rest (anatomy agnostic). Authored in content/mortal.md.",
  entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)),
  tables,
  mortal,
};

const real = output.entries.filter((e) => !e.placeholder).length;
const slots = report.cells.length * TABLE_ROWS;
const filled = report.cells.reduce((n, c) => n + c.filled, 0);
const distinct = report.cells.reduce((n, c) => n + c.distinct, 0);

console.error(`pool     : ${pool.entries.length} entries (${pool.entries.filter((e) => e.rank != null).length} ranked)`);
console.error(`entries  : ${output.entries.length} (${real} real, ${output.entries.length - real} placeholder)`);
console.error(`tables   : ${report.cells.length} (${DAMAGE_TYPES.length} damage types, location only for ${DAMAGE_TYPES.filter(isLocalized).length})`);
console.error(`slots    : ${filled} of ${slots} filled (${Math.round((filled / slots) * 100)}%), ${distinct} of them distinct`);
console.error(`unplaced : ${report.unplaced.size} ranked pool entries land in no table`);
if (report.unplaced.size) console.error(`           ${[...report.unplaced].join(", ")}`);

if (notes.length) {
  console.error(`\n${notes.length} tagging note(s) — the build is fine, the coverage isn't:`);
  for (const note of notes) console.error(`  - ${note}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — nothing written:`);
  for (const problem of problems) console.error(`  ! ${problem}`);
  process.exit(1);
}

if (process.argv.includes("--write")) {
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(ROOT, "data", ".coverage.json"), JSON.stringify(report.cells, null, 2) + "\n", "utf8");
  console.error(`\nwrote ${path.relative(ROOT, OUT)}`);
} else {
  console.error("\n(dry run — pass --write to regenerate data/effects.json)");
}
