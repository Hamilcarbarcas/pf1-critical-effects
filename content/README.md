# Content

Effect content is a **tagged pool**, not a set of hand-written tables. You write effects; the
generator works out which of the 63 roll tables each one lands in, and where.

There are **three** content tracks, and they are shaped differently because they *are* different.

```
data/pool.json          ← critical effects. Tagged: rank + slots + damageTypes.
content/mortal.md       ← the 13+ addendum. 21 rows: 13 by body part, 8 by damage type.
        ↓  node tools/pool-to-tables.mjs --write
data/effects.json       ← GENERATED. Do not hand-edit.

data/fumble-pool.json   ← fumbles. Tagged: attackTypes only. No rank.
        ↓  node tools/fumbles-to-tables.mjs --write
data/fumbles.json       ← GENERATED. Do not hand-edit.

data/lethal.json        ← lethal narration. Hand-edited; no generator.

        ↓  node tools/pool-report.mjs --write
content/COVERAGE.md     ← GENERATED. The work queue for all three.
```

| | |
|---|---|
| `node tools/pool-to-tables.mjs --write` | effect pool → tables. `--drift n` changes the placement window. |
| `node tools/fumbles-to-tables.mjs --write` | fumble pool → fumble tables. |
| `node tools/pool-report.mjs --write` | all three → `COVERAGE.md`. Run after any content edit. |

| Track | Grid | Tags | Ordered? |
|---|---|---|---|
| **Effects** | (3 weapon damage × 13 body parts + 8 other damage × 3 anatomies) × d12 = 756 | `rank`, `slots`, `damageTypes` | Severity ladder |
| **Fumbles** | 6 attack types × d20 = 120 | `attackTypes` | No — unordered peers |
| **Lethal** | none — a flat list | `damageTypes` | No |

**Runtime is unaffected by any of this.** The engine still looks a row up by index in a stored
12-row table. The pool is a build-time input, never a query at the table.

---

## Why a pool

The grid is **756 rows**: 3 weapon damage types × 13 anatomy/location pairs, plus 8 damage types
that roll no location and keep one table per anatomy, all × 12 rows. Authoring that directly is not
a real plan. But one effect tagged for four damage types and five body parts covers twenty of those
rows, so the pool needed to saturate the grid is on the order of a **few hundred effects**.

That is the whole bet: tag once, land everywhere it fits.

## Two halves of the grid

Only **bludgeoning, piercing and slashing** roll a hit location. Fire, cold, electricity, acid,
sonic, force, positive and negative energy arrive as a wash rather than as a blow: there is no body
part to roll for and no called shot to make. They keep the *anatomy* axis — a fire critical does
something different to a humanoid than to an ooze — and drop the location one, so each has **one
table per anatomy**, tagged with the pseudo-slot `general`.

|  | Damage types | Slots | Tables |
|---|---|---|---|
| **Localized** | bludgeoning, piercing, slashing | the 13 anatomy/location pairs | 39 |
| **Non-localized** | fire, cold, electricity, acid, sonic, force, positive, negative | `humanoid/general`, `beast/general`, `aberrant/general` | 24 |

An effect that should cover both halves needs a slot in both — `["humanoid/arm", "*/general"]`.
Tagging a fire effect with only body-part slots (or a slashing one with only `general`) means those
damage tags select nothing, and `pool-to-tables` says so without failing the build.

## A pool entry

```jsonc
{
  "id": "broken-arm",                  // slug of the name; the join key for journal + buff
  "name": "Broken Arm",
  "rank": 6,                           // 1-12 severity score, or null = untriaged
  "slots": ["humanoid/arm"],           // anatomy/location pairs; "*/torso" = every anatomy
  "damageTypes": ["bludgeoning", "slashing"],   // or ["*"] for all eleven
  "journal": "Compendium.pf1-critical-effects.critical-effects.JournalEntry.…",
  "buff": null,                        // the mechanics; the part that's actually locked in
  "note": "Broken Arm condition: -6 on attacks and skills using that arm…",
  "pins": { "slashing/humanoid/head": 12 }      // OPTIONAL, and rare — see below
}
```

### `slots`

Anatomy-qualified, because anatomy is a real dimension: `humanoid/arm` is a hand that drops a
weapon, `beast/arm` is a foreleg that buckles. `*/torso` means every anatomy that has a torso — use
it when the effect genuinely doesn't care, since it keeps applying if an anatomy is ever added,
where three literal pairs would silently not.

The 13 body-part pairs are `ANATOMY_LOCATIONS` in `src/catalog/schema.mjs`, plus `<anatomy>/general`
for the damage types that roll no location. A slot outside those is a hard error.

### `rank` — a score, not an address

Rank is **how bad this wound is**, on the same 1-12 scale the tables are indexed by. It is *not* a
statement about which row the effect occupies.

That distinction is the point. If rank were an address, the pool would need an exact peg for all
756 holes: an effect written as a 6 for bludgeoning couldn't help a slashing table that already
has a 6 and needs a 7, and you'd be writing a new effect for every near-miss forever.

Instead the generator seats each candidate at the **free row nearest its rank, within ±1**. A
rank-6 effect fills row 5, 6 or 7 — enough that one effect can cover most of a three-row band.

**Beyond ±1 it will not go.** A row with nothing in range stays a placeholder, and that is
deliberate: an unbounded fit would drop a rank-8 wound on row 12 and then count that row as
*filled*, wrecking the severity ladder and the progress metric together. "There is no grave
slashing arm wound yet" is a fact worth being able to see. Change the window with `--drift n` if
you want a more playable build from a thin pool; `--drift 0` shows only exact fits.

Bands (minor 1-3, moderate 4-6, severe 7-9, grave 10-12) are derived from rank. They are how
coverage is *reported* — three candidates per band is the target, because a band is three rows.

`rank: null` means untriaged: the effect is inventory and is placed in **no table at all**.
`COVERAGE.md` lists them.

### `pins` — the escape hatch

`{ "<damageType>/<anatomy>/<location>": <row> }` nails an effect to one row of one table, exempt
from the drift cap and immovable. For placements that are an authorial decision rather than a
consequence of a score — Beheaded belongs at the bottom of slashing/head whatever the arithmetic
says. Use sparingly; a pool that needs many pins is a pool whose ranks are wrong.

---

## How to fill the pool

1. Open [COVERAGE.md](COVERAGE.md).
2. **Work queue** first — band-gaps in tables that already have content. Cheapest wins: a table
   with two of three grave wounds needs exactly one effect.
3. **Untouched tables** next. Listed by damage type rather than line by line, because they're
   from-scratch jobs — and because one well-tagged effect can close several at once.
4. Add entries to `data/pool.json`, then regenerate both files.

Before writing something new, check whether an existing effect should simply be **tagged more
broadly**. Widening `slots` or `damageTypes` on an effect you already have is free content, and it
is usually the right answer — a crushed windpipe is a crushed windpipe whether a mace or a boot
did it.

## Placement moves

The assignment is global to a table, not incremental, so **adding an effect can shift existing
rows**. That is the price of never being deadlocked, and it is why tables are generated rather than
stored by hand. It is fully deterministic — same pool in, same tables out, ties broken on rank then
id — so a regenerate with no pool change is a no-op. Pin anything that must not move.

## What the effect pool doesn't hold

**Mortal.** The 13+ addendum is written once per cell, so there is nothing to tag and nothing to
select. It stays in [mortal.md](mortal.md) as **two tables, 21 rows**, keyed by different axes —
and that split is the thing to get right when you write one:

| Table | One row per | Ignores |
|---|---|---|
| **By body part** | anatomy × location, for bludgeoning/piercing/slashing | which of the three did it |
| **By damage type** | fire, cold, electricity, acid, sonic, force, positive, negative | which anatomy took it |

Each side keeps the axis that actually distinguishes a death. A torn-off arm is a torn-off arm
whether a sword or a mace did it; burned to ash and blasted apart are plainly not one result. The
generator reads both alongside the pool and tells the two apart by the row's first cell, so they
can sit anywhere in the file.

---

## Fumbles (`data/fumble-pool.json`)

Six d20 tables — melee, thrown, bows, crossbows, unarmed, natural — filled from one pool. The only
tag is `attackTypes`:

```jsonc
{ "id": "dropped-weapon", "name": "Dropped Weapon",
  "attackTypes": ["melee", "thrown", "bows", "crossbows"],
  "journal": null, "buff": null, "note": null }
```

**No rank, no bands.** The twenty rows are *unordered peers*: the die picks which fumble, not how
bad it is. A fumble never threatens mortal peril, so there's no ladder for a rank to measure and
none of §3's placement machinery applies — the generator just takes everything tagged for a type,
sorts by id, and lays it out.

That has one consequence worth knowing: **a short table gets placeholders, not repeats.** With
peers, a repeat isn't neutral filler — it silently doubles that outcome's odds, which is a design
decision nobody made. A placeholder says "this table wants six more fumbles" instead.

More than twenty candidates for one type is reported as *surplus* rather than silently truncated;
that means the type has outgrown its table and wants a prune or a split.

## Lethal (`data/lethal.json`)

**Flavour only, and hand-edited — no pool, no generator, no rank.** A lethal result narrates a kill
that something else already decided (HP loss, a coup de grace). No save, no roll-off, no location
axis. The one tag is `damageTypes`, and one entry is drawn at random from whatever matches.

```jsonc
{ "id": "heart-pierced", "name": "Heart Pierced",
  "damageTypes": ["piercing"],
  "journal": "Compendium.…" }
```

There's no target count, so an empty damage type isn't a gap in the sense the tables use — it just
means a kill of that sort gets no narration. COVERAGE.md reports the counts so the thin ones are
visible.

Do **not** confuse this with mortal. Mortal is the 13+ clamp on a critical effect and is part of
the resolution; lethal is post-hoc narration for a death that has already happened.

## Journals and buffs

`journal` is display only — nothing in the engine parses prose, and the current journals are
placeholders. `buff` is the real payload and is the part that is locked in; the content strategy
(DESIGN.md §3) is unchanged in that an entry with just a name is complete and usable.

Both are keyed to the entry `id`, which is the slug of the `name` — so **renaming an effect severs
both**. Rename the `id` and the `name` together, deliberately.
