#!/usr/bin/env node
/* scaffold-worksheets — data/effects.json -> content/*.md
 *
 * Writes one worksheet per damage type plus content/mortal.md, pre-filled with whatever the
 * catalog already holds. Placeholder rows come out as blank cells, which is exactly the shape a
 * person wants to type into.
 *
 * Every generated section starts at `**Status:** draft`, INCLUDING sections whose twelve rows are
 * already written — status is a statement about review, not about completeness, and the 72
 * transcribed rows have never been reviewed in severity order.
 *
 * Existing files are never overwritten without `--force`, because the whole point of a worksheet
 * is that it holds hand-written content. Regenerating a file you have edited loses it.
 *
 * Usage:  node tools/scaffold-worksheets.mjs [--write] [--force] [--only <damageType>]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DAMAGE_TYPES, ANATOMY_LOCATIONS, TABLE_ROWS } from "../src/catalog/schema.mjs";
import { renderWorksheet, renderMortalWorksheet } from "./worksheets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "data", "effects.json");
const CONTENT = path.join(ROOT, "content");

const args = process.argv.slice(2);
const write = args.includes("--write");
const force = args.includes("--force");
// `indexOf` is -1 when the flag is absent, which would otherwise make args[0] the filter.
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : args[onlyAt + 1];

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const byId = new Map(catalog.entries.map((e) => [e.id, e]));

/** A placeholder is an unwritten row: it renders as an empty cell, not as its generated name. */
const cellFor = (id) => {
  const entry = byId.get(id);
  if (!entry || entry.placeholder) return { name: "", mechanic: "" };
  return { name: entry.name ?? "", mechanic: entry.note ?? "" };
};

function sectionsFor(damageType) {
  const sections = {};
  for (const [anatomy, locations] of Object.entries(ANATOMY_LOCATIONS)) {
    for (const location of locations) {
      const ids = catalog.tables?.[damageType]?.[anatomy]?.[location] ?? [];
      const rows = [];
      for (let row = 1; row <= TABLE_ROWS; row++) rows.push({ row, ...cellFor(ids[row - 1]) });
      sections[`${anatomy}/${location}`] = { status: "draft", rows };
    }
  }
  return sections;
}

function mortalRows() {
  const rows = {};
  for (const [anatomy, locations] of Object.entries(ANATOMY_LOCATIONS)) {
    for (const location of locations) {
      const entry = byId.get(catalog.mortal?.[anatomy]?.[location]);
      rows[`${anatomy}/${location}`] = { name: entry?.name ?? "", mechanic: entry?.note ?? "" };
    }
  }
  return rows;
}

const emit = (file, text) => {
  const target = path.join(CONTENT, file);
  const exists = fs.existsSync(target);

  if (exists && !force) {
    console.error(`  skip  ${file} (exists — pass --force to regenerate)`);
    return;
  }
  if (!write) {
    console.error(`  would ${exists ? "overwrite" : "write"} ${file}`);
    return;
  }
  fs.writeFileSync(target, text, "utf8");
  console.error(`  ${exists ? "rewrote" : "wrote"} ${file}`);
};

if (write) fs.mkdirSync(CONTENT, { recursive: true });

for (const damageType of DAMAGE_TYPES) {
  if (only && damageType !== only) continue;
  emit(`${damageType}.md`, renderWorksheet(damageType, sectionsFor(damageType)));
}
if (!only) emit("mortal.md", renderMortalWorksheet(mortalRows()));

if (!write) console.error("\n(dry run — pass --write to create the worksheets)");
