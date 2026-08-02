# pf1-critical-effects — Build Plan

Companion to [`../astora-critical-effects-plan.md`](../astora-critical-effects-plan.md), which
is the **rules concept** and stays the source of truth for the rules. This document is the
**engineering plan**: module shape, data schemas, layer boundaries, and build order.

Content authoring (severity/location/damage-type tagging of the 266 existing effect journals,
the outcome arrays, the buff compendium) is a **separate, later track**. Everything below is
about standing up the framework that content will plug into.

---

## 0. Decisions locked

| Question | Decision |
|---|---|
| Where the code lives | Grow the existing `pf1-critical-effects` module from content-only into code + content. |
| Effect pool storage | Versioned **JSON catalog** in the module; journals stay the human-readable prose; a new **buff compendium** carries mechanics. |
| Mechanical effects | A **typed-outcome framework** (damage / condition / buff / …) with a handler registry — not free-form scripts. |
| Content strategy | **Journal-first.** Entries ship with prose + tags and *no* outcomes; mechanics get attached incrementally over time. |
| Player interaction | GM-run prompt card + player-rolled roll-requests. Luck spends happen on **this module's own card**, Stroke-of-Fortune pattern (§7.3). |
| First shippable slice | **Fumble path end-to-end.** |

### Dependency posture

| | Modules | If missing |
|---|---|---|
| **Hard** | `pf1` system, `lib-wrapper`, `pf1-roll-requests` | Module does not function. Declared in `relationships.requires`. |
| **Optional** | `astora-mod` | Everything runs. Luck-point spending is simply unavailable. |
| **Content-coupled** | `astora-mod` | Individual *outcomes* may depend on it (see below). Absence degrades that entry, never the engine. |

**The engine runs standalone; the back end of individual effects may not.** The resolution path —
trigger, power, severity, location, catalog draw, card — has no astora-mod code in it at all. What
may legitimately depend on astora-mod is the *implementation of a given effect*: a buff whose
script calls reach into astora macros, or the dedicated-healing lifecycle behind a broken bone.
That's acceptable and expected; it just has to fail at the granularity of one outcome, not the
module.

Concretely, this means two things the earlier draft got wrong:

- **A real luck adapter with a null implementation** (`integrations/luck.mjs`, §7.3). Feature-detect
  once at `ready`; when absent, luck affordances don't render and the stages that exist only to
  host them collapse.
- **This module carries its own GM socket** (`module.pf1-critical-effects`), rather than borrowing
  astora-mod's `gmProxy`. Generic primitives only, per the same rule astora's socket follows.
  The socket is astora-independent; only the *body* of the luck handler calls into astora, behind
  the same feature detection.

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
    effects.json                  ← the catalog (§3)
    fumbles.json                  ← fumble catalog (§4)
    anatomy.json                  ← creature-type → anatomy defaults (§5.3)
  src/
    critical-effects.mjs          ← entry: init/ready wiring, API surface
    catalog/
      catalog.mjs                 ← load, index, query the pool
      schema.mjs                  ← validation + dev-time lint of the JSON
    resolve/
      power.mjs                   ← Critical Power grade, size shift, confirm explosion, modifiers
      severity.mjs                ← roll total → severity band
      location.mjs                ← anatomy tables, limb fallback, called-shot override
      context.mjs                 ← gathers the §7 attacker/target data into one frozen object
    outcomes/
      registry.mjs                ← registerOutcome / applyOutcomes
      handlers/                   ← one file per built-in type (§6)
    flow/
      crit-flow.mjs               ← GM-side orchestrator for the crit path
      fumble-flow.mjs             ← GM-side orchestrator for the fumble path
      resolver-app.mjs            ← standalone manual resolver (ApplicationV2)
    chat/
      card-buttons.mjs            ← prompt buttons on the attack card
      card-mutate.mjs             ← rewrite the attack card with crit damage / effect
      result-card.hbs
    integrations/
      socket.mjs                  ← own GM socket, generic primitives (astora-independent)
      luck.mjs                    ← astora-mod luck adapter + null impl; feature-detected at ready
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
  resolve          ← pure functions: context → grade → roll → severity + location
  ────────────────
  outcomes         ← typed descriptors → registered handlers → applied state
  ────────────────
  catalog          ← JSON pool: query(location, damageTypes, severity, tags) → entries
  ────────────────
  integrations     ← luck, roll-requests, dedicated healing, PF1 pipeline
```

**Rule:** `resolve/` and `catalog/` are pure and synchronous where possible — no `game.*`
mutation, no dialogs, no chat. Everything that touches the world lives in `flow/`, `chat/`,
or an outcome handler. That keeps the resolution math testable from the console and lets the
manual resolver and the automated flow share one code path.

---

## 3. Effect catalog schema (`data/effects.json`)

```jsonc
{
  "version": 1,
  "entries": [
    {
      "id": "broken-knee",                    // stable slug; the join key for everything
      "name": "Broken Knee",
      "journal": "Compendium.pf1-critical-effects.critical-effects.JournalEntry.sgCaXmveumaWntYk",
      "locations": ["leg"],                   // inclusive — an entry may list several
      "damageTypes": ["b"],                   // inclusive
      "severity": "severe",                   // minor | moderate | severe | grave
      "tags": ["fracture", "mobility-loss"],
      "anatomy": ["humanoid", "beast"],       // optional gate; omit = all
      "weight": 1,                            // optional draw weight within its bucket
      "outcomes": [ /* §6 — OPTIONAL; omit entirely for a journal-only entry */ ],
      "save": {                               // optional
        "type": "fort",                       // fort | ref | will
        "dc": "10 + @severityIndex * 3",      // formula; @-refs resolved from the context
        "onSuccess": [ /* reduced outcome array — never empty; see below */ ]
      }
    }
  ]
}
```

Notes tied to the rules concept:

- **`locations` and `damageTypes` are arrays**, per §6 "Shared items" — one Knocked Prone entry
  serves torso and leg, bludgeoning and slashing. The catalog is the pool; the old per-table
  duplicates collapse into it.
- **`save.onSuccess` replaces, never negates.** Tenet "critical effects are not negatable,
  though they may be mitigatable" is enforced structurally: a save has an `onSuccess` outcome
  array, and the validator rejects an empty one. To express "downgrade a band", author the
  milder entry's outcomes there, or use `{ "type": "delegate", "entry": "<id>" }`.
- **`journal` is display only.** Nothing in the engine parses journal prose.
- **`outcomes` is optional and starts absent.** The content strategy is journal-first: an entry
  with `id`, `name`, `journal`, `locations`, `damageTypes`, and `severity` is *complete* and
  fully usable — the flow resolves it, names it, links the journal, and stops. Mechanics are
  additive, attached entry by entry over time, and no part of the engine may assume `outcomes`
  exists. The lint reports outcome coverage as a **progress metric**, not an error.
- The catalog is loaded once at `ready`, indexed by `location × damageType × severity`, and
  exposed read-only. Query returns candidates; the *draw* (weighted pick, or a d12 roll against
  a materialized table) is a separate call so the GM can see and re-roll it.

### Journals ↔ catalog drift

The catalog references journals by UUID and the two are edited separately, so they will drift.
Mitigation: a dev-only `game.criticalEffects.lint()` that reports catalog entries with dead
journal UUIDs, journals no catalog entry points at, buckets with fewer than *N* entries, and
outcome descriptors of unregistered types. Cheap to write, and it's the thing that keeps the
content track honest.

---

## 4. Fumble catalog (`data/fumbles.json`)

Deliberately simpler — flat d12 per attack type, no location, no damage type, matching both
the concept doc and the tables already in `packs/critical-tables`.

```jsonc
{
  "version": 1,
  "tables": {
    "melee":   [ { "range": [1,1], "id": "dislocated-elbow" }, /* … */ ],
    "bow":     [ /* … */ ],
    "thrown":  [ /* … */ ],
    "natural": [ /* … */ ]
  },
  "entries": [
    { "id": "dislocated-elbow", "name": "Dislocated Elbow", "band": "moderate",
      "journal": "Compendium.pf1-critical-effects.critical-effects.JournalEntry.…",
      "outcomes": [ … ] }
  ]
}
```

`natural` does not exist in the current pack — it's the one fumble table that needs authoring
before phase 1 closes. Bow / Melee / Thrown transcribe directly from the existing RollTables.

**Why the JSON and not the RollTables:** the RollTables stay as GM-facing browsable content,
but the flow draws from JSON so it can attach outcomes, reason about bands, and run without a
compendium round-trip. Same relationship as catalog↔journals. A one-off transcription script
(`tools/tables-to-json.mjs`) generates the initial JSON from `packs-source/` so this isn't
hand-typing 35 rows.

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
| `target.critImmunity` | numeric severity reduction, not a boolean |
| `target.dr` | to void the effect when damage is fully absorbed |
| `calledShot` | `{ chosen: <location>` \| `null }` |

`weaponClass` is the fiddliest derivation — "sole natural attack" means primary natural attack
*and* 1.5× ability mod on damage *and* no other natural attacks on the actor. Write it as one
documented function with the rule spelled out in a comment; it is the piece most likely to be
argued about later.

### 5.2 Power → severity (`power.mjs`, `severity.mjs`)

```js
gradeFor(critMult)                 // 2→solid, 3→heavy, 4→brutal
shiftGrade(grade, steps)           // past the ends, returns { grade, flat: ±n }
powerFormula(grade)                // "1d4" | "1d6" | "2d4" | "2d6" | "2d8"
severityFor(total)                 // ≤0 none, 1-3 minor … 10-12 grave, 13+ grave + Fort DC total
```

Grade shifts stack from three sources — size delta, confirmation explosion, luck spend — and
the concept doc says shifts past Devastating/Glancing convert to flat ±1. So `shiftGrade`
returns *both* a grade and a residual flat modifier, and the caller sums that with the
light/two-handed/luck flat modifiers. Keeping the overflow inside `shiftGrade` is what stops
that rule from being reimplemented in three places.

**Confirmation explosion** (concept §4.2) — if the confirmation roll is itself within the crit
threat range, Critical Power goes up a tier and the confirmation is rolled again, repeating until
it doesn't threaten.

Two properties make this much easier than it first looks:

- **It only fires when a critical *effect* is chosen.** A crit resolved as plain damage never
  explodes. So it lives entirely inside our flow, downstream of the trigger stage — it is *not*
  part of the §9 pipeline override, and the initial attack roll needs no special handling for it.
- **It's a loop of ordinary confirmation rolls**, each one a follow-up roll request. Nothing is
  reconstructed from the original roll; each iteration is a fresh roll against the same threat
  range, using the same confirm formula the attack already built.

The pure part is small — `explosionStep(roll, critRange)` → `{ threatened, tiersGained }` — and
the loop itself is a stage on the prompt card (§7.2).

### 5.3 Location & anatomy (`location.mjs`, `data/anatomy.json`)

- Default anatomy derived from PF1 creature type, overridable per-actor via a module flag
  (`flags.pf1-critical-effects.anatomy` = `humanoid|beast|aberrant`, plus a `limbs` array).
  `anatomy.json` holds the type→category defaults so the mapping is data, not code.
- The three d12 tables from concept §5 are data.
- Beast fallback: a rolled slot that the target doesn't have walks to the next applicable
  entry, per the `*` note. Implement as an ordered fallback chain per row, not ad-hoc.
- Called shot / luck-spent choice bypasses the roll entirely and is recorded as such in the
  result so the card can say "chosen" rather than "rolled".

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

`ctx` = `{ actor, token, sourceActor, sourceItem, severity, location, damageType, message }`.

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

### 7.2 Crit flow — one GM-run prompt card, roll-requests for the dice

The flow is **GM-driven**: the GM works a prompt card through its stages, and the players'
only *required* participation is rolling the dice on roll-request cards. This sidesteps the
permission problem wholesale — the target is usually not owned by the attacking player, and
applying a buff to an unowned actor needs a GM regardless.

Concretely, this module owns **one persistent chat card per crit resolution**
(`flow/crit-flow.mjs` + `chat/result-card.hbs`). It is created when the crit is triggered and
**re-rendered in place** as the resolution advances, ending as the record of what happened. Its
state lives in message flags, so it survives reload and renders identically for everyone.

| Stage | On the prompt card | Dice |
|---|---|---|
| Trigger | GM picks effect / damage / both | — |
| Explosion | Only if an effect was chosen; loops while the confirm threatens | roll-request `<confirm formula>`, repeated |
| Location | GM rolls, or a player spends luck to choose | roll-request `1d12` + location table |
| Power | GM sets grade & modifiers | roll-request `<grade formula>` + severity table |
| Modify | Post-roll luck spend (skipped when luck is unavailable) | — |
| Result | Entry drawn, journal linked, Apply shown if it has outcomes | — |

Roll-request cards carry `resultTable` + `showTable`, which gives the player-visible table with
their row highlighted for free — concept §10's "player visible summary showing a table of the
roll they just made" needs no new work.

**Displaying the explosion.** The stage is a loop of identical roll requests, so render it on the
prompt card as an accumulating **chain** rather than one result — each iteration appends a link
showing the roll and the grade it bought:

```
Confirmation   19 ✦ threat   Solid → Heavy
               17 ✦ threat   Heavy → Brutal
               8            stop
                                        Critical Power: Brutal (2d6)
```

Storing it as an array of `{ roll, threatened, grade }` in the card's flags means the chain
rebuilds identically on reload and doubles as the audit trail for how the grade was arrived at —
which matters, because by the Power stage the grade is the product of the base multiplier, size
delta, *and* however many explosions happened, and a GM will want to see the arithmetic.

Guard the loop with an iteration cap (a keen weapon with a wide threat range and good confirm
bonuses can chain for a while). Cap generously — 10 is far past any realistic run — and surface
it as a GM notice rather than a silent stop.

### 7.3 Letting players spend luck points

The open question from the concept doc. **No new roll-requests API is needed** — the pattern
already exists in astora-mod's Stroke of Fortune
([stroke-of-fortune.mjs:353](../astora-mod/luck-hero/stroke-of-fortune.mjs#L353)) and generalizes
directly:

1. The card renders a player-clickable button (`.sof-contribute-btn` there; ours is
   `.ce-luck-btn`), gated to the actors eligible to spend at that stage.
2. The click opens a DialogV2 letting the player choose the source — regular luck, Special Luck
   Points, or the group pool — with availability shown per source.
3. The choice is dispatched **player → GM** over this module's own socket (§0), mirroring
   `dispatchSoF`'s shape: direct call when the clicker is the GM, socket emit otherwise. A GM
   handler deducts the point, records the spend in the card's flags, and re-renders.
4. The GM continues the flow with the spend already applied.

#### The luck adapter (`integrations/luck.mjs`)

Steps 2 and 3 are the *only* places that know astora-mod exists. They go behind one interface,
resolved once at `ready`:

```js
luck.available            // false when astora-mod is absent/disabled
luck.sourcesFor(actor)    // [{ key, label, available }] — regular / special / group
luck.spend(actor, source) // GM-side; deducts, returns success
luck.grant(actor)         // for monster reciprocity (§10)
```

The null implementation reports `available: false` and no sources. **Nothing else in the module
branches on astora-mod.**

#### Degrading when luck is unavailable

The flow is GM-driven, so every luck spend has a GM-side equivalent already — which is what makes
this degrade cleanly rather than lose functionality:

| Spend | Without luck |
|---|---|
| Trigger the effect at all | GM decides on the trigger stage, as they already do. |
| Grade shift (pre-roll) | Stage renders without the button; GM can still adjust the grade — it's a GM control. |
| Choose location (pre-roll) | Location is always rolled. (The GM can still override — called shots aren't luck-gated.) |
| Flat +1 (post-roll) | The "modify" stage is **skipped entirely**; severity computes straight off the power roll. |

So the only stage that disappears is the post-roll modify stage, and it disappears cleanly
because nothing downstream reads from it. Build the card's stage list as data with a
`requiresLuck` marker rather than hardcoding the sequence, and the collapse costs one filter.

**Why the luck buttons belong on our card and not on the roll-request cards:** two of the three
spends change *what gets rolled* — a grade shift changes the power formula, and choosing a
location replaces the location roll entirely. A luck button living on a roll-request card would
have to mutate that card's pending formula or cancel it outright, which is exactly the API
surface we'd rather not add. Putting all three spends on our own card means the roll-request is
only ever posted once the decision is settled, and it can be posted with the right formula the
first time.

That leaves one spend that is genuinely *post*-roll: the flat **+1 after the power roll**. Handle
it by keeping the prompt card in a brief "modify" stage after the power roll result arrives —
the card shows the total with a `Spend 1 Luck: +1` button, and only then does it compute severity.
The roll-request card is never edited; the prompt card owns the adjusted total. This also matches
the concept doc's rule that the grade-shift and flat-+1 spends are mutually exclusive: they are
two buttons on the same card in two different stages, and the card knows which one already fired.

Concept §3's "luck may only be spent once per roll" is enforced in the card's flags — one spend
record per stage, per actor.

**Later, optional:** if the two-card dance (prompt card + roll-request card) proves annoying at
the table, the merge is a generic `playerActions` slot in pf1-roll-requests — descriptor-shaped
buttons on a request card with a GM-side `onClick`, phased pre-roll/post-roll, following the
existing `onResult`/`summaryKey` conventions (including their in-memory-callback caveat). That's
a genuinely reusable roll-requests feature, not a crit-effects hack — but it is not needed for
v1, and it requires roll-requests to support mutating a pending request's formula.

### 7.4 Lethal draws

Concept §2's Lethal tables are flavor-only and mechanically inert — no save, no roll-off, pure
narration for a hit that has *already* been determined to kill. That makes them the cheapest
thing in the whole system: a catalog subset (`severity: "lethal"`, or its own small JSON), a
draw, and a card. No resolve layer, no outcomes, no luck.

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
  exists by this phase for the luck dispatch, and it is the reason the socket is specified as
  astora-independent rather than a thin proxy onto `gmProxy`.
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

---

## 10. Deferred / needs a decision later

- **Armor sacrifice** (concept §7): turn a failed save into a success by damaging armor at half
  hardness. Needs slot-level armor tracking that PF1 doesn't model, plus GM judgment on
  coverage. Ship as a `note` outcome + a manual GM button before attempting automation.
- **Monster reciprocity** (monster grants a PC a luck point to trade crit damage for an effect):
  hence `luck.grant()` in the adapter, not just a spend. Unavailable without astora-mod, which
  collapses the trade into a plain GM decision — the same degradation as every other luck stage.
- **Feats** (concept §3, "future"): the trigger layer should read from a list of trigger
  sources rather than hardcoding the five known ones, so a feat can register a trigger later.
- **pf1-token-randomizer**: any card showing a target's name to players must route through
  `api.getDisplayName` / `shouldObscure`, or obscured NPC names leak. Applies to the fumble
  "wrong target" result and every crit-effect card.

---

## 11. Build order

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | Module scaffold: `module.json` esmodules/styles/lang/relationships, entry file, API stub, CSS, CHANGELOG/README. Own GM socket (generic primitives). Catalog loader + schema validator + `lint()`, all tolerant of outcome-less entries. | — |
| **1** | **Fumble path end-to-end.** `fumbles.json` (transcribed from the existing tables + a new `natural` table), `fumble-flow.mjs`, card button + card mutation, roll-request draw with visible table. Journal-only results — no outcomes yet. | 0 |
| **2** | **Resolve layer.** `context`/`power`/`severity`/`location` + `anatomy.json`, all pure and console-testable. No UI. | 0 |
| **3** | **Prompt card + luck spending.** `result-card.hbs`, data-driven stage list with `requiresLuck` markers, `.ce-luck-btn` → DialogV2 → own socket → GM handler (§7.3). Luck adapter + null impl; build and test the no-astora path first, then wire the real one. | 1, 2 |
| **4** | **Standalone resolver** (§7.5). Quick action + ApplicationV2 manual input driving 2+3. First usable crit tooling end to end, on journal-only content, with zero pipeline risk. **Lethal draws** (§7.4) ride along — same quick-action plumbing, no resolve layer needed. | 3 |
| **5** | **Outcome framework.** Registry + `buff`/`condition`/`note` handlers, `effect-buffs` pack seeded from the migrated bone buffs, undo. Apply button lights up on entries that have outcomes. | 4 |
| **6** | **Dedicated healing migration** out of astora-mod, incl. socket-channel rename + buff script-call retargeting. Removes the last content-level astora coupling. | 5 |
| **7** | **Automated crit flow.** Attack-card trigger, roll-request sequence wired to the prompt card, crit-damage suppression + reinjection (§9), card mutation, lethal card button. | 4 |
| **∞** | **Content track.** Journals → catalog entries (id, name, journal UUID, location, damage types, severity, tags). Runs from phase 1 onward, independent of everything else. Outcomes and buffs get attached opportunistically, entry by entry, after phase 5. | 0 |

The reordering versus a mechanics-first build is deliberate: **phase 4 is the goal post.** After
it, you have a working crit-effect resolver producing real, named, journal-linked results at the
table — on content that is nothing but prose and tags. Everything from 5 on is deepening, not
unblocking, and the content track never waits on it.

Phase 2 is independent of 1 above the catalog layer, so the two can run in parallel.
