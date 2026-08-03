# Content worksheets

Effect content is authored **here**, in markdown, and folded into `data/effects.json` by a tool.
Nobody hand-edits the catalog: it is 1,560 rows of entry ids, which is not a thing a person can
review.

```
content/<damageType>.md   one file per damage type, 13 sections of 12 rows
content/mortal.md         the 13+ addendum, 13 rows, damage-type agnostic
```

| | |
|---|---|
| `node tools/scaffold-worksheets.mjs --write` | catalog → worksheets. Won't overwrite an existing file without `--force`. |
| `node tools/worksheets-to-catalog.mjs --write` | worksheets → catalog. Folds in `approved` sections only. |

The two are inverses: scaffolding an untouched catalog and folding it straight back in produces
byte-identical JSON. That round trip is the safety property — if it ever breaks, one of the two
tools is losing content.

---

## The grid

Four dimensions, and every cell is written out in full — there is no inheritance in the catalog.

| Dimension | Values | |
|---|---|---|
| **Damage type** | bludgeoning, piercing, slashing, fire, cold, electric, acid, sonic, positive, negative | 10 |
| **Anatomy** | humanoid, beast, aberrant | 3 |
| **Location** | humanoid: arm, leg, torso, head<br>beast: + tail, wing<br>aberrant: appendage, torso, head | 13 pairs |
| **Severity** | minor (1-3), moderate (4-6), severe (7-9), grave (10-12) | 4 bands × 3 rows |

10 × 13 × 12 = **1,560 rows**, plus 13 mortal entries.

**Anatomy is a real dimension, not something location implies.** `arm` is a weapon hand on a
humanoid and a foreleg on a beast; a humanoid arm table can say *Dropped Weapon* and a beast arm
table cannot. The two ladders diverge from row 1.

## Severity is authoring structure, not a runtime layer

The engine has no severity band. The Critical Power total indexes **straight into the row**:
roll a 7, get row 7. The bands exist because twelve rows are easier to write and review three at a
time, and because "is this really worse than the row above it?" is the question that matters most
while authoring.

So the `Band` column is derived from the row number. The tool checks it and complains if it
disagrees, but never reads it — reordering rows means moving the *text*, not editing the band.

**The ladder must be monotonic.** Row 6 must be worse than row 5 and better than row 7, across the
whole twelve. This is the one thing worth re-reading a finished table for: the transcribed
bludgeoning/piercing/slashing tables came out of the RollTables in *alphabetical* order, which is
why `Broken Finger` currently sits at row 10 and `Broken Neck` at row 2.

---

## Worksheet format

```markdown
## Humanoid · Arm
**Status:** draft

|  # | Band     | Effect          | Mechanic                                       |
|---:|----------|-----------------|------------------------------------------------|
|  1 | Minor    | Jammed Thumb    | -1 on attack rolls with this arm for 1 minute  |
| …  |          |                 |                                                |
| 12 | Grave    | Shattered Elbow | Arm is useless until healed; dedicated DC 20   |
```

**Status is the review gate.** `draft` sections are ignored by the fold-in tool, so a worksheet
can sit half-written on disk with none of it reaching the module. Change one word to `approved`
and that table — and only that table — lands. Every scaffolded section starts at `draft`,
including the ones that already have twelve rows in them: status is a statement about *review*,
not about completeness.

### Columns

| Column | |
|---|---|
| `#` | 1-12. The Critical Power total that produces this row. |
| `Band` | Derived from `#`. Checked, never trusted. |
| `Effect` | The effect's **name** — what the chat card says happened. Becomes the entry id (slugged). |
| `Mechanic` | The rules text. Becomes the entry's `note`. Leave blank for pure flavour. |

### Two shorthands

**Blank `Effect`** — an unwritten row. Folds in as a `placeholder` entry, which keeps "12 rows,
always" true while `lint()` reports the row as still to author. Never leave a *hole*; leave a
blank cell.

**`= humanoid`** in the `Effect` cell — reuse whatever that anatomy's table has at the same row,
for the same damage type and location. For rows that genuinely are the same wound: a crossbow bolt
through a shoulder is a crossbow bolt through a shoulder. This is an **authoring** shorthand only;
it expands at fold-in time and the catalog stays fully explicit, because the engine looks a row up
by index and must never chase a reference to find one.

Reach for `= humanoid` sparingly. If a beast table is twelve `= humanoid` rows, the honest thing
was for beast not to be a dimension — and if it is *mostly* those, the interesting question is
which rows aren't.

---

## Entries are shared by name

An entry's id is the slug of its name, and **the same name in two tables is the same entry**. A
`Dropped Weapon` is a dropped weapon whether a mace or an axe did it. This is what keeps the pool
at a few hundred entries rather than 1,560, and what lets a buff, once attached to an entry, apply
everywhere that effect appears.

The cost: two different wounds may not share a name. If the same name turns up with conflicting
`Mechanic` text the fold is **refused** — silently keeping one of the two would put rules text on
a card nobody wrote for it. Rename one. `Severed Wing` and `Severed Tail` read better on a card
than two `Severed`s anyway.

Renaming an effect in a worksheet creates a *new* entry and orphans the old one, which the tool
prunes. An entry's `journal` and `buff` are keyed to its id, so **renaming severs both**. That's
survivable while the pack is young; once journals are attached in bulk, rename by editing
`data/effects.json` and the worksheet together.

## What the worksheets don't carry

`journal` and `buff` uuids. Those are attached in the catalog and are preserved across a fold —
worksheets know an effect's name and what it does, and nothing else about it. The journal-first
content strategy (DESIGN.md §3) is unchanged: an entry with a name is complete and usable, and
mechanics are additive.

## Mortal

`content/mortal.md` is shaped differently because the data is: the 13+ addendum is authored once
per anatomy × location, not per damage type, so it's 13 rows in one file with a single status.

It reads **on top of** row 12, never instead of it, and always alongside the Fort save
(DC = the Critical Power total) that the 13+ clamp already carries. The `Mechanic` column is
therefore the *extra* — what this body part does to someone past saving — not a restatement of
either.
