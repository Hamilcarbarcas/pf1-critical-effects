# pf1-critical-effects — Build Plan

Companion to [`../astora-critical-effects-plan.md`](../astora-critical-effects-plan.md), which
is the **rules concept** and stays the source of truth for the rules. This document is the
**engineering plan**: module shape, data schemas, layer boundaries, and build order.

Content authoring (tagging effects into the pool, ranking them, attaching buffs) is a
**separate, parallel track** with its own guide in [`content/README.md`](content/README.md).
Everything below is about the framework that content plugs into.

---

## 0. Decisions locked

| Question | Decision |
|---|---|
| Where the code lives | Grow the existing `pf1-critical-effects` module from content-only into code + content. |
| Effect storage | Versioned **JSON catalog** in the module — a flat entry list plus one 12-row table per damage type × anatomy × body part (§3); journals stay the human-readable prose; a new **buff compendium** carries mechanics. |
| Content authoring | A **tagged pool** (`data/pool.json`) that generates the tables (§3). One effect tagged for several damage types and body parts covers many rows, so the grid is saturated by a few hundred effects rather than 1,560. |
| Mechanical effects | A **typed-outcome framework** (damage / condition / buff / …) with a handler registry — not free-form scripts. |
| Content strategy | **Journal-first.** Entries ship with prose and *no* mechanics; those get attached incrementally over time. |
| Player interaction | GM-run **dialog** + player-rolled roll-requests; the player's only decisions are the dice and a called shot. *(Revised twice during phase 7 — the resolution was originally a persistent chat card, and luck-point spending was built and then removed; see §7.2 and §7.3.)* |
| First shippable slice | **Fumble path end-to-end.** |

### Dependency posture

| | Modules | If missing |
|---|---|---|
| **Hard** | `pf1` system, `lib-wrapper`, `pf1-roll-requests` | Module does not function. Declared in `relationships.requires`. |
| **Optional** | `astora-mod` | Everything runs. Outcomes that deliver a buff through astora's buff automation degrade to their prose. |
| **Content-coupled** | `astora-mod` | Individual *outcomes* may depend on it (see below). Absence degrades that entry, never the engine. |

**The engine runs standalone; the back end of individual effects may not.** The resolution path —
trigger, power, location, table lookup, card — has no astora-mod code in it at all. What may
legitimately depend on astora-mod is the *implementation of a given effect*: a buff whose script
calls reach into astora macros, or the dedicated-healing lifecycle behind a broken bone. That's
acceptable and expected; it just has to fail at the granularity of one outcome, not the module.

Concretely: **this module carries its own GM socket** (`module.pf1-critical-effects`), rather than
borrowing astora-mod's `gmProxy`. Generic primitives only, per the same rule astora's socket
follows, and astora-independent — anything that reaches into astora does so from an outcome
handler, behind feature detection, never from the socket layer.

### Consequences of "grow pf1-critical-effects"

- `module.json` gains `esmodules`, `styles`, `languages`, `relationships` (system `pf1`,
  `requires` lib-wrapper + pf1-roll-requests, `recommends` astora-mod), and two new packs
  (`effect-buffs`, `macros`).
- Two features migrate **out of astora-mod** into this module (see §8): `critical-fumble.mjs`
  and `dedicated-healing.mjs`. Both are working today; the migration is real work, not a move —
  and each one migrated is one fewer astora-mod coupling in the effect back end.

---

## 1. Module layout

```
pf1-critical-effects/
  module.json                     ← + esmodules, styles, lang, relationships, packs
  DESIGN.md                       ← this file
  CHANGELOG.md                    ← release notes source of truth (tag-triggered release.yml)
  README.md
  lang/en.json
  packs/                          ← existing: critical-effects (Journal), critical-tables (RollTable)
                                     new:      effect-buffs (Item), macros (Macro)
  packs-source/
  data/
    pool.json                     ← THE content source: tagged effect pool (§3)
    effects.json                  ← GENERATED from pool.json — the catalog (§3)
    fumbles.json                  ← fumble catalog (§4)
    anatomy.json                  ← creature-type → anatomy defaults (§5.3)
  content/
    README.md                     ← pool format, tagging rules, how to fill it
    mortal.md                     ← the 13+ addendum, 13 rows (§3)
    COVERAGE.md                   ← GENERATED work queue
  tools/
    pool-to-tables.mjs            ← pool.json + mortal.md → effects.json
    pool-report.mjs               ← pool.json → content/COVERAGE.md
    tables-to-json.mjs            ← fumble RollTables → fumbles.json
  src/
    critical-effects.mjs          ← entry: init/ready wiring, API surface
    catalog/
      catalog.mjs                 ← load, index, query the pool
      schema.mjs                  ← validation + dev-time lint of the JSON
    resolve/
      power.mjs                   ← Critical Power grade, size shift, modifiers, grade override
      location.mjs                ← anatomy tables, limb fallback, called-shot override
      context.mjs                 ← gathers the §7 attacker/target data into one frozen object
    outcomes/
      registry.mjs                ← registerOutcome / applyOutcomes
      handlers/                   ← one file per built-in type (§6)
    flow/
      crit-dialog.mjs             ← GM-side orchestrator for the crit path (ApplicationV2)
      crit-trigger.mjs            ← attack-card threat button
      explosion.mjs               ← the confirmation chain, rolled with the attack (§7.2)
      fumble-flow.mjs             ← GM-side orchestrator for the fumble path
      lethal.mjs                  ← lethal flavour draws (§7.4)
      stages.mjs                  ← the stage sequence, as data
      resolver-app.mjs            ← standalone manual resolver (ApplicationV2)
    apps/
      crit-dialog.hbs
    chat/
      card-buttons.mjs            ← prompt buttons on the attack card
      card-mutate.mjs             ← rewrite the attack card with crit damage / effect
    integrations/
      socket.mjs                  ← own GM socket, generic primitives (astora-independent)
      roll-requests.mjs           ← request helpers, quick action registration
      dedicated-healing.mjs       ← migrated from astora-mod (§8)
      pf1-pipeline.mjs            ← libWrapper suppression of native crit confirm/damage (§9)
    styles/critical-effects.css
```

Conventions carried over from your other mods: `module.json` `version`/`download` stay at
placeholder `0.0.0` (the release action stamps them), `CHANGELOG.md` is the release-notes
source, `pack-tools` at the workspace root handles extract/compile of `packs/`.

---

## 2. Layer boundaries

Five layers, each usable without the one above it. This is what makes the standalone resolver
and the fumble slice possible before the PF1 pipeline work lands.

```
  chat / flow      ← UI, buttons, roll requests, card mutation   (GM-side, async)
  ────────────────
  resolve          ← pure functions: context → grade + location
  ────────────────
  outcomes         ← typed descriptors → registered handlers → applied state
  ────────────────
  catalog          ← JSON tables: effectFor(damageType, anatomy, location, total) → entry
  ────────────────
  integrations     ← roll-requests, dedicated healing, PF1 pipeline
```

**Rule:** `resolve/` and `catalog/` are pure and synchronous where possible — no `game.*`
mutation, no dialogs, no chat. Everything that touches the world lives in `flow/`, `chat/`,
or an outcome handler. That keeps the resolution math testable from the console and lets the
manual resolver and the automated flow share one code path.

---

## 3. Effect catalog schema (`data/effects.json`)

> **Revised in phase 7.** This was originally a *pool*: entries tagged with `locations`,
> `damageTypes` and a `severity` band, queried and drawn from with weights. The shipped content
> turned out to be authored as **one 1d12 table per damage type × body part** already, which makes
> the query, the banding and the weighted draw all abstractions over something simpler. `version: 2`
> is that simpler thing: a flat entry list plus a table index.

> **Revised again in phase 8.** `version: 3` adds **anatomy** as a real dimension and a `mortal`
> map. Anatomy was previously implied by the location — `appendage` meant aberrant, `tail` meant
> beast — which works right up until you ask whether a beast's `arm` should share twelve rows with
> a humanoid's. It shouldn't: one is a hand that drops a weapon, the other is a foreleg that
> buckles. See "the grid", below.

```jsonc
{
  "version": 3,
  "entries": [
    {
      "id": "broken-knee",                    // stable slug; the join key for everything
      "name": "Broken Knee",
      "journal": "Compendium.pf1-critical-effects.critical-effects.JournalEntry.sgCaXmveumaWntYk",
      "buff": null,                           // §6 — OPTIONAL; the apply-buff back end
      "note": null                            // §6 — OPTIONAL; plain text shown with the result
    }
  ],
  "tables": {
    "bludgeoning": {
      "humanoid": { "arm": [ /* exactly 12 entry ids, mildest first */ ], "leg": [ … ],
                    "torso": [ … ], "head": [ … ] },
      "beast":    { "arm": [ … ], "leg": [ … ], "torso": [ … ], "head": [ … ],
                    "tail": [ … ], "wing": [ … ] },
      "aberrant": { "appendage": [ … ], "torso": [ … ], "head": [ … ] }
    },
    "piercing": { … }
  },
  "mortal": {
    "humanoid": { "arm": "arm-torn-away", "leg": …, "torso": …, "head": … },
    "beast":    { … },
    "aberrant": { … }
  }
}
```

### The grid

| Dimension | Values | |
|---|---|---|
| Damage type | the ten in `DAMAGE_TYPES` | 10 |
| Anatomy × location | humanoid arm/leg/torso/head; beast + tail/wing; aberrant appendage/torso/head | 13 pairs |
| Rows | the d12 | 12 |

**1,560 rows**, plus 13 mortal entries. `ANATOMY_LOCATIONS` in `schema.mjs` is the definition of
those 13 pairs, and `validateAnatomy` cross-checks it against what the location tables in
anatomy.json can actually produce — a slot the d12 can land on with no effect table behind it is
the one failure that surfaces as "nothing happened" at the table rather than as a load-time
complaint.

**No inheritance.** Every pair is written out in full. The authoring worksheets have a
`= humanoid` shorthand for rows that genuinely are the same wound, but it expands at fold-in time
and the JSON stays explicit, because the engine looks a row up by index and must never chase a
reference to find one.

Notes tied to the rules concept:

- **The Critical Power total IS the row.** No query, no draw, no weighting: `effectFor(damageType,
  anatomy, location, total)` is the whole lookup, and the two clamped ends (≤0 no effect, 13+
  save-or-die) are what make the total meaningful past both extremes.
- **Every table has exactly 12 rows**, enforced as an *error* by the validator. Rows may repeat —
  a location with ten distinct outcomes covers twelve faces by repeating two — but a table may
  never be short, because the whole engine is built on "row N exists".
- **`mortal` is additive, not a fourteenth row.** It reads *on top of* row 12 at the 13+ clamp,
  and is authored once per anatomy × location because past row 12 the wound has stopped being
  characterised by what made it. Optional: absent, the 13+ result is row 12 plus the Fort save,
  which is the rule as the concept doc states it.
- **Unwritten rows are real placeholder entries, not holes.** Callers never handle a gap; `lint()`
  reports the placeholder count per table as a **progress metric**, which is what keeps the
  content track honest.
- **`journal` is display only.** Nothing in the engine parses journal prose.
- **`buff` and `note` are optional and start absent.** The content strategy is journal-first: an
  entry with `id`, `name` and `journal` is *complete* and fully usable — the flow resolves it,
  names it, links the journal, and stops. Mechanics are additive, attached entry by entry over
  time, and no part of the engine may assume they exist.
- The catalog is loaded once at `ready` and exposed read-only.

### Authoring: the tagged pool

> **Revised in phase 9 — the pool is back.** §3 has now gone pool → tables → pool, so the history
> is worth stating plainly rather than looking like a flip-flop. Phase 7 collapsed the v1 tagged
> pool into flat tables on the grounds that *"the shipped content turned out to be authored as one
> 1d12 table per damage type × body part already"*. That premise was retired by the discovery that
> **every shipped journal and effect is a placeholder** — the buffs are the refined part, and where
> they sit in the chart was never settled. With no authored tables to preserve, the argument for
> flattening evaporated and the pool's arithmetic reasserted itself.

`data/pool.json` is the source of truth. `data/effects.json` is **build output** and is not
hand-edited; `tools/pool-to-tables.mjs` regenerates it. Runtime is untouched by this — the engine
still looks a row up by index in a stored 12-row table, and nothing queries the pool at the table.

The reason is arithmetic. The grid is 1,560 rows and authoring it directly is not a real plan; but
one effect tagged for four damage types and five body parts covers twenty of those rows, so
saturating the grid needs a pool on the order of a **few hundred** effects. Tag once, land
everywhere it fits.

A pool entry carries `rank`, `slots` and `damageTypes` alongside the usual `journal` / `buff` /
`note`. Slots are anatomy-qualified (`humanoid/arm`, or `*/torso` for anatomy-agnostic).

**Rank is a severity score, not a row address**, and that distinction is the design. If rank were
an address the pool would need an exact peg for all 1,560 holes — an effect written as a 6 for
bludgeoning could not help a slashing table that already has a 6 and needs a 7, and every near-miss
would demand a brand new effect. Instead each candidate is seated at the free row **nearest its
rank, within ±1**, which is loose enough that one effect covers most of a three-row band.

The cap matters as much as the flex. Beyond ±1 a row stays a **placeholder** rather than reaching
further, because an unbounded fit would drop a rank-8 wound on row 12 and then count it as filled —
wrecking the severity ladder and the progress metric in one move. `--drift n` adjusts the window
for a more playable build from a thin pool. `pins` nail the handful of placements that are an
authorial decision rather than a consequence of a score.

Placement is global to a table, not incremental, so adding an effect can shift existing rows. That
is the price of never being deadlocked, and it is why the tables are generated. It is fully
deterministic: same pool in, same tables out.

`tools/pool-report.mjs` writes `content/COVERAGE.md`, which is the work queue — band-gaps in
tables that already have content (cheap wins) separated from untouched tables (from-scratch jobs),
plus the untriaged entries that have no rank and therefore land nowhere. Full rules in
[`content/README.md`](content/README.md).

**Mortal is not pool-shaped** and stays a 13-row worksheet in `content/mortal.md`: it is authored
once per anatomy × location and is damage-type agnostic, so there is nothing to tag and nothing to
select. The generator reads it alongside the pool.

**Severity is authoring structure, not a runtime layer** — see §5.2. The four bands are how the
twelve rows are *grouped while being written* (three at a time, mildest band first), and
`SEVERITY_BANDS` lives in `schema.mjs` so the worksheets, the tool and any grouped dropdown agree.
Nothing in the resolution path reads it.

### Journals ↔ catalog drift

The catalog references journals by UUID and the two are edited separately, so they will drift.
Mitigation: a dev-only `game.criticalEffects.lint()` that reports catalog entries with dead
journal UUIDs, journals no catalog entry points at, and how many of each table's twelve rows are
still placeholders. Cheap to write, and it's the thing that keeps the content track honest.

---

## 4. Fumble catalog (`data/fumbles.json`)

Deliberately simpler than the effect catalog — no location, no damage type, no severity. A flat
**d20 per attack type**, generated from a tagged pool exactly as the effect tables are.

```jsonc
// data/fumble-pool.json — THE source
{
  "version": 1,
  "entries": [
    { "id": "dropped-weapon", "name": "Dropped Weapon",
      "attackTypes": ["melee", "thrown", "bows", "crossbows"],   // the only tag
      "journal": "Compendium.…", "buff": null, "note": null }
  ]
}

// data/fumbles.json — GENERATED by tools/fumbles-to-tables.mjs
{
  "version": 2,
  "tables": {
    "melee":     [ { "range": [1,1], "id": "dropped-weapon" }, /* …20 rows */ ],
    "thrown":    [ … ], "bows":    [ … ], "crossbows": [ … ],
    "unarmed":   [ … ], "natural": [ … ]
  },
  "entries": [ … ]
}
```

### Six attack types

`melee`, `thrown`, `bows`, `crossbows`, `unarmed`, `natural`. Bows and crossbows are split because
PF1's own weapon groups are (`pf1.config.weaponGroups`) and because they fail differently — a
bowstring snaps, a crossbow's mechanism jams. Unarmed and natural are likewise distinct: "you break
a finger" reads for a fist and not for a bite.

`inferAttackType` pre-selects from the weapon; bows/crossbows come straight off the weapon group, so
that split is exact. **Unarmed is a soft guess** — PF1 has no first-class unarmed marker (no weapon
group, no attack subtype), so it keys off the name and the `close` group and otherwise falls through
to `melee`. It is only ever a pre-selection: the dialog shows all six, so a wrong guess costs a click.

### No rank, and why

The twenty rows are **unordered peers**. An effect table's twelve rows are a severity ladder where
row 12 must be worse than row 6; a fumble table's twenty are not, because a fumble never threatens
mortal peril (concept §2), so there is nothing for a rank to measure. The d20 picks *which* fumble,
not *how bad*. Placement is therefore just "everything tagged for this type, sorted by id" — no
nearest-fit, no drift cap, none of the machinery §3 needs.

One consequence worth stating: a short table gets **placeholders, not repeats**. With peers a repeat
is not neutral filler — it silently doubles that outcome's odds, which is a design decision nobody
made. A placeholder says "this table wants six more fumbles", which is the truth. (The effect tables
do allow repeats within the drift cap, because there a repeat is a deliberate "this row is the same
wound as its neighbour" and the ladder still holds.)

**Why the JSON and not the RollTables:** the RollTables stay as GM-facing browsable content, but the
flow draws from JSON so it can attach outcomes and run without a compendium round-trip. Same
relationship as catalog↔journals. `tools/tables-to-json.mjs` did the original transcription from
`packs-source/`; the pool has since taken over as the source.

---

## 5. The resolve layer

### 5.1 Context (`resolve/context.mjs`)

One function, `buildContext({ actionUse | manual })`, returning a frozen object with everything
§7 of the concept doc lists. Built once, passed down; nothing below re-reads the world.

| Field | Source |
|---|---|
| `attacker.size` | `actor.system.traits.size.value` — **numeric index** in v11, so size delta is a subtraction |
| `attacker.weaponClass` | `light` / `oneHanded` / `twoHanded` / `naturalPrimary` / `naturalSecondary` / `naturalSole` |
| `attacker.critMult`, `critRange` | action data, **after** the broken-condition clamp (nat-20/×2) |
| `attacker.confirmRoll` | the confirmation `D20RollPF` |
| `target.size` | as above |
| `target.anatomy` | §5.3 |
| `target.limbs` | which of leg/arm/wing/tail exist |
| `target.hp` | current / max |
| `target.armorBySlot` | for the armor-sacrifice mechanic (§10) |
| `target.conditions` | for stacking rules |
| `target.critImmunity` | numeric reduction in effect-table rows, not a boolean |
| `target.dr` | to void the effect when damage is fully absorbed |
| `calledShot` | `{ chosen: <location>` \| `null }` |

`weaponClass` is the fiddliest derivation — "sole natural attack" means primary natural attack
*and* 1.5× ability mod on damage *and* no other natural attacks on the actor. Write it as one
documented function with the rule spelled out in a comment; it is the piece most likely to be
argued about later.

### 5.2 Power (`power.mjs`)

```js
gradeFor(critMult)                 // 2→solid, 3→heavy, 4→brutal
shiftGrade(grade, steps)           // past the ends, returns { grade, flat: ±n }
powerFormula(grade)                // "1d4" | "1d6" | "2d4" | "2d6" | "2d8"
weaponClassTiers(weaponClass)      // TIER: light/secondary −1, two-handed/sole +1
sizeModifier(attackerSize, target)  // FLAT: ±1 per size category
tiersToReach(target, { base, priorSteps })   // solve the GM's grade pick back into a shift
computeGrade({ … })                // every input, one auditable result
```

Every input lands on one of two sides, and which side is the interesting part:

| | Tier — moves the grade, changes the die pool | Flat — moves the total only |
|---|---|---|
| | weapon class (light / two-handed / natural) | **size difference**, ±1 per category |
| | confirmation explosion | ladder overflow |
| | the GM's grade override | critical immunity, the GM's own modifier |

> **Swapped in phase 10.** Size used to be a tier shift and weapon class a flat ±1. The arithmetic
> of each is unchanged; only the side it lands on. It matters because the two are not
> interchangeable: a tier alters the *spread* as well as the average (1d4 → 2d8) and is bounded by
> the five-rung ladder, while a flat modifier is unbounded and moves nothing but the total. So a
> large size gap now scales without limit instead of saturating at Devastating, and
> light-vs-two-handed now changes how swingy the roll is instead of nudging it.

Tier shifts stack from three sources and the concept doc says shifts past Devastating/Glancing
convert to a flat ±1 per step. So `shiftGrade` returns *both* a grade and a residual flat modifier,
and `computeGrade` sums that with the size gap and the GM's own. Keeping the overflow inside
`shiftGrade` is what stops that rule from being reimplemented at every call site, and applying it
once on the *summed* shift is what makes "up one, down one" a no-op rather than two overflows.

`tiersToReach` exists because the GM's dropdown is an **absolute** choice ("make this
devastating") while the model only knows shifts. Solving for the shift rather than nudging by the
difference is what makes the dropdown land on the picked grade every time — the sum is forced to
the target's own index, which is inside the ladder by definition, so nothing can clamp. It also
absorbs whatever overflow the automatic calculation had, which is correct: once the GM has named a
grade, "you shifted two past devastating" is no longer a fact about the result.

Its `priorSteps` is now **weapon class + explosion**, not size + explosion. Size no longer touches
the grade, so a grade override leaves the size modifier standing — which is right: naming a grade
says nothing about how much bigger the attacker was.

**There is no severity layer.** The power total indexes straight into the effect table for the
body part that was hit (§3), so the twelve rows *are* the severity ladder. The
minor/moderate/severe/grave banding this section used to describe was an abstraction over content
that turned out to be authored per-location already; `severity.mjs` was deleted rather than kept
as a second, disagreeing scale. Critical immunity survives as a flat penalty to the total — rows
shrugged off — folded into the modifier so it appears in the breakdown rather than silently moving
the answer.

The bands came *back* in phase 8, but only as far as `SEVERITY_BANDS` in `schema.mjs`: rows 1-3
minor, 4-6 moderate, 7-9 severe, 10-12 grave. That is an **authoring** grouping — the twelve rows
are written and reviewed three at a time — and a label a dropdown may group by. It is still not a
layer: nothing between the power roll and the row consults it, and the worksheet's `Band` column
is derived from the row number and checked rather than read.

**Confirmation explosion** (concept §4.2) — if the confirmation roll is itself within the crit
threat range, Critical Power goes up a tier and the confirmation is rolled again, repeating until
it doesn't threaten.

This happens **with the attack roll**, not in the resolution dialog — see §7.2. The pure test for
a single roll is `explosionStep(roll, critRange)` → `{ threatened, tiersGained }`; the loop lives
in `flow/explosion.mjs`.

### 5.3 Location & anatomy (`location.mjs`, `data/anatomy.json`)

- Default anatomy derived from PF1 creature type, overridable per-actor via a module flag
  (`flags.pf1-critical-effects.anatomy` = `humanoid|beast|aberrant`, plus a `limbs` array).
  `anatomy.json` holds the type→category defaults so the mapping is data, not code.
- The three d12 tables from concept §5 are data.
- Beast fallback: a rolled slot that the target doesn't have walks to the next applicable
  entry, per the `*` note. Implement as an ordered fallback chain per row, not ad-hoc.
- A called shot bypasses the roll entirely and is recorded as such in the result so the card can
  say "chosen" rather than "rolled". `locationOptions()` resolves the whole chart for one creature
  *and keeps each row's location*, because a chosen row arrives from roll-requests as an index
  with no total to look anything up with.

---

## 6. The outcome framework

Catalog entries eventually need to *do* things, not just print prose — but they don't need to
on day one. The framework exists so mechanics can be **bolted onto entries that already ship**,
one at a time, without touching the flow, the card, or the catalog schema.

The design constraint that follows: **an entry with no outcomes must be a first-class citizen,
not a degraded one.** The card renders the same, the journal link works the same, the only
difference is that the Apply button doesn't appear. Every layer treats `outcomes` as absent by
default and additive when present.

**Typed descriptors, not scripts** — the same shape as astora-mod's action-buttons: each
outcome is plain data stored in the catalog and resolved through a registry keyed by `type`.
Nothing ever evaluates a stored string. This means outcomes survive serialization onto a chat
card, render identically for every client, and can be previewed before they're applied.

```js
// registry.mjs
registerOutcome(type, handler);   // handler(descriptor, ctx) -> { summary, undo? }
applyOutcomes(descriptors, ctx);  // sequential, collects summaries, GM-side
```

`ctx` = `{ actor, token, sourceActor, sourceItem, row, location, damageType, message }`.

### Built-in handler types

| `type` | Payload | Notes |
|---|---|---|
| `buff` | `uuid`, `overrides?` | Pull from the `effect-buffs` pack, create on the target. The main workhorse. |
| `condition` | `id` | `actor.setCondition(id)` / `toggleCondition` — PF1 status ids. |
| `damage` | `formula`, `damageType?` | Immediate HP damage; rolled, shown, applied. |
| `abilityDamage` | `ability`, `formula`, `drain?` | Honours "drain beats damage" stacking. |
| `bleed` | `formula` or `fixed` | Routes to the existing Bleeding buffs; same-damage-type bleeds don't stack, worse wins. |
| `delegate` | `entry` | Apply another catalog entry's outcomes — the downgrade primitive. |
| `note` | `text` | **No automation.** Prints a GM adjudication line. |
| `macro` | `uuid` | Last-resort escape hatch for the genuinely bespoke. Discouraged in content. |

Handlers are registered lazily and independently — the registry only needs the types the
catalog actually uses. `buff`, `condition`, and `note` cover the near-term need (the bone buffs
are all `buff`); the rest land as content demands them. An outcome of an unregistered type is a
lint warning and a no-op at runtime, never a thrown error, so a half-migrated catalog still runs.

Dropping an item and changing speed were cut from this list: both are expressible as a `buff`
(a Dropped Weapon buff, a speed `change`) or a `note` where GM judgment is needed anyway, and
neither earns a bespoke handler.

**This is also where the astora-mod coupling is allowed to live.** A `buff` outcome may pull a
buff whose script calls reach into astora macros, or whose healing lifecycle needs dedicated
healing. `applyOutcomes` therefore isolates each descriptor: one failing handler logs, reports
in the card summary, and lets the rest of the array apply. An effect whose back end is missing
degrades to what a journal-only entry would have given you — never a broken resolution.

### Buff compendium (`packs/effect-buffs`, Item)

New pack. Each buff carries its own mechanics (`system.changes`, `contextNotes`, description)
plus the **dedicated-healing dictionary flags** the existing bone buffs already use:
`dhDC`, `dhRequired`, `dhReceived`, and boolean `dhCheckSuccess`.

The pack **grows with the content track** — it is not filled up front. Seed it by migrating the
~20 Broken/Shattered buffs currently in
`astora-mod/packs-source/buffs/Conditions_.../Broken_Bones_...`, which already correspond to
existing effect journals (Broken Knee, Broken Arm, Compound Fracture, …) and can be attached to
their catalog entries as a `buff` outcome the moment those entries are written. Everything else
gets a buff when someone writes one. **Migration catch:** those
buffs carry `scriptCalls` pointing at `Compendium.astora-mod.macros.Macro.*` (use / toggle /
preActivate). Those macro UUIDs must be retargeted, or the buffs break the moment astora-mod is
disabled.

### Macro compendium (`packs/macros`, Macro)

The retarget destination, and the general escape hatch. Some effect behaviour genuinely wants to
live as a script call on a buff rather than as an outcome descriptor — the bone buffs' existing
use/toggle/preActivate calls are the immediate example, and there will be more. Having our own
pack from day one means content authoring never has to reach into astora-mod's macro pack to
find a home for a script.

Preference order when something needs to *happen*: **a typed outcome** → **a buff with changes**
→ **a macro in this pack** → **`note` and let the GM adjudicate**. The macro pack is third, not
first, but it needs to exist or the fourth option absorbs work it shouldn't.

### Undo

Applying a crit effect is a multi-document write (buff + condition + HP). Handlers optionally
return an `undo` thunk, and the flow records the applied set on the message so a GM can revert
a misfire in one click. Worth building in from the start — retrofitting undo is painful.

---

## 7. Chat card & flow

### 7.1 Fumble flow (phase 1)

1. `pf1PreActionUse` — existing forced confirmation roll (migrated from `critical-fumble.mjs`)
   stays as-is; it already runs synchronously so DSN sees the die.
2. `pf1PostActionUse` — if any attack was a nat-1 with a failed confirm, attach a **card
   button** (`Resolve Fumble`) via the same flag-descriptor pattern as action-buttons, rendered
   in `renderChatMessageHTML`.
3. GM clicks → small dialog: attack type pre-selected from the weapon (melee/bow/thrown/natural),
   overridable.
4. d12 draw. Player-facing: a roll-requests card with
   `type: "dice", key: "1d12", mode: "targeted", autoRoll: true, resultTable: <the fumble table>,
   showTable: true` — that gives the player-visible table with their row highlighted, for free.
5. Result appended to the original attack card (`card-mutate.mjs`), plus an **Apply** button when
   the entry has outcomes.

Everything phase 1 needs already exists: the three fumble tables, the confirm hook, the
roll-requests table rendering, the card-button pattern. Nothing here touches PF1's crit pipeline.

### 7.2 Crit flow — one GM-run dialog, roll-requests for the dice

> **Revised in phase 7.** This section originally specified one persistent chat card per
> resolution, re-rendered in place, with state in message flags. It is now a **dialog**. What
> follows is the current design; the rationale for the change is recorded at the end of the
> section, because the discarded option remains a reasonable one and the reasons to prefer this
> shape are about taste and noise rather than correctness.

The flow is **GM-driven**: the GM works a dialog through its stages, and the players'
only *required* participation is rolling the dice on roll-request cards. This sidesteps the
permission problem wholesale — the target is usually not owned by the attacking player, and
applying a buff to an unowned actor needs a GM regardless.

Concretely, this module owns **one ApplicationV2 per crit resolution**
(`flow/crit-dialog.mjs` + `apps/crit-dialog.hbs`), opened when the crit is triggered and advanced
through its stages in place. Its state lives **in memory on the instance**.

Three consequences follow, and they are the whole of the trade:

- **A GM reload or a closed window abandons the resolution.** Re-open it from the attack card's
  button and start again. Nothing has been applied to anyone until **Apply**, so the cost is a few
  clicks, not a corrupted world.
- **Waiting on a player must not depend on stored state.** The Location and Power requests use
  roll-requests' in-memory `onResult` rather than the fumble path's flag-plus-global-hook, because
  there would be nothing left to deliver a recovered result *to*. The two paths differ because
  their state lives in different places, not by accident.
- **The record has to be written somewhere that persists.** When the resolution finishes it is
  written onto the originating attack card (§7.1's pattern), so chat still tells the whole story.

**What puts the button on the card: a critical *threat*, nothing more.** The confirmation roll is
rolled and displayed but never interpreted — the button appears on every threat and is simply
ignored when the confirmation failed. This mirrors the fumble path, where a natural 1 is the whole
gate. The reasoning is the same in both directions: deciding "did this confirm?" means reading a
target's AC, which is unavailable or ambiguous often enough (several targets, no target,
touch/flat-footed variants, DR) that a wrong automatic answer costs more than an unused button.
The GM is already driving the resolution; let them make the call.

A natural 1 is explicitly **not** a threat. The fumble path fabricates `hasCritConfirm` on a
natural 1 so its forced confirmation renders, so the threat test must exclude it or a fumble reads
as a critical. It is also simply true — a natural 1 is an automatic miss — which is what keeps the
two paths mutually exclusive by definition rather than by luck.

| Stage | In the dialog | Dice |
|---|---|---|
| Trigger | GM picks effect / damage / both. **Damage alone ends the resolution here.** | — |
| Location | Creature type and damage type, then **Roll Location** or **Choose Location** | roll-request `1d12` + location chart, or a `selectFromTable` pick, **attacking player** |
| Power | Grade override + free-text modifier, then **Request Power Roll** | roll-request `<grade formula><±flat>` + the effect table, **attacking player rolls** |
| Result | The row that came up, a dropdown to change it, **Confirm Result** | — |

Only the trigger branches. Everything after it is conditional on an effect having been chosen, so
"damage" is not a stage that does nothing — it is the absence of the remaining three.

Roll-request cards carry `resultTable` + `showTable`, which gives the player-visible table with
their row highlighted for free — concept §10's "player visible summary showing a table of the
roll they just made" needs no new work. Three refinements matter:

- **Resolve the table for the target before sending it.** A location row saying "Tail" is useless
  on something without one, so each row is run through the fallback chain first and adjacent rows
  that land in the same place are merged.
- **Put the flat modifier in the formula** (`2d6+1`), not added afterwards, so the number the
  player rolls is the number the table reads. Otherwise the highlighted row disagrees with the
  result.
- **The Power table is the effect table itself**, as fourteen rows: "no effect", the twelve
  outcomes for that damage type and body part, and the save-or-die at 13+. That same list is the
  GM's override dropdown at the Result stage, so an index into it means the same thing in both
  places — which is why `catalog.effectAt(dt, slot, index, total)` takes the index and the total
  separately. The save DC is a property of the *roll*, so overriding up to the deadly row on a
  total that never reached 13 takes the floor DC rather than inventing one.

#### Two rules about timing

**Dice are thrown as late as they can be.** Critical damage is rolled when the resolution is
*committed*, not when it is chosen, so an abandoned resolution leaves no orphaned damage on the
card. Choosing damage alone is the one exception, because that choice *is* the commit.

**Request cards are deleted as late as they can be.** They stay in the log for the whole
resolution rather than vanishing the moment their number arrives, so the table can still see what
was rolled and against what while the GM is still working. They come down at the very end — on
**Confirm**, and on cancel, because an abandoned resolution kills the process and must not leave
cards inviting clicks. `this.requests` is keyed by kind, so re-asking a question closes the stale
card rather than leaving two live answers to it.

#### The explosion is not a stage

It happens **with the attack roll** (`flow/explosion.mjs`), and the dialog reads the count off the
attack card. Two reasons, and the first is a correctness one:

- The dialog cannot see PF1's confirmation. When this was a stage it rolled a *fresh* d20 and
  tested that, so a confirmation of 7 could still "explode" on a die nobody had thrown for it.
- It is a property of dice that have already been thrown, not a decision anyone makes. Nothing is
  chosen at that stage, so there is nothing for a stage to do.

The chain is rolled on `pf1PostActionUse` rather than inside `addAttack`, so the extra dice land
*after* the confirmation that caused them. It fires on attacks only by construction — it reads
`chatAttack.critConfirm`, which exists nowhere outside the action-use attack pipeline, so skill
checks, saves and (PF1's own exclusion) combat maneuvers cannot produce one. A natural 1 is
excluded explicitly, because the fumble path fabricates a confirmation on one.

The count is written to the attack card as `Critical Explosion ×N`, inside the specific
`.chat-attack` rather than at the card's foot: a full attack can explode on one swing and not
another, and a single line at the bottom could not say which. Guard the loop with a generous
iteration cap (10, far past any realistic keen-weapon run) surfaced as a GM notice rather than a
silent stop.

#### Why a dialog rather than a persistent card

The card design was not wrong; it bought reload-safety and a shared view for the price of putting
the GM's working machinery — every intermediate stage, every button — in everyone's chat log. In
play the noise dominates: a resolution is a handful of clicks, and the only parts the table needs
to see are the dice and the outcome. Both of those are still public, as roll-requests and as a
result block on the attack card.

What is genuinely lost is recovery. That is accepted rather than mitigated: persisting every
intermediate step to the world to make a few clicks survivable is a poor trade, and nothing is
written anywhere until the GM presses **Confirm Result**.

#### Styling

The dialog carries no `pf1` class and does not inherit the system's parchment. It uses the
dark/amber scheme the other astora-family windows use (`--ce-accent: #e8a63e`, panels on
`rgba(0,0,0,0.15)`, edges on `rgba(255,255,255,0.08)`), and every colour is stated rather than
inherited so the window does not change character with the client's theme. Button rules stay
scoped to `.ce-crit-dialog .ce-btn`: an unscoped `button { font-family: … }` overrides Font
Awesome and turns glyphs into boxes.

### 7.3 Player agency — what was tried, and where it landed

The concept doc left open how players buy into a resolution. The answer this module shipped and
then removed was **luck points**: an offer card posted to chat, a DialogV2 source picker, a
player→GM socket dispatch, and a `requiresLuck` marker on the stages that could be bought.

That is all gone. Patrick's call, and the reasoning is worth keeping because it is a good general
one: the luck economy already has a menu of its own, and a second place to spend a point — one
that only exists during a crit resolution, with its own affordances, its own in-flight lock and
its own degradation path when astora-mod is absent — bought less than it cost. A luck-point
usage item on the existing menu plus a GM typing the effect into the modifier field does the same
work with none of the machinery.

What survives of it, and why:

- **The grade override and the free-text modifier at the Power stage.** These were built as the
  GM-side equivalents of the two pre-roll spends; they are now simply the controls. `extraTiers`
  and `extraFlat` on the resolution are the same fields the spends fed.
- **Choose Location.** A called shot was a luck affordance; it is now a button, because there was
  never a reason for a GM to be unable to hand the player the choice.
- **Nothing else.** `integrations/luck.mjs`, `flow/luck-card.mjs`, `flow/registry.mjs` and
  `chat/luck-offer.hbs` were deleted, along with the socket handler and the `requiresLuck` stage
  marker. astora-mod is still a recommended dependency, but for buff automation (§6), not luck.

**The one thing to preserve if this is ever revisited:** the reason the spends lived on our own
surface rather than on the roll-request cards. Two of the three changed *what gets rolled* — a
grade shift changes the power formula, a chosen location replaces the location roll entirely — so
a button on a request card would have had to mutate that card's pending formula or cancel it.
Keeping the decision on our side means the request is posted once, with the right formula, after
the decision is settled. That constraint still holds for any future player-facing affordance, and
it is why the generic answer, if one is ever wanted, is a `playerActions` slot in
pf1-roll-requests rather than anything here.

### 7.4 Lethal draws

Concept §2's Lethal tables are flavor-only and mechanically inert — no save, no roll-off, pure
narration for a hit that has *already* been determined to kill. That makes them the cheapest
thing in the whole system: its own small JSON (`data/lethal.json`), a draw, and a card. No
resolve layer, no tables, no outcomes.

Two entry points, both trivial once the fumble path's plumbing exists:

- **Roll-requests quick action** — `Lethal Blow`, sibling to the standalone resolver in §7.5.
  GM picks damage type, draws, posts the flavor. Works for any kill, including ones with no
  attack card behind them (coup de grace, environmental, narrative).
- **GM-facing button on an attack card** — appears next to the damage, draws against the
  weapon's damage type automatically.

**Gating the card button.** Show it only when the attack could plausibly have downed its target:
compare the attack's damage total against each entry in `message.system.targets` and surface the
button when it meets or exceeds a target's current HP. Three caveats that argue for *surfacing*
rather than *enforcing*:

- Damage isn't applied yet at card-render time, and DR/resistance may eat some of it, so the
  comparison is a prediction, not a fact.
- Multiple targets means the button is per-target, not per-card.
- "Kills" in this system isn't `hp <= 0` — that's downing, which concept §3 gives its own
  automatic crit effect. Lethal is for a hit that kills outright, which depends on the death
  threshold and on GM judgment about helpless targets.

So: gate the button's *appearance* on the damage-vs-HP check as a convenience, keep it available
unconditionally from the quick action, and never let the gate block a GM who wants it anyway.
astora-mod's `dying-manager.mjs` is the reference for where the death threshold actually lives.

### 7.5 Standalone resolver

`registerQuickAction({ key: "pf1-critical-effects-resolver", label: "Critical Effect", promptActors: true })`
against pf1-roll-requests. Opens `resolver-app.mjs` with manual inputs for grade, modifiers,
location, damage type, and target, then runs the *same* `resolve/` + `outcomes/` path as the
automated flow. This is the fallback for every case the automation can't see.

---

## 8. Migrating dedicated healing out of astora-mod

Concept §8 wants dedicated healing under this umbrella. It's a clean fit — its only consumers
are crit-effect buffs — but it is not a file move:

- It intercepts `pf1ApplyDamage` and `preUpdateActor`, and has a **socket delegation** path
  (`dhDelegate`) on `module.astora-mod`. That channel and its listener must move together, and
  the socket name changes.
- It calls `game.modules.get("astora-mod").api.gmRequest("createRollRequest", …)` for the Heal
  check when a player triggers it. This module's own GM socket (§0) covers that — it already
  exists by this phase, and it is the reason the socket is specified as astora-independent
  rather than a thin proxy onto `gmProxy`.
- `requestBoneSetting` is invoked from buff script calls (`Compendium.astora-mod.macros.…`), so
  the buff migration in §6 and this migration have to land in the same change.

This migration is what moves dedicated healing from the "content-coupled" column of §0 into the
module proper — after it, a broken-bone effect works with astora-mod absent. Do it as its own
phase, after the fumble slice proves the module structure, and before crit outcomes start
creating buffs that depend on it.

---

## 9. Overriding PF1's crit handling — the risky part

Concept §9 wants the crit-damage/crit-effect pairing broken: the card shows base damage and a
threat, and crit damage is rolled *later*, only if chosen. PF1 does not leave room for this:

- `ChatAttack.addAttack` sees `roll.isCrit`, sets `hasCritConfirm`, and **recursively rolls the
  confirmation inline** ([chat-attack.mjs:200](../foundryvtt-pathfinder1-v11.x/module/action-use/chat-attack.mjs#L200)).
- `ActionUse` then rolls crit damage in the same pass
  ([action-use.mjs:740](../foundryvtt-pathfinder1-v11.x/module/action-use/action-use.mjs#L740)).
- Both feed `shared.templateData` and the message's roll pools before the card exists.

**Not in scope here:** the confirmation *explosion* (§5.2). It only fires once a critical effect
has been chosen, so it happens downstream in our own flow and needs nothing from this override.
The pipeline work is only about crit **damage**.

### DECIDED: suppress and reinject (approach 1)

The earlier draft floated a cheaper "roll it and hide it" option — let PF1 roll crit damage
normally, suppress only its *display* and its apply-damage buttons. **Dice So Nice kills it.**
PF1 builds a `critPool` containing the crit confirmation **and the crit damage rolls together**
and hands the whole pool to `game.dice3d.showForRoll`
([action-use.mjs:958-961](../foundryvtt-pathfinder1-v11.x/module/action-use/action-use.mjs#L958-L961),
shown at [944](../foundryvtt-pathfinder1-v11.x/module/action-use/action-use.mjs#L944)). Crit
damage dice would physically tumble across every player's screen before anyone chose anything.

Hiding them would mean intercepting that pool to strip the crit-damage rolls — which is the same
class of intervention as suppressing the roll outright, so the cheap approach isn't actually
cheap. It also leaves the dice cast before the choice, which is the thing you wanted to avoid.

**So: approach 1.** libWrapper `WRAPPER` (never `OVERRIDE` — ckl-roll-bonuses already `OVERRIDE`s
`handleConditionals` in this neighbourhood and manual prototype patches get bypassed) on the
crit-damage pass, skipping `critical: true` while leaving the confirmation intact. The confirm
roll still rolls, still animates, and still shows on the card — that's concept §10's
"roll the confirmation (no damage)" and it's unaffected by any of this.

When crit damage is later chosen, `card-mutate.mjs` rolls it fresh and calls
`game.dice3d.showForRoll()` itself — the same API PF1 uses — so the dice animate at the moment
they're actually determined, which is better theatre than the current behaviour anyway.

Worth confirming early in phase 7 that no other module in the load order is wrapping the same
method, and that the confirmation pool still animates once crit damage is pulled out of it (an
empty pool is skipped by the `if (critPool.rolls.length)` guard, so a confirm-only pool is fine).
*(Confirmed: ckl-roll-bonuses wraps `addAttack` and `setEffectNotesHTML`, Nevela wraps
`setEffectNotesHTML`; nothing wraps `addDamage`.)*

### 9.1 The d20 override must not carry into a confirmation

The attack dialog can replace the d20 with any formula, held in `rollData.d20` and spliced in at
[action.mjs:1586](../foundryvtt-pathfinder1-v11.x/module/components/action.mjs#L1586) as
`[rollData.d20 || D20RollPF.standardRoll, ...parts]`. Because the confirmation is rolled through
the same `rollAttack` with the same roll data, it inherits the override — so a manual `20`
confirms every critical automatically and `2d20kh` confirms with advantage.

House rule: **an override buys the attack it was spent on, not the confirmation as well.** Both
confirmation paths force a plain `1d20` and keep every bonus term.

The two paths need different mechanisms, because only one of the rolls is ours:

| | Who rolls it | Fix |
|---|---|---|
| Fumble confirm | us (`fumble-flow.mjs`, synchronous for DSN) | rebuild the formula with `terms[0]` — which is exactly what `D20RollPF#d20` reads — swapped for a standard d20 |
| Crit confirm | PF1 | libWrapper **WRAPPER** on `ChatAttack.prototype.addAttack`, stripping `rollData.d20` for the `critical: true` pass only |

Restore the override in a `finally`. The same roll data drives the remaining attacks of a full
attack, and each of those should still get the override on its own attack roll — including when
the wrapped call throws. WRAPPER rather than MIXED because this one always chains; it only edits
data on the way past. ckl-roll-bonuses registers a WRAPPER on the same method
([main.mjs:707](../ckl-roll-bonuses/src/main.mjs#L707)), and both are expected to run.

---

## 10. Deferred / needs a decision later

- **Armor sacrifice** (concept §7): turn a failed save into a success by damaging armor at half
  hardness. Needs slot-level armor tracking that PF1 doesn't model, plus GM judgment on
  coverage. Ship as a `note` outcome + a manual GM button before attempting automation.
- **Monster reciprocity** (monster grants a PC a luck point to trade crit damage for an effect).
  With luck integration removed (§7.3) this is a plain GM decision: the point is granted from
  astora's own luck menu, and the GM picks "effect" at the trigger stage. Nothing here needs to
  know.
- **Feats** (concept §3, "future"): the trigger layer should read from a list of trigger
  sources rather than hardcoding the five known ones, so a feat can register a trigger later.
- **Designating a creature crit-immune** — *no UI exists yet.* PF1 v11 models critical immunity
  nowhere at all: there is no field, no trait, and no fortification handling to read, so the
  resolve layer reads `flags.pf1-critical-effects.critImmunity`, a number of effect-table rows
  the target shrugs off — applied as a penalty to the Critical Power total (§5.2). Today that
  flag can only be set from the console:
  ```js
  await actor.setFlag("pf1-critical-effects", "critImmunity", 1);
  ```
  What's missing is the *designation*, not the mechanic. Wants some combination of: a control on
  the actor sheet; a default derived from creature type (undead, constructs, oozes, elementals,
  plants and swarms are all crit-immune in core PF1, which `anatomy.json` is already the natural
  home for); and a decision on whether "immune" means full immunity (a large reduction) or the
  house rule that everything is at least mitigable — the tenet in §1 says effects are *not
  negatable*, which argues immunity should reduce rather than erase. Worth doing before crit
  outcomes start applying to undead in practice.
- **pf1-token-randomizer**: any card showing a target's name to players must route through
  `api.getDisplayName` / `shouldObscure`, or obscured NPC names leak. Applies to the fumble
  "wrong target" result and every crit-effect card.

---

## 11. Build order

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | Module scaffold: `module.json` esmodules/styles/lang/relationships, entry file, API stub, CSS, CHANGELOG/README. Own GM socket (generic primitives). Catalog loader + schema validator + `lint()`, all tolerant of outcome-less entries. | — |
| **1** | **Fumble path end-to-end.** `fumbles.json` (transcribed from the existing tables + a new `natural` table), `fumble-flow.mjs`, card button + card mutation, roll-request draw with visible table. Journal-only results — no outcomes yet. | 0 |
| **2** | **Resolve layer.** `context`/`power`/`location` + `anatomy.json`, all pure and console-testable. No UI. | 0 |
| **3** | **Resolution dialog.** `crit-dialog.hbs` + a data-driven stage list. *(Originally "prompt card + luck spending"; the card became a dialog and the luck half was built and then removed — §7.2, §7.3.)* | 1, 2 |
| **4** | **Standalone resolver** (§7.5). Quick action + ApplicationV2 manual input driving 2+3. First usable crit tooling end to end, on journal-only content, with zero pipeline risk. **Lethal draws** (§7.4) ride along — same quick-action plumbing, no resolve layer needed. | 3 |
| **5** | **Outcome framework.** Registry + `buff`/`condition`/`note` handlers, `effect-buffs` pack seeded from the migrated bone buffs, undo. Apply button lights up on entries that have outcomes. | 4 |
| **6** | **Dedicated healing migration** out of astora-mod, incl. socket-channel rename + buff script-call retargeting. Removes the last content-level astora coupling. | 5 |
| **7** | **Automated crit flow.** Attack-card trigger, roll-request sequence wired to the dialog, crit-damage suppression + reinjection (§9), card mutation, lethal card button. | 4 |
| **∞** | **Content track.** Journals → catalog entries (id, name, journal UUID), then the twelve rows of each damage-type × location table put in severity order. Runs from phase 1 onward, independent of everything else. Buffs and notes get attached opportunistically, entry by entry, after phase 5. | 0 |

The reordering versus a mechanics-first build is deliberate: **phase 4 is the goal post.** After
it, you have a working crit-effect resolver producing real, named, journal-linked results at the
table — on content that is nothing but prose and tags. Everything from 5 on is deepening, not
unblocking, and the content track never waits on it.

Phase 2 is independent of 1 above the catalog layer, so the two can run in parallel.
