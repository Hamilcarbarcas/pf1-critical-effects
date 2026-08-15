#!/usr/bin/env node
/* merge-flavor — tools/flavor.json -> the `text` field of data/pool.json.
 *
 * A first pass of prose for the imported catalogue, kept in its own file so the import and the
 * writing could happen independently. Prose only: `text` is display-only by contract (§3) and
 * nothing in the engine parses it, so a line here must never carry a mechanic the card would then
 * show twice — once as prose and once from the entry's own channels.
 *
 * Fills only entries whose `text` is still null, so a hand-edited line is never overwritten.
 * `--force` overwrites everything, which is what you want after rewriting flavor.json wholesale.
 *
 *   node tools/merge-flavor.mjs [--write] [--force]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POOL = path.join(ROOT, "data", "pool.json");
const FLAVOR = path.join(ROOT, "tools", "flavor.json");

const WRITE = process.argv.includes("--write");
const FORCE = process.argv.includes("--force");

const pool = JSON.parse(fs.readFileSync(POOL, "utf8"));
const flavor = JSON.parse(fs.readFileSync(FLAVOR, "utf8"));

let filled = 0, kept = 0;
const missing = [];
const unused = new Set(Object.keys(flavor).filter((k) => !k.startsWith("_")));

for (const entry of pool.entries) {
  unused.delete(entry.id);
  const line = flavor[entry.id];
  if (!line) { missing.push(entry.id); continue; }
  if (entry.text && !FORCE) { kept += 1; continue; }
  // Stored as HTML because that is what the card enriches — one paragraph, no wrapper markup.
  entry.text = `<p>${line}</p>`;
  filled += 1;
}

console.error(`entries  : ${pool.entries.length}`);
console.error(`filled   : ${filled}${kept ? `, ${kept} left as authored` : ""}`);
if (missing.length) {
  console.error(`no flavor: ${missing.length}`);
  for (const id of missing) console.error(`  - ${id}`);
}
if (unused.size) {
  console.error(`orphaned : ${unused.size} flavor lines match no entry`);
  for (const id of unused) console.error(`  - ${id}`);
}

if (WRITE) {
  fs.writeFileSync(POOL, `${JSON.stringify(pool, null, 2)}\n`);
  console.error("\nwrote data/pool.json");
} else {
  console.error("\n(dry run — pass --write to save)");
}
