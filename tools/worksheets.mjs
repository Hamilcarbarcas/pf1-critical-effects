/* The mortal worksheet — parse and format `content/mortal.md`.
 *
 * Mortal is the one piece of effect content that is NOT pool-shaped, which is why it still has a
 * worksheet of its own while the per-damage-type worksheets have been retired in favour of
 * `data/pool.json`. The 13+ addendum is authored once per anatomy × location and is damage-type
 * agnostic, so there is nothing to tag and nothing to select: it is thirteen rows, one per body
 * part, and a markdown table is the right shape for that.
 *
 *   | Body part        | Effect        | Mechanic                        |
 *   |------------------|---------------|---------------------------------|
 *   | Humanoid · Arm   | Arm Torn Away | The arm is severed at the …     |
 *
 * `tools/pool-to-tables.mjs` reads this alongside the pool and writes both into `effects.json`.
 * Prose sections after the table are ignored, so GM notes can live in the same file.
 */

import { ANATOMY_LOCATIONS } from "../src/catalog/schema.mjs";

export const STATUSES = ["draft", "approved"];

export const slug = (name) =>
  String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** `Humanoid · Arm` -> `{ anatomy, location }`. Punctuation between the two is not load-bearing. */
export function parseSectionHeading(text) {
  const parts = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const anatomy = parts.find((p) => p in ANATOMY_LOCATIONS);
  if (!anatomy) return null;
  const location = parts.find((p) => ANATOMY_LOCATIONS[anatomy].includes(p));
  return location ? { anatomy, location } : null;
}

export const sectionHeading = (anatomy, location) => `${titleCase(anatomy)} · ${titleCase(location)}`;

/** Split a markdown table row into trimmed cells, tolerating ragged padding and missing edge pipes. */
const cells = (line) =>
  line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

const isSeparatorRow = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

/**
 * Parse content/mortal.md — one row per anatomy × location, no row numbers.
 *
 * Structural faults are collected rather than thrown: this is a document a person is editing, so
 * everything wrong with it wants reporting at once.
 *
 * @returns {{ status: string, rows: object[], problems: string[] }}
 */
export function parseMortalWorksheet(text, where = "mortal.md") {
  const problems = [];
  const rows = [];
  const lines = String(text).split(/\r?\n/);
  let status = "draft";

  for (const [i, line] of lines.entries()) {
    const at = `${where}:${i + 1}`;

    const declared = /^\s*\*\*Status:\*\*\s*(\w+)/i.exec(line);
    if (declared) {
      const value = declared[1].toLowerCase();
      if (!STATUSES.includes(value)) problems.push(`${at}: unknown status "${declared[1]}"`);
      else status = value;
      continue;
    }

    if (!line.trim().startsWith("|") || isSeparatorRow(line)) continue;

    const [body, effect = "", mechanic = ""] = cells(line);
    const parsed = parseSectionHeading(body);
    if (!parsed) continue; // header row, or a table that isn't this one

    rows.push({ ...parsed, name: effect, mechanic });
  }

  const seen = new Set();
  for (const row of rows) {
    const key = `${row.anatomy}/${row.location}`;
    if (seen.has(key)) problems.push(`${where}: ${key} appears twice`);
    seen.add(key);
  }

  return { status, rows, problems };
}

/** Pad every column to its widest cell so the table stays readable in an editor. */
function renderTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
  const line = (cs) => `| ${cs.map((c, i) => (c ?? "").padEnd(widths[i])).join(" | ")} |`;
  return [line(header), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...rows.map(line)].join("\n");
}

/** Render content/mortal.md from scratch. `rows` is keyed `"<anatomy>/<location>"`. */
export function renderMortalWorksheet(rows, status = "draft") {
  const table = [];
  for (const [anatomy, locations] of Object.entries(ANATOMY_LOCATIONS)) {
    for (const location of locations) {
      const entry = rows[`${anatomy}/${location}`] ?? {};
      table.push([sectionHeading(anatomy, location), entry.name ?? "", entry.mechanic ?? ""]);
    }
  }

  return [
    "# Mortal",
    "",
    "The **13+** addendum, one per anatomy × location and damage-type agnostic — past row 12 the",
    "wound has stopped being characterised by what made it and is simply killing them.",
    "",
    "Read **on top of** row 12, never instead of it, and always alongside the Fort save",
    "(DC = the Critical Power total) the 13+ clamp already carries. So the Mechanic column is the",
    "*extra* — what this body part does to someone past saving, not a restatement of row 12.",
    "",
    `**Status:** ${status}`,
    "",
    renderTable(["Body part", "Effect", "Mechanic"], table),
    "",
  ].join("\n");
}
