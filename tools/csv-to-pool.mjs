/* One-time import: the authoring spreadsheet -> data/pool.json + content/mortal.md.
 *
 * The catalog was authored in Excel, one row per (effect x location x damage type), and this
 * turns that grid back into the two files the build pipeline already reads. It is a **migration**,
 * not a stage of the build: after it has run, `pool.json` is the source of truth again and the
 * spreadsheet is history. Nothing else imports this file.
 *
 *   node tools/csv-to-pool.mjs ["../Critical Effects.csv"] [--write]
 *
 * Without --write it reports what it would produce and touches nothing.
 *
 * ── What the columns mean ───────────────────────────────────────────────────
 * Effect / Description / Damage / Buff / Condition / Save / Save Condition / Save Buff /
 * Location / Human? / Beast? / Aber? / Severity / B? / P? / S? / Other
 *
 * `Severity` is the rank, or "13+" for a mortal row. `Location` is blank for the damage types that
 * roll no hit location, which become `<anatomy>/general` slots. The three anatomy columns and the
 * four damage-type columns are the tags; everything else is content.
 *
 * ── Rows collapse ───────────────────────────────────────────────────────────
 * One effect written once per limb is ONE pool entry with several slots — "Piercing Blow" is seven
 * rows in the sheet and one entry here. Rows collapse when their mechanics are identical; when
 * they are not, the sheet is telling us two different wounds share a name, and that is reported
 * rather than merged.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANATOMY_LOCATIONS, GENERAL_SLOT } from "../src/catalog/schema.mjs";
import { canonical } from "./naming.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const SOURCE = process.argv.find((a) => a.endsWith(".csv")) ?? path.join(ROOT, "..", "Critical Effects.csv");

// --- CSV ---------------------------------------------------------------------

/** RFC 4180: quoted fields may contain commas, newlines and doubled quotes. */
function parseCSV(str) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quoted) {
      if (c === '"') { if (str[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* CRLF: the \n does the work */ }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const COLUMNS = ["effect", "description", "damage", "buff", "condition", "save", "saveCondition",
  "saveBuff", "location", "human", "beast", "aber", "severity", "B", "P", "S", "other"];

const source = fs.readFileSync(SOURCE, "utf8").replace(/^﻿/, "");
const raw = parseCSV(source).filter((r) => r.some((c) => c.trim() !== ""));
const rows = raw.slice(1).map((r) => Object.fromEntries(COLUMNS.map((k, i) => [k, (r[i] ?? "").trim()])));

const problems = [];
const notes = [];
const blank = (v) => !v || v === "-";
const lines = (v) => (blank(v) ? [] : v.split("\n").map((s) => s.trim()).filter(Boolean));
/* The damage column separates parts by newline in most rows and by comma in a few ("2d6 str, 2d6
 * dex"). Both mean the same thing, so both split — no other column has a comma-separated list. */
const parts = (v) => lines(v).flatMap((l) => l.split(/,\s*/)).map((s) => s.trim()).filter(Boolean);
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// --- the small vocabularies the sheet writes in ------------------------------

/** Condition labels as authored -> PF1 registry ids. Everything else matches its id already. */
const CONDITION_ALIASES = {
  deafened: "deaf", blinded: "blind", "flat footed": "flatFooted", die: "dead", dead: "dead",
};

const UNITS = { rd: "round", rds: "round", round: "round", rounds: "round", min: "minute",
  minute: "minute", minutes: "minute", hr: "hour", hour: "hour", day: "day", turn: "turn" };

/**
 * A bleed, written as `NdX [deep] [<ability>] bleed`.
 *
 * The dedicated-healing threshold is **derived, never authored**: 5 hit points per die of
 * hit-point bleed, 10 per die of ability bleed. That keeps the number and the dice in step, which
 * matters most for the 13+ rows where doubling the dice has to double the threshold too.
 */
const BLEED = /^(\d+)d(\d+)\s+(deep\s+)?(con|str|strength|dex|dexterity|constitution|int|wis|cha)?\s*bleed$/i;
const ABILITY = { con: "con", constitution: "con", str: "str", strength: "str", dex: "dex",
  dexterity: "dex", int: "int", wis: "wis", cha: "cha" };

function parseCondition(text, where) {
  const t = text.trim();

  const bleed = t.match(BLEED);
  if (bleed) {
    const [, count, die, deep, ability] = bleed;
    const key = ability ? ABILITY[ability.toLowerCase()] : null;
    const block = { formula: `${count}d${die}` };
    if (key) block.ability = key;
    if (deep) block.deep = (key ? 10 : 5) * Number(count);
    return { id: "bleed", bleed: block };
  }

  /* Everything else is `<condition> [<amount> <unit>]` — "Staggered 1d4 rds", "Panicked 1 min",
   * or a bare "Prone". A duration with no unit is a round, which is what every such row means. */
  const m = t.match(/^([A-Za-z][A-Za-z ]*?)\s*(?:(\d+d\d+|\d+)\s*([A-Za-z]+)?)?$/);
  if (!m) { problems.push(`${where}: cannot read condition "${t}"`); return null; }

  const label = m[1].trim().toLowerCase();
  const id = CONDITION_ALIASES[label] ?? label.replace(/\s+/g, "");
  const condition = { id };
  if (m[2]) {
    const units = m[3] ? UNITS[m[3].toLowerCase()] : "round";
    if (!units) { problems.push(`${where}: unknown duration unit "${m[3]}" in "${t}"`); return null; }
    condition.duration = { value: /d/.test(m[2]) ? m[2] : Number(m[2]), units };
  }
  return condition;
}

/**
 * A damage cell. Three shapes appear, and only the first is an ordinary damage part:
 *   "2d6 str dmg"        -> ability damage, via Nevela's registered types
 *   "Max HP non-lethal"  -> nonlethal equal to the target's maximum, hence `@target.`
 *   "Current HP + 1"     -> not damage at all; a `setHP` assertion (see schema)
 *   "1d4 level drain"    -> negative levels, via pf1-improved-energy-drain
 */
function parseDamage(text, where) {
  const t = text.trim();

  if (/^current\s+hp\s*\+\s*1$/i.test(t)) return { setHP: -1 };
  if (/non-?lethal/i.test(t) && /max|total/i.test(t)) {
    return { part: { formula: "@target.attributes.hp.max", type: "nonlethal" } };
  }
  const drain = t.match(/^(\d+d\d+|\d+|HD\s*-\s*1)\s+(?:level\s+)?drain$/i);
  if (drain) return { negativeLevels: /^HD/i.test(drain[1]) ? "@attributes.hd.total - 1" : drain[1] };

  const abil = t.match(/^(\d+d\d+|\d+)\s+(con|str|strength|dex|dexterity|constitution)\s*(dmg|damage|drain)?$/i);
  if (abil) {
    const key = ABILITY[abil[2].toLowerCase()];
    const long = { con: "constitution", str: "strength", dex: "dexterity" }[key];
    const kind = /drain/i.test(abil[3] ?? "") ? "drain" : "damage";
    return { part: { formula: abil[1], type: `${long} ${kind}` } };
  }

  const plain = t.match(/^(\d+d\d+|\d+)\s+(\w+)$/);
  if (plain) return { part: { formula: plain[1], type: plain[2].toLowerCase() } };

  problems.push(`${where}: cannot read damage "${t}"`);
  return null;
}

// --- buff cells --------------------------------------------------------------

/** Buff cells that are GM adjudication lines rather than buffs. They import as `note`. */
const NOTE_CELLS = new Set(["Signature Slash", "Holy Unmaking"]);

/** Buff-name corrections settled during review. Applied to the buff, never to the effect's name. */
const BUFF_RENAMES = new Map([
  ["Lodged Weapon", "Impaled Arm"],
  ["Lodging Blow", "Impaled Appendage"],
  ["Crushed Appendage", "Appendage Destroyed"],
  ["Shattered Vertebrae", "Tail Destroyed"],
  ["Skewered Tail", "Tail Destroyed"],
]);

/**
 * The buff a cell names. The description half is reference material for building the compendium
 * item (see content/BUFFS.md) and is deliberately dropped here — the catalog stores a NAME, which
 * is what astora-mod's `applyBuffTo` takes.
 */
function parseBuff(cell, effect) {
  const c = cell.replace(/\s+/g, " ").trim();
  if (/^as name\b/i.test(c)) return canonical(effect);

  const repeat = c.match(/^(.*?)\s*-\s*repeat$/i);
  if (repeat) return canonical(repeat[1]);

  const named = c.match(/^([^:]{1,40}):\s*(.*)$/);
  if (named && !/\d+d\d+/.test(named[1]) && !/,/.test(named[1])) return canonical(named[1]);

  // A trailing parenthetical glosses the name rather than being part of it.
  const gloss = c.match(/^([^(]{1,46})\((.+)\)\s*$/);
  const head = (gloss ? gloss[1] : c).trim();
  if (head.length <= 46 && !/,/.test(head) && !/\d+d\d+/.test(head)) return canonical(head);

  return canonical(effect); // prose: the buff is named after its effect
}

// --- the 13+ rows ------------------------------------------------------------

/**
 * A mortal row that reads *"As 12, …"* is not describing its own mechanics — it is describing a
 * modification of the row-12 result, which differs in every cell it covers. Those rows import as
 * `inherits: "row12"` plus a transform, and their Buff and Condition columns are **deliberately
 * ignored**: the sheet spells the doubled values out by hand for a human reader, and importing
 * them alongside the inherited ones would apply everything twice.
 *
 * It is also what lets one entry serve every limb. "Kebabed" is four rows in the sheet with four
 * different buffs; as a transform it is one entry whose buff comes from whichever row 12 it lands
 * on, which is why the four stopped colliding.
 */
const INHERITS = /^as\s+12\b/i;

/** Additions the prose states but no keyword can be read out of. Small, and meant to stay small. */
const ADDITIONS = {
  "pulverized-tail": { conditions: [{ id: "entangled" }] },
  "wing-pulverized": { conditions: [{ id: "entangled" }] },
  "pulped-appendage": { conditions: [{ id: "entangled" }] },
  encased: { buffs: ["Encased"] }, // row 12 plus suffocation, authored as one buff
};

/**
 * Read a transform out of a 13+ row's description.
 *
 * The vocabulary is tiny because the content is: double the bleed, double the DC, add a damage
 * part. Anything the keywords miss is reported rather than guessed at, so a new phrasing surfaces
 * as a build note instead of silently importing as a no-op transform.
 */
function parseTransform(r, id) {
  const d = r.description;
  const transform = {};

  if (/\bbleed\b[^.]*\bdoubled\b|\bdouble\s+bleed\b/i.test(d)) {
    transform.bleed = 2;
    // Thresholds are derived from dice count, so doubled dice must carry a doubled threshold.
    transform.scaleDH = true;
  }
  if (/\bDC\b[^.]*\bdoubled\b|\bdouble\s+DC\b|\bdoubled\s+DC\b/i.test(d)) transform.saveDC = 2;

  const added = d.match(/\+\s*(\d+d\d+)\s+damage/i);
  if (added) transform.damage = [{ formula: added[1], type: "untyped" }];

  Object.assign(transform, ADDITIONS[id] ?? {});

  if (!Object.keys(transform).length) {
    notes.push(`"${r.effect}": reads "as 12" but no transform could be read from "${d}" — it will inherit row 12 unchanged`);
  }
  return transform;
}

// --- row -> entry ------------------------------------------------------------

const damageTypesOf = (r) => {
  const out = [];
  if (r.B === "Y") out.push("bludgeoning");
  if (r.P === "Y") out.push("piercing");
  if (r.S === "Y") out.push("slashing");
  if (!blank(r.other)) out.push(r.other.toLowerCase() === "electricity" ? "electric" : r.other.toLowerCase());
  return out;
};

const anatomiesOf = (r) =>
  [["human", "humanoid"], ["beast", "beast"], ["aber", "aberrant"]]
    .filter(([col]) => r[col] === "Y").map(([, a]) => a);

function slotsOf(r) {
  const location = blank(r.location) ? GENERAL_SLOT : r.location.toLowerCase();
  const anatomies = anatomiesOf(r);
  // `*/x` when every anatomy that HAS this location is tagged — it keeps applying if one is added.
  const all = Object.entries(ANATOMY_LOCATIONS)
    .filter(([, ls]) => location === GENERAL_SLOT || ls.includes(location)).map(([a]) => a);
  const covers = all.every((a) => anatomies.includes(a));
  return covers ? [`*/${location}`] : anatomies.map((a) => `${a}/${location}`);
}

/** The mechanical half of a row, which is what decides whether two rows are the same entry. */
function mechanicsOf(r, where) {
  const out = { buffs: [], conditions: [], damage: [], setHP: null, negativeLevels: null,
    save: null, onFail: null, note: null };

  if (!blank(r.buff)) {
    if (NOTE_CELLS.has(r.effect)) out.note = r.buff.replace(/\s+/g, " ").trim();
    else {
      /* Every buff the cell names, in authoring order — the wound first, then whatever holds it
       * open. Thirteen rows name two; before `buffs` was an array the second was demoted to an
       * adjudication `note`, which meant the catalog described an effect it could not perform. */
      out.buffs = lines(r.buff).map((cell) => {
        const name = parseBuff(cell, r.effect);
        return BUFF_RENAMES.get(name) ?? name;
      });
    }
  }

  for (const line of lines(r.condition)) {
    const c = parseCondition(line, where);
    if (c) out.conditions.push(c);
  }
  for (const line of parts(r.damage)) {
    const d = parseDamage(line, where);
    if (!d) continue;
    if (d.part) out.damage.push(d.part);
    if (d.setHP != null) out.setHP = d.setHP;
    if (d.negativeLevels) out.negativeLevels = d.negativeLevels;
  }

  if (!blank(r.save)) {
    const n = Number(r.save);
    if (n === 1 || n === 2) out.save = n;
    else problems.push(`${where}: save "${r.save}" must be 1 or 2`);
  }

  /* The failed branch. A channel the sheet leaves blank falls through to the base one, which is
   * exactly `onFail`'s contract — so only the columns that ARE filled become overrides. */
  const failConditions = lines(r.saveCondition).map((l) => parseCondition(l, where)).filter(Boolean);
  const failBuff = blank(r.saveBuff) ? null : parseBuff(r.saveBuff, r.effect);
  if (failConditions.length || failBuff) {
    out.onFail = {};
    if (failBuff) out.onFail.buffs = [BUFF_RENAMES.get(failBuff) ?? failBuff];
    if (failConditions.length) out.onFail.conditions = failConditions;
  }

  return out;
}

// --- build -------------------------------------------------------------------

const MORTAL = "13+";
const byId = new Map();

for (const r of rows) {
  const where = `"${r.effect}" [${r.location || r.other} ${r.severity}]`;
  const id = slug(canonical(r.effect));
  const rank = r.severity === MORTAL ? null : Number(r.severity);

  if (r.severity !== MORTAL && !Number.isInteger(rank)) {
    problems.push(`${where}: severity "${r.severity}" is neither 1-12 nor "${MORTAL}"`);
    continue;
  }

  /* An inheriting row keeps its own save and failed branch. Several 13+ results add a save the
   * row-12 result never had — "As 12, Fortitude or die" — and that is the row's own mechanic, not
   * something to read off the parent. `resolveInherited` prefers the parent's save when it has one
   * (multiplied by `saveDC`) and falls back to these otherwise. */
  const inheriting = r.severity === MORTAL && INHERITS.test(r.description);
  const own = mechanicsOf(r, where);
  /* Only a NON-inheriting row can be missing a failed branch: an inheriting one takes the
   * parent's, which is where every save-or-die at row 12 already keeps it. */
  if (!inheriting && own.save != null && own.onFail == null) {
    notes.push(`${where}: has a save but no failed-branch column, so both branches apply the same thing`);
  }
  const mech = inheriting
    ? {
      inherits: "row12",
      transform: parseTransform(r, id),
      ...(own.save != null ? { save: own.save } : {}),
      ...(own.onFail != null ? { onFail: own.onFail } : {}),
    }
    : mechanicsOf(r, where);

  const signature = JSON.stringify(mech);
  const existing = byId.get(id);

  if (!existing) {
    byId.set(id, {
      id, name: canonical(r.effect), rank,
      slots: slotsOf(r), damageTypes: damageTypesOf(r),
      mortal: r.severity === MORTAL, signature, mech,
      rows: [r],
    });
    continue;
  }

  /* Same name, same mechanics: one entry, more tags. Same name, DIFFERENT mechanics: two wounds
   * wearing one name, which the id cannot express and a merge would silently pick a winner for. */
  if (existing.signature !== signature || existing.rank !== rank) {
    problems.push(`${where}: shares the id "${id}" with a row that has different ${existing.rank !== rank ? "rank" : "mechanics"} — give one of them its own name`);
    continue;
  }
  existing.slots = [...new Set([...existing.slots, ...slotsOf(r)])];
  existing.damageTypes = [...new Set([...existing.damageTypes, ...damageTypesOf(r)])];
  existing.rows.push(r);
}

// Collapse `humanoid/x + beast/x + aberrant/x` back to the wildcard slot after all rows have been
// folded in — an effect written one limb per row only becomes universal once the last row arrives.
for (const entry of byId.values()) {
  const byLocation = new Map();
  for (const slot of entry.slots) {
    const [anatomy, location] = slot.split("/");
    if (!byLocation.has(location)) byLocation.set(location, new Set());
    byLocation.get(location).add(anatomy);
  }
  entry.slots = [...byLocation].map(([location, anatomies]) => {
    if (anatomies.has("*")) return `*/${location}`;
    const all = Object.entries(ANATOMY_LOCATIONS)
      .filter(([, ls]) => location === GENERAL_SLOT || ls.includes(location)).map(([a]) => a);
    return all.every((a) => anatomies.has(a)) ? `*/${location}` : [...anatomies].map((a) => `${a}/${location}`);
  }).flat();
}

export { byId, problems, notes, rows, blank, lines, slug, canonical as canonicalName };

// --- emit --------------------------------------------------------------------

/** Drop the empty channels: an absent field and an empty one mean the same thing and one is noise. */
function poolEntry(e) {
  const m = e.mech;
  return {
    id: e.id,
    name: e.name,
    rank: e.rank,
    /* A mortal entry is unranked because it sits past row 12, not because nobody has triaged it.
     * Marked so the coverage report can tell "deliberately outside the ladder" from "inventory
     * waiting for a rank", which are the same `rank: null` and opposite situations. */
    ...(e.mortal ? { mortal: true } : {}),
    slots: e.slots.sort(),
    damageTypes: e.damageTypes.sort(),
    text: e.text ?? null,
    ...(m.note ? { note: m.note } : {}),
    ...(m.buffs?.length ? { buffs: m.buffs } : {}),
    ...(m.conditions?.length ? { conditions: m.conditions } : {}),
    ...(m.damage?.length ? { damage: m.damage } : {}),
    ...(m.setHP != null ? { setHP: m.setHP } : {}),
    ...(m.negativeLevels != null ? { negativeLevels: m.negativeLevels } : {}),
    ...(m.save != null ? { save: m.save } : {}),
    ...(m.onFail != null ? { onFail: m.onFail } : {}),
    ...(m.inherits ? { inherits: m.inherits } : {}),
    ...(m.transform && Object.keys(m.transform).length ? { transform: m.transform } : {}),
  };
}

/**
 * The 13+ worksheet, rebuilt from the mortal rows.
 *
 * Two tables keyed by different axes, which is the design (§3): the weapon half keeps its damage
 * type because a mace, a spear and an axe end a head three different ways; the energy half drops
 * anatomy because burned to ash is burned to ash. `pool-to-tables` reads this back and folds it in.
 */
function mortalWorksheet(entries) {
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const byPart = [];
  const byDamage = [];

  for (const e of entries.filter((x) => x.mortal)) {
    for (const r of e.rows) {
      const mechanic = r.description.replace(/\s+/g, " ").trim();
      if (blank(r.location)) {
        byDamage.push([cap(r.other), e.name, mechanic]);
      } else {
        for (const anatomy of anatomiesOf(r)) {
          for (const dt of damageTypesOf(r)) {
            byPart.push([`${cap(dt)} · ${cap(anatomy)} · ${cap(r.location)}`, e.name, mechanic]);
          }
        }
      }
    }
  }

  const table = (header, rows) => {
    const w = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells) => `| ${cells.map((c, i) => c.padEnd(w[i])).join(" | ")} |`;
    return [line(header), `|${w.map((n) => "-".repeat(n + 2)).join("|")}|`, ...rows.map(line)].join("\n");
  };

  return `# Mortal

The **13+** addendum — past row 12 the wound has stopped being a wound and is simply killing them.

Read **on top of** row 12, never instead of it. A row that reads *"As 12, …"* is imported as an
inheriting entry: its mechanics come from whatever sits in row 12 of the table it lands on, with
the stated transform applied. That is why one **Mortal Blow** row covers eighteen cells.

**GENERATED** by \`tools/csv-to-pool.mjs\`. Edit the source sheet and re-import.

## By body part

One row per damage type × anatomy × location, for bludgeoning, piercing and slashing.

${table(["Body part", "Effect", "Mechanic"], byPart)}

## By damage type

For the damage types that roll no hit location. Anatomy drops out — a mortal fire result is the
same story for a humanoid and a beast.

${table(["Damage type", "Effect", "Mechanic"], byDamage)}
`;
}

if (WRITE) {
  const entries = [...byId.values()];
  if (problems.length) {
    console.error("refusing to write with unresolved problems");
    process.exit(1);
  }

  const pool = {
    version: 4,
    _source: "THE source of truth for effect content. data/effects.json is generated from this file by tools/pool-to-tables.mjs and must not be hand-edited.",
    _imported: "Migrated from the authoring spreadsheet by tools/csv-to-pool.mjs. That import is a one-off; edit this file from here on.",
    _tags: JSON.parse(fs.readFileSync(path.join(ROOT, "data", "pool.json"), "utf8"))._tags,
    _inherits: "A 13+ entry may carry `inherits: \"row12\"` and a `transform` instead of its own mechanics: it reads as row 12 of whatever table it lands on, modified. Resolved at fold-in, so effects.json stays explicit.",
    entries: entries.map(poolEntry).sort((a, b) => a.id.localeCompare(b.id)),
  };

  fs.writeFileSync(path.join(ROOT, "data", "pool.json"), `${JSON.stringify(pool, null, 2)}\n`);
  fs.writeFileSync(path.join(ROOT, "content", "mortal.md"), mortalWorksheet(entries));
  console.error(`\nwrote data/pool.json (${pool.entries.length} entries) and content/mortal.md`);
}

// --- report ------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("csv-to-pool.mjs")) {
  const entries = [...byId.values()];
  console.error(`rows      : ${rows.length}`);
  console.error(`entries   : ${entries.length} (${entries.filter((e) => !e.mortal).length} ranked, ${entries.filter((e) => e.mortal).length} mortal)`);
  console.error(`problems  : ${problems.length}`);
  for (const p of problems) console.error(`  ! ${p}`);
  console.error(`notes     : ${notes.length}`);
  for (const n of notes.slice(0, 20)) console.error(`  - ${n}`);
  if (notes.length > 20) console.error(`  … and ${notes.length - 20} more`);
  if (!WRITE) console.error("\n(dry run — pass --write to emit)");
}
