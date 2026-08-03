/* Worksheet format — the shared parse/format half of the content-authoring round trip.
 *
 * Effect content is authored in `content/*.md` rather than directly in `data/effects.json`,
 * because 1,560 rows of JSON is not reviewable and a markdown table is. The two tools that use
 * this module are inverses of each other:
 *
 *   scaffold-worksheets.mjs   effects.json -> content/*.md
 *   worksheets-to-catalog.mjs content/*.md -> effects.json
 *
 * Round-tripping is the invariant that makes that safe: scaffolding an untouched catalog and
 * folding it straight back in must produce the same JSON. If it doesn't, the parser and the
 * formatter disagree about something and one of them is losing content.
 *
 * ── The format ──────────────────────────────────────────────────────────────
 *
 *   # Bludgeoning
 *
 *   ## Humanoid · Arm
 *   **Status:** draft
 *
 *   |  # | Band  | Effect         | Mechanic                                     |
 *   |---:|-------|----------------|----------------------------------------------|
 *   |  1 | Minor | Jammed Thumb   | -1 on attack rolls with this arm for 1 minute |
 *   …
 *   | 12 | Grave | …              | …                                            |
 *
 * One file per damage type, one section per anatomy × location, twelve rows per section grouped
 * into the four severity bands (1-3 minor, 4-6 moderate, 7-9 severe, 10-12 grave). `Band` is
 * derived from the row number and is written out only so the ladder is visible while authoring —
 * it is checked, never trusted.
 *
 * **Status is the review gate.** `worksheets-to-catalog` folds in `approved` sections and skips
 * `draft` ones, so a half-written file is safe to leave on disk and content lands one reviewed
 * table at a time.
 *
 * ── The mortal worksheet ────────────────────────────────────────────────────
 *
 * `content/mortal.md` is shaped differently because the data is: the 13+ addendum is authored
 * once per anatomy × location and is damage-type agnostic, so it is 13 rows in one file rather
 * than a section in each of the ten. Same status gate, one row per section.
 *
 * ── Shorthands ──────────────────────────────────────────────────────────────
 *
 * An Effect cell of `= humanoid` (or `= beast`) reuses whatever entry that anatomy's table has
 * at the same row, for the same damage type and location. It exists because the grid is 13
 * anatomy × location pairs and some rows genuinely are the same wound — a crossbow bolt through
 * a shoulder is a crossbow bolt through a shoulder. It is an AUTHORING shorthand only: it
 * expands at fold-in time and `effects.json` stays fully explicit, because the engine looks a
 * row up by index and must never have to chase a reference to find one.
 *
 * An empty Effect cell is an unwritten row. It folds in as a `placeholder` entry, which is what
 * keeps "12 rows, always" true while lint() reports the row as still to author.
 */

import { ANATOMY_LOCATIONS, SEVERITY_BANDS, TABLE_ROWS, bandForRow, DAMAGE_TYPE_LABELS } from "../src/catalog/schema.mjs";

export const STATUSES = ["draft", "approved"];

/** `= humanoid` / `= beast` — reuse another anatomy's row. */
const SAME_AS = /^=\s*(humanoid|beast|aberrant)$/i;

export const slug = (name) =>
  String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** `## Humanoid · Arm` -> `{ anatomy, location }`. Punctuation between the two is not load-bearing. */
export function parseSectionHeading(text) {
  const parts = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const anatomy = parts.find((p) => p in ANATOMY_LOCATIONS);
  if (!anatomy) return null;
  const location = parts.find((p) => ANATOMY_LOCATIONS[anatomy].includes(p));
  return location ? { anatomy, location } : null;
}

export const sectionHeading = (anatomy, location) => `${titleCase(anatomy)} · ${titleCase(location)}`;

/** Split a markdown table row into trimmed cells, tolerating ragged padding and missing edge pipes. */
function cells(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

const isSeparatorRow = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

/**
 * Parse one worksheet file.
 *
 * Structural faults are collected rather than thrown: a worksheet is a document a person is
 * editing, so "section 4 has 11 rows" needs to be reported alongside everything else that is
 * wrong, not instead of it.
 *
 * @param {string} text
 * @param {string} where  file label, for problem messages
 * @returns {{ sections: object[], problems: string[] }}
 */
export function parseWorksheet(text, where = "worksheet") {
  const problems = [];
  const sections = [];
  const lines = String(text).split(/\r?\n/);

  let current = null;
  const close = () => {
    if (!current) return;
    if (current.rows.length !== TABLE_ROWS) {
      problems.push(`${where}: ${sectionHeading(current.anatomy, current.location)} has ${current.rows.length} rows, expected ${TABLE_ROWS}`);
    }
    sections.push(current);
    current = null;
  };

  for (const [i, line] of lines.entries()) {
    const at = `${where}:${i + 1}`;

    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      close();
      const parsed = parseSectionHeading(heading[1]);
      if (!parsed) {
        problems.push(`${at}: "${heading[1].trim()}" is not a recognised anatomy · location heading`);
        continue;
      }
      current = { ...parsed, status: "draft", rows: [] };
      continue;
    }

    const status = /^\s*\*\*Status:\*\*\s*(\w+)/i.exec(line);
    if (status && current) {
      const value = status[1].toLowerCase();
      if (!STATUSES.includes(value)) problems.push(`${at}: unknown status "${status[1]}" (expected ${STATUSES.join(" | ")})`);
      else current.status = value;
      continue;
    }

    if (!current || !line.trim().startsWith("|") || isSeparatorRow(line)) continue;

    const [num, band, effect = "", mechanic = ""] = cells(line);
    const row = Number.parseInt(num, 10);
    if (!Number.isInteger(row)) continue; // the header row, or prose that happens to start with a pipe

    if (row < 1 || row > TABLE_ROWS) {
      problems.push(`${at}: row number ${row} is outside 1-${TABLE_ROWS}`);
      continue;
    }
    if (current.rows.some((r) => r.row === row)) {
      problems.push(`${at}: row ${row} appears twice in ${sectionHeading(current.anatomy, current.location)}`);
      continue;
    }
    const expectedBand = bandForRow(row);
    if (band && band.toLowerCase() !== expectedBand.key) {
      problems.push(`${at}: row ${row} is banded "${band}" but rows ${expectedBand.rows.join("-")} are ${expectedBand.label}`);
    }

    const sameAs = SAME_AS.exec(effect);
    current.rows.push({
      row,
      name: sameAs ? null : effect,
      mechanic,
      sameAs: sameAs ? sameAs[1].toLowerCase() : null,
    });
  }

  close();
  return { sections, problems };
}

/** Parse content/mortal.md — one row per anatomy × location, no row numbers. */
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
    if (!parsed) continue; // header row

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

// --- formatting -------------------------------------------------------------

/** Pad every column to its widest cell so the table stays readable in an editor. */
function renderTable(header, rows, align = []) {
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
  const pad = (text, c) => (align[c] === "right" ? (text ?? "").padStart(widths[c]) : (text ?? "").padEnd(widths[c]));

  const line = (cells) => `| ${cells.map((cell, c) => pad(cell, c)).join(" | ")} |`;
  const rule = `|${widths.map((w, c) => (align[c] === "right" ? "-".repeat(w + 1) + ":" : "-".repeat(w + 2))).join("|")}|`;

  return [line(header), rule, ...rows.map(line)].join("\n");
}

/**
 * Render one damage type's worksheet.
 *
 * @param {string} damageType
 * @param {object} sections  { "<anatomy>/<location>": { status, rows: [{ row, name, mechanic }] } }
 */
export function renderWorksheet(damageType, sections) {
  const label = DAMAGE_TYPE_LABELS[damageType] ?? titleCase(damageType);
  const out = [
    `# ${label}`,
    "",
    `Effect tables for **${label}** damage. One section per anatomy × location; twelve rows each,`,
    "mildest first. Format and shorthands: [content/README.md](README.md).",
    "",
    "Set a section's **Status** to `approved` and run `node tools/worksheets-to-catalog.mjs --write`",
    "to fold it into `data/effects.json`. Sections left at `draft` are ignored.",
    "",
  ];

  for (const [anatomy, locations] of Object.entries(ANATOMY_LOCATIONS)) {
    for (const location of locations) {
      const section = sections[`${anatomy}/${location}`] ?? { status: "draft", rows: [] };
      const byRow = new Map(section.rows.map((r) => [r.row, r]));

      const rows = [];
      for (const band of SEVERITY_BANDS) {
        for (let row = band.rows[0]; row <= band.rows[1]; row++) {
          const entry = byRow.get(row) ?? {};
          rows.push([String(row), band.label, entry.name ?? "", entry.mechanic ?? ""]);
        }
      }

      out.push(
        `## ${sectionHeading(anatomy, location)}`,
        `**Status:** ${section.status}`,
        "",
        renderTable(["#", "Band", "Effect", "Mechanic"], rows, ["right"]),
        ""
      );
    }
  }

  return out.join("\n");
}

/** Render content/mortal.md. `rows` is keyed `"<anatomy>/<location>"`. */
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
