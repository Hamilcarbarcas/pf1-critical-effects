#!/usr/bin/env node
/* pool-report — data/pool.json -> content/COVERAGE.md
 *
 * The work queue. `pool-to-tables` will always produce twelve rows for every table; this is what
 * says whether those twelve rows are twelve *effects* or one effect stretched over twelve rows.
 *
 * The unit of work is a **(damage type, slot, band) triple** — "slashing / humanoid arm / grave" —
 * because that is the granularity at which a gap is fixable: it names a damage type, a body part,
 * and roughly how bad the wound should be, which is a writing prompt. A table-level "60% full"
 * would not be.
 *
 * Three candidates per band is the target, since a band is three rows. Fewer is not a failure —
 * the generator backfills by reuse — but it is the thing to go and fix.
 *
 * Usage:  node tools/pool-report.mjs [--write]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DAMAGE_TYPES, DAMAGE_TYPE_LABELS, ANATOMY_LOCATIONS, SEVERITY_BANDS,
  TABLE_ROWS, bandForRow, anatomyLocationPairs, FUMBLE_TABLES, FUMBLE_ROWS,
} from "../src/catalog/schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POOL = path.join(ROOT, "data", "pool.json");
const FUMBLE_POOL = path.join(ROOT, "data", "fumble-pool.json");
const LETHAL = path.join(ROOT, "data", "lethal.json");
const OUT = path.join(ROOT, "content", "COVERAGE.md");

const pool = JSON.parse(fs.readFileSync(POOL, "utf8"));
const fumblePool = JSON.parse(fs.readFileSync(FUMBLE_POOL, "utf8"));
const lethal = JSON.parse(fs.readFileSync(LETHAL, "utf8"));
const ranked = pool.entries.filter((e) => e.rank != null);

const coversSlot = (e, anatomy, location) =>
  e.slots?.some((s) => s === `${anatomy}/${location}` || s === `*/${location}`);
const coversDamage = (e, dt) => e.damageTypes?.includes("*") || e.damageTypes?.includes(dt);

const PER_BAND = TABLE_ROWS / SEVERITY_BANDS.length;

/** candidates[damageType][anatomy/location][band] = count */
const gaps = [];
const cells = [];

for (const damageType of DAMAGE_TYPES) {
  for (const { anatomy, location } of anatomyLocationPairs()) {
    const candidates = ranked.filter((e) => coversDamage(e, damageType) && coversSlot(e, anatomy, location));
    const byBand = {};
    for (const band of SEVERITY_BANDS) byBand[band.key] = 0;
    for (const entry of candidates) byBand[bandForRow(entry.rank).key] += 1;

    cells.push({ damageType, anatomy, location, byBand, total: candidates.length });
    for (const band of SEVERITY_BANDS) {
      const have = byBand[band.key];
      if (have < PER_BAND) gaps.push({ damageType, anatomy, location, band: band.label, have, need: PER_BAND });
    }
  }
}

/* Split the queue in two, because they are different jobs.
 *
 * A gap in a table that already has candidates is worth one or two effects and finishes something.
 * A table with nothing in it at all is a from-scratch job, and listing its four empty bands as four
 * separate lines buries the first kind under hundreds of the second — which is exactly what the
 * first draft of this report did. Partial gaps get the queue; empty tables get a compact roll-call.
 */
const emptyCells = cells.filter((c) => c.total === 0);
const emptyKeys = new Set(emptyCells.map((c) => `${c.damageType}/${c.anatomy}/${c.location}`));
const partialGaps = gaps.filter((g) => !emptyKeys.has(`${g.damageType}/${g.anatomy}/${g.location}`));

// Closest to done first: the gaps that take least work to close.
partialGaps.sort((a, b) =>
  (b.have - a.have) ||
  a.damageType.localeCompare(b.damageType) ||
  `${a.anatomy}/${a.location}`.localeCompare(`${b.anatomy}/${b.location}`) ||
  SEVERITY_BANDS.findIndex((s) => s.label === a.band) - SEVERITY_BANDS.findIndex((s) => s.label === b.band)
);

function table(header, rows, align = []) {
  const all = [header, ...rows];
  const w = header.map((_, c) => Math.max(...all.map((r) => String(r[c] ?? "").length)));
  const pad = (t, c) => (align[c] === "right" ? String(t ?? "").padStart(w[c]) : String(t ?? "").padEnd(w[c]));
  const line = (cs) => `| ${cs.map((c, i) => pad(c, i)).join(" | ")} |`;
  const rule = `|${w.map((n, c) => (align[c] === "right" ? "-".repeat(n + 1) + ":" : "-".repeat(n + 2))).join("|")}|`;
  return [line(header), rule, ...rows.map(line)].join("\n");
}

const totalSlots = DAMAGE_TYPES.length * anatomyLocationPairs().length * TABLE_ROWS;
const saturated = cells.filter((c) => SEVERITY_BANDS.every((b) => c.byBand[b.key] >= PER_BAND)).length;
const empty = cells.filter((c) => c.total === 0).length;

const out = [
  "# Coverage",
  "",
  "**Generated** by `node tools/pool-report.mjs --write`. Do not edit.",
  "",
  `Pool: **${pool.entries.length} effects**, ${ranked.length} ranked, ${pool.entries.length - ranked.length} untriaged.`,
  `Grid: **${cells.length} tables** (${DAMAGE_TYPES.length} damage types × ${anatomyLocationPairs().length} anatomy/location pairs), ${totalSlots} rows.`,
  `**${saturated} of ${cells.length} tables are saturated** (every band has its ${PER_BAND} candidates); ${empty} have no candidates at all.`,
  "",
  "A table is always twelve rows — the generator backfills gaps by reusing the nearest-ranked",
  "candidate. This report is what tells you whether those twelve rows are twelve *effects* or one",
  "effect stretched over twelve. Target is **3 candidates per band**, because a band is 3 rows.",
  "",
  "---",
  "",
  "## Work queue — tables in progress",
  "",
  `${partialGaps.length} band-gaps sit in tables that already have candidates. **Closest to done`,
  "first** — each line is a writing prompt: a damage type, a body part, and how bad the wound",
  "should be. These are the cheapest wins; a table with two of three grave wounds needs one effect.",
  "",
];

if (partialGaps.length) {
  const worst = partialGaps.slice(0, 60);
  out.push(table(
    ["Damage type", "Body part", "Band", "Have", "Need"],
    worst.map((g) => [
      DAMAGE_TYPE_LABELS[g.damageType] ?? g.damageType,
      `${g.anatomy} ${g.location}`,
      g.band,
      g.have,
      g.need,
    ]),
    [null, null, null, "right", "right"]
  ));
  if (partialGaps.length > worst.length) out.push("", `_…and ${partialGaps.length - worst.length} more._`);
} else {
  out.push("_None — every table with any content is saturated._");
}

out.push("", "---", "", "## Untouched tables", "",
  `${emptyCells.length} of ${cells.length} tables have **no candidates at all**. These are`,
  "from-scratch jobs rather than gap-filling, so they are listed by damage type rather than",
  "line by line. Remember one effect can be tagged for several body parts and damage types at once —",
  "these do not cost 12 effects each.", "");

const byDamage = new Map();
for (const cell of emptyCells) {
  if (!byDamage.has(cell.damageType)) byDamage.set(cell.damageType, []);
  byDamage.get(cell.damageType).push(`${cell.anatomy} ${cell.location}`);
}
out.push(table(
  ["Damage type", "Empty", "Body parts"],
  [...byDamage].map(([dt, parts]) => [
    DAMAGE_TYPE_LABELS[dt] ?? dt,
    `${parts.length}/${anatomyLocationPairs().length}`,
    parts.length === anatomyLocationPairs().length ? "**all**" : parts.join(", "),
  ]),
  [null, "right"]
));

out.push("", "---", "", "## Coverage matrix", "",
  "Candidates per band, per table. `3` is saturated; `.` is empty.", "");

for (const damageType of DAMAGE_TYPES) {
  const rows = cells
    .filter((c) => c.damageType === damageType)
    .map((c) => [
      `${c.anatomy} ${c.location}`,
      ...SEVERITY_BANDS.map((b) => (c.byBand[b.key] === 0 ? "." : String(c.byBand[b.key]))),
      String(c.total),
    ]);

  out.push(
    `### ${DAMAGE_TYPE_LABELS[damageType] ?? damageType}`,
    "",
    table(["Body part", ...SEVERITY_BANDS.map((b) => b.label), "Total"], rows,
      [null, "right", "right", "right", "right", "right"]),
    ""
  );
}

const untriaged = pool.entries.filter((e) => e.rank == null);
if (untriaged.length) {
  out.push("---", "", "## Untriaged", "",
    `${untriaged.length} pool effects have no \`rank\` and are therefore placed in **no table at all** —`,
    "they are inventory, not content. Give each one a 1-12 severity score to bring it into play.", "",
    table(["Effect", "Slots", "Damage types"],
      untriaged.map((e) => [e.name, (e.slots ?? []).join(", ") || "—", (e.damageTypes ?? []).join(", ") || "—"])),
    "");
}

const untagged = pool.entries.filter((e) => !e.slots?.length || !e.damageTypes?.length);
if (untagged.length) {
  out.push("---", "", "## Untagged", "",
    "These have no `slots` and/or no `damageTypes`, so nothing can ever select them.", "",
    table(["Effect", "Slots", "Damage types"],
      untagged.map((e) => [e.name, (e.slots ?? []).join(", ") || "**none**", (e.damageTypes ?? []).join(", ") || "**none**"])),
    "");
}

/* Fumbles and lethal ride along in this report rather than getting one each: all three are the
 * same job from the content side ("what do I write next"), and one dashboard beats three. They are
 * measured differently, though, because they ARE different — fumbles are unordered peers with no
 * severity ladder, and lethal has no location axis at all. */

const fumbleCounts = FUMBLE_TABLES.map((type) => ({
  type,
  have: fumblePool.entries.filter((e) => e.attackTypes?.includes(type)).length,
}));

out.push("---", "", "## Fumbles", "",
  `Pool: **${fumblePool.entries.length} fumbles** across ${FUMBLE_TABLES.length} attack types,`,
  `d${FUMBLE_ROWS} each — ${FUMBLE_TABLES.length * FUMBLE_ROWS} slots.`,
  "",
  "Fumble rows are **unordered peers**: the die picks which fumble, not how bad it is, so there is",
  "no rank and no band. A short table gets placeholders rather than repeats, because a repeat would",
  "silently double that outcome's odds — a decision nobody made.",
  "",
  table(["Attack type", "Have", "Need", "Short by"],
    fumbleCounts.map((f) => [f.type, f.have, FUMBLE_ROWS, Math.max(0, FUMBLE_ROWS - f.have) || "—"]),
    [null, "right", "right", "right"]),
  "");

const lethalByType = DAMAGE_TYPES.map((dt) => ({
  dt,
  have: lethal.entries.filter((e) => e.damageTypes?.includes(dt) || e.damageTypes?.includes("*")).length,
}));

out.push("---", "", "## Lethal", "",
  `**${lethal.entries.length} entries.** Flavour only — a lethal result narrates a kill that`,
  "something else already decided (HP loss, a coup de grace). No save, no roll-off, no location",
  "axis: the only tag is damage type, and one is drawn at random from whatever matches.",
  "",
  "There is no target count, so nothing here is a gap in the sense the tables above use. An empty",
  "damage type simply means a kill of that sort gets no narration.",
  "",
  table(["Damage type", "Entries"],
    lethalByType.map((l) => [DAMAGE_TYPE_LABELS[l.dt] ?? l.dt, l.have || "—"]), [null, "right"]),
  "");

const text = out.join("\n") + "\n";

console.error(`tables    : ${saturated} saturated, ${empty} empty, of ${cells.length}`);
console.error(`gaps      : ${gaps.length} band-triples short of ${PER_BAND}`);
console.error(`untriaged : ${untriaged.length}   untagged: ${untagged.length}`);

if (process.argv.includes("--write")) {
  fs.writeFileSync(OUT, text, "utf8");
  console.error(`\nwrote ${path.relative(ROOT, OUT)}`);
} else {
  console.error("\n(dry run — pass --write to update content/COVERAGE.md)");
}
