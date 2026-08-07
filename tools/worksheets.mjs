/* The mortal worksheet — parse and format `content/mortal.md`.
 *
 * Mortal is the one piece of effect content that is NOT pool-shaped, which is why it still has a
 * worksheet of its own while the per-damage-type worksheets have been retired in favour of
 * `data/pool.json`. There is nothing to tag and nothing to select: every cell is written exactly
 * once, and a markdown table is the right shape for that.
 *
 * **Two tables, because the two halves are keyed by different axes** (`mortalCells`). The weapon
 * damage types share a mortal per body part; everything else shares one per damage type.
 *
 *   | Body part        | Effect        | Mechanic                        |
 *   |------------------|---------------|---------------------------------|
 *   | Humanoid · Arm   | Arm Torn Away | The arm is severed at the …     |
 *
 *   | Damage type      | Effect        | Mechanic                        |
 *   |------------------|---------------|---------------------------------|
 *   | Fire             | Burned to Ash | Nothing recognisable is left …  |
 *
 * Both are parsed by the same walk: every table row is classified by its first cell, so the two
 * can sit anywhere in the file in any order. `tools/pool-to-tables.mjs` reads this alongside the
 * pool and writes both into `effects.json`. Prose sections are ignored, so GM notes can live in
 * the same file.
 */

import {
  ANATOMY_LOCATIONS,
  DAMAGE_TYPE_LABELS,
  generalDamageTypes,
  mortalCells,
} from "../src/catalog/schema.mjs";

export const STATUSES = ["draft", "approved"];

export const slug = (name) =>
  String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A mortal row's first cell -> which cell of the grid it names, or null if it names neither.
 *
 * Two forms, and which one it is decides which half of `mortal` the row lands in:
 *
 *   `Humanoid · Arm`   -> `{ kind: "part", anatomy, location }`   punctuation is not load-bearing
 *   `Fire`, `Force`    -> `{ kind: "damageType", damageType }`    key or display label, either way
 *
 * Returning null is how the walk skips a header row or a table that isn't one of these — a normal
 * outcome, not a fault.
 */
export function parseSectionHeading(text) {
  const parts = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);

  const anatomy = parts.find((p) => p in ANATOMY_LOCATIONS);
  if (anatomy) {
    const location = parts.find((p) => ANATOMY_LOCATIONS[anatomy].includes(p));
    return location ? { kind: "part", anatomy, location } : null;
  }

  /* Matched on the registry key OR the display label, because the two diverge: `electric` is
   * written "Electricity" and `positive` is written "Positive Energy". Only the non-localized types
   * are candidates — the weapon types take their mortal from the body-part table. */
  const phrase = parts.join(" ");
  const damageType = generalDamageTypes().find(
    (dt) => parts.includes(dt) || DAMAGE_TYPE_LABELS[dt]?.toLowerCase() === phrase
  );
  return damageType ? { kind: "damageType", damageType } : null;
}

/** The first-cell text for a cell of either half. */
export const sectionHeading = (cell) =>
  cell.kind === "part"
    ? `${titleCase(cell.anatomy)} · ${titleCase(cell.location)}`
    : (DAMAGE_TYPE_LABELS[cell.damageType] ?? titleCase(cell.damageType));

/** Split a markdown table row into trimmed cells, tolerating ragged padding and missing edge pipes. */
const cells = (line) =>
  line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

const isSeparatorRow = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

/**
 * Parse content/mortal.md — one row per grid cell, no row numbers.
 *
 * Both tables are walked in one pass: a line is a row if its first cell names a body part or a
 * non-localized damage type, so the two tables need no markers and can appear in either order.
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
    const key = row.kind === "part" ? `${row.anatomy}/${row.location}` : row.damageType;
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

/**
 * Render content/mortal.md from scratch.
 *
 * `rows` is keyed by `mortalCells().key` — `"humanoid/arm"` for a body part, `"fire"` for a damage
 * type. The two never collide, because only the first form contains a slash.
 */
export function renderMortalWorksheet(rows, status = "draft") {
  const row = (cell) => {
    const entry = rows[cell.key] ?? {};
    return [sectionHeading(cell), entry.name ?? "", entry.mechanic ?? ""];
  };

  const grid = mortalCells();
  const parts = grid.filter((c) => c.kind === "part").map(row);
  const damageTypes = grid.filter((c) => c.kind === "damageType").map(row);

  return [
    "# Mortal",
    "",
    "The **13+** addendum — past row 12 the wound has stopped being a wound and is simply killing",
    "them.",
    "",
    "Read **on top of** row 12, never instead of it, and always alongside the Fort save",
    "(DC = the Critical Power total) the 13+ clamp already carries. So the Mechanic column is the",
    "*extra* — what this result does to someone past saving, not a restatement of row 12.",
    "",
    `**Status:** ${status}`,
    "",
    "## By body part",
    "",
    "For **bludgeoning, piercing and slashing**. Damage-type agnostic: a torn-off arm is a torn-off",
    "arm whether a sword or a mace did it, so what is left to name is the body part.",
    "",
    renderTable(["Body part", "Effect", "Mechanic"], parts),
    "",
    "## By damage type",
    "",
    "For everything else. Those types roll no hit location, so there is no body part to name and the",
    "damage type is the whole of what distinguishes the result. Anatomy drops out on this side — a",
    "mortal fire result is the same story for a humanoid and a beast.",
    "",
    renderTable(["Damage type", "Effect", "Mechanic"], damageTypes),
    "",
  ].join("\n");
}
