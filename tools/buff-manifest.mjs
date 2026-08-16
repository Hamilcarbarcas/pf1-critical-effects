#!/usr/bin/env node
/* buff-manifest — the authoring spreadsheet -> content/BUFFS.md
 *
 * The compendium buffs the catalog references, with the bleed each should carry and the
 * dedicated-healing threshold that bleed implies. None of this is runtime data: `data/pool.json`
 * stores buff NAMES and nothing else, and what a buff actually *does* lives on the compendium item.
 * This is the worklist for building those items.
 *
 * Reads the **spreadsheet** rather than the pool, because the pool does not carry buff
 * descriptions — the prose that says "3d6 deep bleed, -4 with the leg until healed" exists only in
 * the sheet. That is a real coupling to a file the import otherwise froze: if the sheet is retired,
 * this wants a data file of its own rather than a guess.
 *
 *   node tools/buff-manifest.mjs [path/to/Critical Effects.csv]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import fs from "node:fs";
import { load } from "./csv-parse.mjs";
import { canonical } from "./naming.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = process.argv.find((a) => a.endsWith(".csv")) ?? path.join(ROOT, "..", "Critical Effects.csv");
const OUT = path.join(ROOT, "content", "BUFFS.md");

const R = load(SOURCE);
const dash = (v) => !v || v === "-";
const tidy = (s) => s.replace(/\s+/g, " ").trim();
const title = canonical;

/* The sheet capitalises descriptions inconsistently ("staggered (heal 10)" beside "Staggered and
 * lose DR"). Lift the first letter and change nothing else — a description that opens on a formula
 * or a penalty ("2d6 deep bleed", "-4 to attacks") is left exactly as written. */
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

function split(part, effect) {
  const c = tidy(part);
  if (/^as name\b/i.test(c)) return { name: effect, desc: c.replace(/^as name\s*:?\s*/i, "") };
  const rep = c.match(/^(.*?)\s*-\s*repeat$/i);
  if (rep) return { name: rep[1], desc: "", alias: true };
  const m = c.match(/^([^:]{1,40}):\s*(.*)$/);
  // A colon inside prose is not a name/description boundary — "6d6 bleed, disemboweled
  // condition: ..." names nothing. Dice or a comma before the colon means it is prose.
  if (m && !/\d+d\d+/.test(m[1]) && !/,/.test(m[1])) return { name: m[1], desc: m[2] };
  /* A trailing parenthetical is a gloss on the name, not part of it — "Toes Severed
   * (disadvantage on acrobatics & climb)" names a buff and then explains it. Judge the name on
   * what is left, and keep the gloss as the description. */
  const gloss = c.match(/^([^(]{1,46})\((.+)\)\s*$/);
  const head = tidy(gloss ? gloss[1] : c);
  const bare = head.length <= 46 && !/,/.test(head) && !/\d+d\d+/.test(head);
  if (bare) return { name: head, desc: gloss ? tidy(gloss[2]) : "" };
  return { name: effect, desc: c, inferred: true };
}

const DIE = /(\d+)d(\d+)\s+(deep\s+)?(con|strength|str|dex)?\s*bleed/gi;
const bleeds = (t) => [...t.matchAll(DIE)].map(([, n, d, deep, ab]) => ({
  formula: `${n}d${d}`,
  kind: ab ? `${{ con: "con", strength: "str", str: "str", dex: "dex" }[ab.toLowerCase()]}.damage` : "hp",
  deep: !!deep, dh: (ab ? 10 : 5) * Number(n),
}));

/* Buff cells that are really adjudication notes — GM instructions with no buff behind them.
 * They import as `note` and are not buffs to build. */
const NOTES = new Set(["Signature Slash", "Holy Unmaking"]);

/* How many of the manifest's buffs are actually built, as opposed to blanks carrying their brief.
 * Not derivable from the sheet or the pack — "built" means a human wrote the changes and the
 * bleed flag, and a blank is indistinguishable from a buff whose effect is pure narration. Bump
 * it as they get written. */
const BUILT = 18;

/* Buff-name corrections. Applied to the *buff* a row delivers, never to the effect's own name.
 *
 *   - Impaled Arm/Appendage: the sheet named these after the lodged weapon, which reads as a
 *     repeat of the separate Weapon Stuck buff. They name the wound instead.
 *   - The three `As Name` rows that describe permanent limb loss but built a private buff for it.
 *     They join the shared {Limb} Destroyed family like every other effect that does the same.
 *   - Compound Fracture: Finger/Hand were `As Name` rows too, and a compound fracture of a finger
 *     is a broken finger that broke the skin — the bleed the effect already carries *is* the
 *     compound part. They deliver the built Broken Finger/Broken Hand rather than a near-duplicate
 *     of each, as the Foot/Rib/Back rows of the same family always did.
 */
const RENAME = new Map([
  ["Lodged Weapon", "Impaled Arm"],
  ["Lodging Blow", "Impaled Appendage"],
  ["Crushed Appendage", "Appendage Destroyed"],
  ["Shattered Vertebrae", "Tail Destroyed"],
  ["Skewered Tail", "Tail Destroyed"],
  ["Compound Fracture: Finger", "Broken Finger"],
  ["Compound Fracture: Hand", "Broken Hand"],
]);

const buffs = new Map();
for (const r of R) {
  for (const [field, onFail] of [["buff", false], ["saveBuff", true]]) {
    if (dash(r[field])) continue;
    if (NOTES.has(r.effect) && !onFail) continue;
    if (/^as 12\b/i.test(tidy(r[field])) || /^as above$/i.test(tidy(r[field]))) continue; // inherited
    for (const part of r[field].split("\n").map(tidy).filter(Boolean)) {
      const { name, desc, inferred } = split(part, r.effect);
      // Dedup on the CANONICAL name, so "Hand Severed" and "Severed Hand" are one buff.
      const key = RENAME.get(canonical(name)) ?? canonical(name);
      if (!buffs.has(key)) buffs.set(key, { name: key, refs: [], descs: new Set(), inferred: false });
      const b = buffs.get(key);
      if (desc) b.descs.add(desc);
      if (inferred) b.inferred = true;
      b.refs.push(`${r.effect}${r.location && r.location !== "-" ? ` · ${r.location}` : r.other !== "-" ? ` · ${r.other}` : ""}${onFail ? " *(on fail)*" : ""}`);
    }
  }
}

const rows = [...buffs.values()].sort((a, b) => a.name.localeCompare(b.name));
const out = [];
out.push("# Buff manifest", "");
out.push("**Generated** from `Critical Effects.csv` — the compendium buffs the effect catalog references.", "");
out.push(`All ${rows.length} now exist in \`packs/effect-buffs\`. ${BUILT} are built (the broken-bone set migrated from`);
out.push(`astora-mod, plus Weapon Stuck); the other ${rows.length - BUILT} are **blanks** — name, folder and sub-type only,`);
out.push("their description holding the Effect / Bleed / DH cells below as the brief to build from.");
out.push("`buffSnapshot` copies that description onto the chat card, so an unfilled buff shows its brief");
out.push("to players until it is written.", "");
out.push("Dedicated healing is derived from the bleed the buff carries: **5 per die** of hit-point bleed,");
out.push("**10 per die** of ability bleed. A buff with no bleed takes its threshold from the `(heal N)`");
out.push("in its own text, or none at all.", "");
out.push("Bleed config goes on the buff as `flags.pf1-bleed-effects.bleed` in the default (non-persist)");
out.push("mode, so it stops when the buff clears. DH goes in `flags.pf1-critical-effects.dedicatedHealing`.", "");
out.push(`**${rows.length} buffs**, ${rows.filter((b) => bleeds([...b.descs].join(" ")).length).length} of them carrying a bleed.`);
out.push(`${rows.filter((b) => !b.descs.size).length} carry no description — see the note under the table.`, "");
out.push("| Buff | Effect | Bleed | DH | Referenced by |");
out.push("|---|---|---|---|---|");
for (const b of rows) {
  const desc = [...b.descs].join(" ");
  const bl = bleeds(desc);
  // The sheet writes the threshold either way round — "(heal 20)" and "(DC 10, 5 heal)" both occur.
  const heal = desc.match(/heal\s+(\d+)|(\d+)\s+heal/i);
  const dh = bl.length ? bl.reduce((n, x) => n + x.dh, 0) : heal ? Number(heal[1] ?? heal[2]) : null;
  const bstr = bl.length ? bl.map((x) => `${x.formula} ${x.kind === "hp" ? "" : x.kind + " "}${x.deep ? "deep" : ""}`.trim()).join("<br>") : "—";
  const refs = [...new Set(b.refs)];
  out.push(`| **${b.name}**${b.inferred ? " ⚠" : ""} | ${sentence(desc) || "—"} | ${bstr} | ${dh ?? "—"} | ${refs.slice(0, 2).join(", ")}${refs.length > 2 ? ` +${refs.length - 2}` : ""} |`);
}
out.push("", "⚠ = the sheet gave prose rather than a name; named after its effect. Rename if you'd rather.", "");
out.push("**Effect** is the sheet's own wording, verbatim but for a capitalised first letter — it is the");
out.push("brief, not the buff text. A `heal N` in it — either word order — is where the DH column came from, and need not survive");
out.push("into the item. A dash means the sheet gave a bare name, which happens in three cases: the");
out.push("broken-bone buffs already built in astora-mod, the severed/destroyed family whose name is its");
out.push("whole rule, and **Weapon Stuck**, specified in DESIGN.md §8.1.", "");




fs.writeFileSync(OUT, out.join("\n") + "\n");
console.error(`wrote content/BUFFS.md — ${rows.length} buffs`);
