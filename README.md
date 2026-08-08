# Critical Effects

A critical hit and fumble effect system for Pathfinder 1e on Foundry VTT.

The module ships a large body of **effect journals** describing what happens when a blow lands
badly — broken bones, severed fingers, dropped weapons — and the machinery to draw from them at
the table, link the result onto the chat card, and (over time) apply the mechanics automatically.

Content is **journal-first**: an effect that has nothing but prose and tags is fully usable.
Mechanical automation is attached to entries one at a time, and its absence never degrades a
resolution — you always get a named, journal-linked result.

## Requirements

| | Module | Without it |
|---|---|---|
| **System** | `pf1` (v11.10+) | — |
| **Required** | `lib-wrapper` | The module does not function. |
| **Required** | `pf1-roll-requests` | Resolutions cannot post their dice. |
| **Recommended** | `pf1-bleed-effects` | Everything runs; the bleed an effect describes ("2d6 bleed") stays prose and has to be tracked and rolled by hand. |
| **Recommended** | `astora-mod` | Everything runs; effects that use its buff automation can't offer their apply-buff button. |

## What works today

### Fumble resolution

1. Rolling a **natural 1** on an attack automatically rolls a confirmation die, shown on the
   attack card.
2. A GM-only **Resolve Fumble** button appears on the card. The confirmation roll is shown but
   not interpreted — whether it saved you is the GM's call, so the button is always available on
   a natural 1 and simply goes unused when the confirmation was good.
3. Clicking it asks which table to draw from. The attack type is pre-selected from the weapon:
   natural attacks use the natural table, bows and crossbows the bow table, other ranged attacks
   the thrown table, everything else melee.
4. A `1d20` roll request is posted for the fumbling token. **The player clicks to roll it** — the
   card shows the flavor line and the button only, not the table, so the eleven fumbles that
   didn't happen stay unspoiled. The result still arrives as the entry's name rather than a
   number.
5. Whenever that roll comes in, the result is written back onto the original attack card as a
   link to its journal entry. The GM doesn't have to be waiting on it, and a reload in between
   doesn't lose it.

The button offers, it never decides. Every natural 1 gets one, and ignoring it is a normal
outcome rather than a missed step.

#### Drawing a fumble by hand

The **Fumble** quick action in pf1-roll-requests does the same thing with no attack card behind
it — a house rule, a hazard, an attack rolled before the module was watching, a fumble the GM
simply decides has happened.

**Select the fumbling token first**; the draw is posted to it, and the quick action says so rather
than guessing if you haven't. It then asks which table to draw from — nothing to infer the attack
type from here, so the list opens on its first entry — and posts the same `1d20` request the
button does, for the same person to click.

Because there is no attack card to write the result onto, the draw **posts a card of its own**
when it lands, carrying the fumbler's name and then the usual result block and journal link. It is
the same block an attack card gets, rendered by the same code.

The fumbler comes from the canvas selection rather than roll-requests' actor prompt on purpose:
that prompt lists assigned player characters and player-owned NPCs, so the creature that most
often fumbles — a monster, or an unlinked mook — would never appear in it.

### Confirmation rolls ignore the d20 override

PF1's attack dialog lets you replace the d20 with any formula — `20` for an auto-hit, `2d20kh` for
a re-roll effect. That override applies to the **attack**, not to the confirmation that follows it:
both the fumble confirmation and the critical confirmation are rolled with a plain `1d20`, keeping
all the attack's bonuses.

Otherwise a manual `20` would confirm every critical automatically and `2d20kh` would confirm with
advantage — one override paying for two rolls. This is unconditional; say so if you'd rather it
were a setting.

### Critical hits

Threatening a critical puts a GM-only **Critical Effect** button on the attack card. It opens a
resolution dialog built from the live action — target, size, anatomy, damage type and multiplier
all read for you — and from there it works exactly like the manual resolver.

The button appears on a **threat**, not a confirmed hit. The confirmation is rolled and shown but
never interpreted: deciding whether it landed means reading a target's AC, which is unavailable or
ambiguous often enough that a wrong automatic answer costs more than a button you ignore. A natural
1 is explicitly *not* a threat, so a fumble and a critical are never both offered on one attack.

The dialog is yours alone. What the table sees is the dice — Location and Power go out as roll
requests for the **attacking player** to click, each carrying its table so they can read what their
result bought:

- The **location chart is built for the target first**. A four-limbed dragon's card reads "Wing"
  where a wolf's reads "Leg" and an ooze's reads "Torso" for the same face, because the chart is
  generated from that creature's own limbs rather than shared and patched up afterwards.
- The **Power roll indexes straight into the effect table** for that damage type and body part —
  the number rolled *is* the row, 1 mildest to 12 worst, with 0 or less as no effect and 13+ as
  row 12 plus a Fortitude save at a DC equal to the total.

#### Damage that doesn't land anywhere

Only **bludgeoning, piercing and slashing** roll a hit location. Fire, cold, electricity, acid,
sonic, force, positive and negative energy arrive as a wash rather than as a blow, so there is
nothing for a location roll to mean and no called shot to make.

They still vary by **creature type** — burning a humanoid is not burning an ooze — so each has one
effect table per anatomy instead of thirteen. In the dialog the Location stage becomes **Target**:
it still asks for the creature type and the damage type, and then simply continues. There is one
roll instead of two, and the result reads as "Scorched · row 7" with no body part in it.

The **13+ result** follows the same logic. A weapon critical past row 12 is named by the body part
it took — an arm torn away is an arm torn away whether a sword or a mace did it — while these are
named by the damage type, because burned to ash and blasted apart are not the same death. One
mortal result per damage type, shared across all three creature types.

#### Critical explosion

When a critical confirmation is *itself* a threat, Critical Power goes up a grade and the
confirmation is rolled again — repeating until one doesn't threaten. Those dice roll with the
attack, not in the dialog, and the attack card reports **Critical Explosion ×N**.

It only ever fires on attacks: it reads the confirmation roll, which only exists in PF1's attack
pipeline, so skill checks and saves can't reach it. Combat maneuvers don't confirm crits and so
can't explode either, and a natural 1 never explodes. Tied to the **Defer critical damage** setting
below, so a world not using this system sees no change to its criticals at all.

#### The GM's controls

The automation infers a lot, and some of it can be wrong, so each stage lets you correct what it
inferred rather than making you cancel and start over:

- **Location** (or **Target**) — the creature type, its **limb layout**, and the damage type, all of
  which decide which tables get used. See [Hit location](#hit-location) for what the layout does.
  The limb layout and the location buttons only appear for the three damage types that roll a
  location; everything else gets a **Continue** instead.
- **Power** — the grade, as a dropdown, and a free-text modifier (`+1`, `-2`). Picking a grade sets
  it *absolutely*: whatever the size difference and the explosions did, the pool becomes the one
  you named.
- **Result** — a dropdown of the same fourteen rows the player rolled against, so a result can be
  changed to any of them before it is committed.

Pressing **Confirm Result** is what commits: the effect is written onto the attack card as a
journal link, any deferred critical damage is rolled then and not before, the roll-request cards
come down, and the dialog closes.

The request cards stay in chat for the whole resolution rather than vanishing as soon as their
number arrives, so the table can still see what was rolled and against what while you're working.
Cancelling the dialog kills the process, so its cards go too.

Resolution state lives in the window, not in the world. Closing it or reloading abandons the
resolution; re-open it from the attack card's button and start over. Nothing is written anywhere
until you press **Confirm Result**.

#### Hit location

Hit location is a **d20**, rolled for **bludgeoning, piercing and slashing only** — see
[Damage that doesn't land anywhere](#damage-that-doesnt-land-anywhere) for the rest. It is laid out
the same way for every creature:

| Roll | Where |
|---|---|
| 1–12 | limbs / appendages, divided between whatever the creature has |
| 13–18 | Torso |
| 19–20 | Head |

What fills the 1–12 band depends on the creature type you picked:

- **Humanoid** — fixed. 1–6 a Leg, 7–12 an Arm.
- **Beast** — tick which of **Legs / Arms / Wings / Tail** it has and the band is split evenly
  between them: 3 faces each for all four, 4 each for three, 6 each for two, all 12 for one. A
  four-limbed dragon and a legs-only spider both get an even chart with no wasted rows.
- **Aberrant** — up to **four appendage types**, each with a name you can type in. The name is
  description only; every appendage rolls on the same appendage effect table whatever you call it,
  so "Tentacle" and "Pincer" cost nothing to add and just make the card read better. Leave a name
  blank and it reads "Appendage".

Tick nothing — an ooze, a snake, a creature that's all body — and the limb band folds into the
torso, so it reads **1–18 Torso, 19–20 Head**.

The bands you'll get are listed live under the checkboxes, so you can see what a change buys before
anything is rolled against it.

**Sides aren't tracked.** A location is "a Leg", not "the left leg" — which side it was is your
call in the moment it matters, and having the chart decide it doubled every table without changing
a single effect.

Whatever you set here is **saved onto the creature** as you set it, so you describe a hydra once
rather than once per critical. It saves to the actor in the sidebar, not to the individual token,
so every goblin on the scene picks it up. Defaults come from the PF1 creature type, and you can
pre-set them by hand — see [The resolve layer](#the-resolve-layer).

#### Deferring critical damage

There's a setting, **Defer critical damage**, off by default. Turning it on changes the shape of a
critical hit to match the house rule that damage and effect are alternatives:

- The attack card shows base damage and a threat. No critical damage is rolled yet.
- The confirmation still rolls, still animates, still shows.
- Picking *Critical Damage* rolls it immediately — that choice ends the resolution. Picking *Both*
  waits until you press **Confirm Result**, so an abandoned resolution leaves no orphaned damage.
  Either way it is animated at that moment and filled into the attack card's own critical damage
  column — including a working **Apply**, with damage types intact so DR and resistances still
  compute.
- The **per-part breakdown under the column** is filled in as well, so a critical reads exactly
  like a normal hit does: one row per damage part, each with its roll and its damage type, and the
  dice breakdown still expands. Extra rows are added when the critical pass produces more parts
  than the normal one, which a ×3 weapon or an action with crit-only damage will. Each cell copies
  its styling from the normal part beside it, so a row keeps matching itself even when another
  module has rearranged it — Little Helper's **Meld Damage & Type** in particular.

It's implemented as a libWrapper wrapper on PF1's damage pass. It touches core combat behaviour,
so it ships off — turn it on deliberately, and turn it off if anything looks wrong. Requires a
reload either way.

### Resolving a critical effect by hand

The **Critical Effect** quick action in pf1-roll-requests opens a manual resolver: pick a source
and a target, then set the crit multiplier, weapon class, and the two sizes. Sizes are named
rather than numbered and are filled in from the tokens you chose. It shows live what Critical
Power those inputs buy, then opens the same resolution dialog the automated flow uses.

The token you have **selected** when you click it becomes the **source** — whose player is asked
to roll the hit location and the Critical Power, exactly as the attacking player is in the
automated flow. Select several and the first is used; a resolution has one source. Select nothing
and the source starts blank, which is fine: the dropdown offers every token on the scene, and with
the source left at **— none —** there is nobody to ask, so the GM rolls both locally instead. The
**target** needs no selecting either — the dropdown opens on whichever token you have targeted.

Two things are deliberately *not* asked here. **Creature type and damage type** are asked for in
the resolution dialog's Location stage regardless, so asking twice would only let the two answers
disagree. And the dialog **opens at Location rather than Trigger**: the Trigger question chooses
between critical damage and a critical effect, and a hand-driven resolution has no attack card
behind it — so there is no suppressed critical damage to release, and two of its three answers
mean nothing.

Because there's no attack card to write the result onto, confirming the resolution **posts a card
of its own** — source → target, the Critical Power grade and roll, then the effect block and its
Apply-buff button. It's the same block an attack card gets, rendered by the same code.

This is the fallback for everything the automation can't see — an off-card kill, a GM ruling, an
attack resolved before the module was installed, a creature the pipeline doesn't understand.

```js
game.criticalEffects.openResolver();                    // blank
game.criticalEffects.openResolver({ critMult: 3 });     // pre-filled
game.criticalEffects.openResolver({ sourceId, targetId });   // token document ids

// `damageType` and `anatomy` have no field of their own, but a seed still carries them
// through to the resolution rather than being dropped.
game.criticalEffects.openResolver({ damageType: "piercing" });
```

### Lethal blows

Lethal entries are **flavour only** — no save, no roll-off, no mechanics — used when a hit has
already been determined to kill. Two ways to draw one:

- The **Lethal Blow** quick action, always available, for any kill including ones with no attack
  card behind them (coup de grace, environmental, narrative).
- A GM-only button on an attack card, shown when the damage could plausibly have downed one of
  its targets.

That button's gate is a *prediction*, not a ruling: damage isn't applied yet at card-render time,
DR may absorb some of it, and "kills" in this system isn't `hp <= 0`. It only decides whether the
button is offered — the quick action is always there regardless.

```js
game.criticalEffects.lethal.forType("slashing");   // what's available for slashing
game.criticalEffects.lethal.prompt();       // pick a damage type and draw
```

**Bludgeoning currently has no lethal entries** — the content ships that way. A draw against an
empty damage type says so rather than failing.

### Mechanics on an effect

An effect entry can carry **outcomes** — typed descriptors that do something rather than merely
printing prose. Nothing evaluates a stored script; each descriptor names a type handled by a
registered handler.

> **Not yet wired to the dialog.** The registry and its handlers work and are callable from
> `game.criticalEffects.outcomes`, but the resolution dialog no longer has an Apply button: the
> next piece of work replaces it with an apply-buff button on the attack card itself, where the
> people affected can see it. Until then a resolution names its effect and links the journal.

| `type` | Payload | Notes |
|---|---|---|
| `buff` | `uuid`, `overrides?`, `active?` | Pull an item from a pack and create it on the target. The workhorse. |
| `condition` | `id` | A PF1 status id. Undo won't cure a condition the target already had. |
| `note` | `text` | **No automation** — prints a line for the GM to adjudicate. |
| `delegate` | `entry` | Apply another entry's outcomes. The downgrade primitive. |

```jsonc
"outcomes": [
  { "type": "buff", "uuid": "Compendium.pf1-critical-effects.effect-buffs.Item.…" },
  { "type": "condition", "id": "prone" },
  { "type": "note", "text": "Movement is halved until the bone is set." }
]
```

Entries **without** outcomes are first-class: the resolution runs identically and simply has no
mechanics to offer. That's the point of the framework — mechanics get bolted onto entries that
already ship, one at a time.

Failures are isolated. If one outcome can't apply — a missing buff, a back end that isn't
installed — the others still do, and the card says what didn't work. An unrecognised type is a
reported no-op rather than an error, so a half-migrated catalog still runs.

**Undo** is recorded as data rather than a closure, so a misfire can be reverted even after a
reload. Reversal runs newest-first.

Other modules can add their own types:

```js
game.criticalEffects.outcomes.registerOutcome(
  "myType",
  async (descriptor, ctx) => ({ summary: "did a thing", undo: { what: "thing" } }),
  { undo: async (data, ctx) => { /* reverse it */ } },
);
game.criticalEffects.outcomes.registeredTypes();   // what's available
```

### Dedicated healing

Some conditions — broken bones, mostly — can't simply be healed away. They must first be
**treated** (a Heal check), after which they absorb a threshold of healing before clearing:
healing that would otherwise have gone to hit points.

Once a treated condition is on an actor, any incoming healing opens an allocation dialog so the
player can split it between hit points and their conditions. When healing is applied on someone's
behalf — a GM resolving a short rest — the dialog opens for the player who submitted it rather
than the GM.

Configure it on the buff sheet's **Advanced** tab, in the collapsible **Dedicated Healing**
section: the healing required to clear the condition, the Heal check DC that makes it ready to
absorb healing (0 waives the check), and — once it's configured — a read-out of the progress so
far with a reset control.

```js
game.criticalEffects.dedicatedHealing.requestHealCheck(actor, item);
```

This lived in astora-mod until its only consumers ended up here. A broken-bone effect now works
with astora-mod absent entirely.

#### Participants: what else can absorb healing

Anything that can soak dedicated healing is a **participant** — a name, a threshold, a running
total, and a callback that spends an allocation. Buffs configured through the section above come
from this module's own built-in provider. Other modules register their own:

```js
game.modules.get("pf1-critical-effects").api.dedicatedHealing.registerProvider(
  "my-module.wounds",
  (actor) => [{ id, name, required, received, allocate: async (amount) => cured }],
);
```

The enumerator **must be synchronous** — it's called from a hook that has to suppress the
incoming heal in the same tick. Register from `ready`; the API is published at `init`, so it's
there regardless of module load order.

pf1-bleed-effects' **Deep Bleed** rule is the reference consumer: a bleed lives in an actor flag
rather than an item, and lands in the same allocation dialog as a broken arm without either
module knowing anything about the other's storage.

## Compendia

| Pack | Contents |
|---|---|
| **Critical Effects** (Journal) | The effect descriptions. The prose players and GMs actually read. |
| **Critical Tables** (RollTable) | The original browsable tables, kept for reference. |
| **Critical Effect Buffs** (Item) | Buffs carrying the mechanics of an effect — currently the 19 Broken/Shattered bone conditions. Grows with the content track. |
| **Critical Effect Macros** (Macro) | Script calls for effects whose behaviour doesn't fit a typed outcome. |

The fumble flow draws from `data/fumbles.json` rather than the RollTables, so it can attach
mechanics to a result and reason about it without a compendium round-trip. The RollTables remain
the browsable, GM-facing copy.

## For GMs and developers

`game.criticalEffects` is available after `ready`:

```js
// Content health report — dead journal links, unreferenced journals, and how many of each
// table's twelve rows are still placeholders. Everything it reports is a warning.
await game.criticalEffects.lint();

// Fumble tables
game.criticalEffects.fumbles.table("melee");     // the rows
game.criticalEffects.fumbles.draw("melee", 7);   // what a 7 means
game.criticalEffects.fumbles.entry("stumble");   // one entry
game.criticalEffects.fumbles.prompt();           // what the quick action does: pick a table and
                                                 // post a draw for the selected token
game.criticalEffects.fumbles.prompt({ token });  // ...or for one you name

// The effect tables — one 12-row table per damage type x anatomy x body part. The Critical Power
// total IS the row: 1 is the mildest outcome for that location, 12 the worst.
game.criticalEffects.catalog.effectTable("slashing", "humanoid", "arm");        // the twelve entries
game.criticalEffects.catalog.effectFor("slashing", "humanoid", "arm", 7);       // what a 7 lands on
game.criticalEffects.catalog.effectFor("slashing", "humanoid", "arm", 15).save; // -> { type: "fort", dc: 15 }

// Damage types that roll no location keep one table per anatomy, under "general". The location
// argument is ignored for them rather than being an error, so a caller never has to check first.
game.criticalEffects.catalog.effectFor("fire", "beast", null, 7);
```

### The resolve layer

The critical-effect maths is pure and has no UI, so all of it can be driven from the console:

```js
const R = game.criticalEffects.resolve;

// Critical Power: base grade from the crit multiplier, shifted by size, explosions and any GM adjustment.
R.computeGrade({ critMult: 3, attackerSize: 5, targetSize: 4, weaponClass: "twoHanded" });
// -> { base: "heavy", grade: "brutal", formula: "2d6", flat: 1, breakdown: {...} }

// Shifts past either end of the ladder become a flat modifier instead of clamping away.
R.shiftGrade("brutal", 2);        // -> { grade: "devastating", flat: 1 }

// The GM's grade dropdown is an absolute pick, so it is solved back into a shift.
R.tiersToReach("devastating", { base: "heavy", priorSteps: 0 });   // -> 2

// Hit location (d20). The table is generated from the creature's own limbs.
R.locationFor({ anatomy: "beast", limbConfig: { beastLimbs: ["leg", "arm"] }, total: 3 });
// -> { slot: "leg", label: null, rolled: 3, chosen: false }

// The whole chart, as bands — what the dialog lists under the checkboxes.
R.locationBands({ anatomy: "aberrant", limbConfig: { appendages: ["Tentacle", "Pincer"] } });
// -> 1-6 Tentacle, 7-12 Pincer, 13-18 Torso, 19-20 Head

// Reading a real actor's layout
R.anatomyFor(actor);              // "humanoid" | "beast" | "aberrant"
R.limbConfigFor(actor);           // { beastLimbs: [...], appendages: [...] }
```

Per-actor overrides, for creatures the creature-type defaults get wrong. These are what the
dialog's Location stage writes, so setting them by hand and setting them in the UI are the same
thing:

```js
await actor.setFlag("pf1-critical-effects", "anatomy", "beast");
await actor.setFlag("pf1-critical-effects", "beastLimbs", ["leg", "wing", "tail"]);
await actor.setFlag("pf1-critical-effects", "critImmunity", 1);  // shrug off one table row

// Aberrants instead name their appendages. "" is an unnamed one, and reads as "Appendage".
await actor.setFlag("pf1-critical-effects", "anatomy", "aberrant");
await actor.setFlag("pf1-critical-effects", "appendages", ["Tentacle", "Pincer"]);
```

Both lists **replace** the default rather than merging, so a limb can be taken away — an empty
array is a creature with none, which folds its limb band into the torso.

> Set these on the **actor in the sidebar**, not on an unlinked token's own copy, or only that one
> token gets them. The dialog does this for you.
>
> The pre-d20 `limbs` flag is still read for backwards compatibility — its beast half maps over
> unchanged, and `["appendage"]` becomes a single unnamed appendage — and is cleared the first time
> a layout is saved over it.

### The resolution dialog

A critical resolution runs in a GM-only window that advances through its stages. Open one by hand:

```js
const R = game.criticalEffects.resolve;
const ctx = R.buildContext({
  target: canvas.tokens.controlled[0],
  manual: { critMult: 3, damageType: "slashing", weaponClass: "twoHanded", attackerSize: 4 },
});
await game.criticalEffects.crit.start({ context: ctx });
```

The GM works it through its stages; the players roll the Location and Power requests it sends them,
and that is the whole of their part in it.

State lives on the instance, so a reload loses it. That is the trade for keeping the working
surface out of chat — and the resolution is a handful of clicks, with nothing written anywhere
until **Confirm Result**.

### Regenerating the fumble tables

`tools/tables-to-json.mjs` transcribes the shipped Fumble RollTables into `data/fumbles.json`.
It de-duplicates: the three tables each carry their own copy of every journal, so "Dislocated
Elbow" exists three times with identical prose, and these collapse into one entry that all three
tables reference.

```bash
node tools/tables-to-json.mjs           # dry run, prints to stdout
node tools/tables-to-json.mjs --write   # save
```

The hand-authored `natural` table and any hand-added entry fields survive a re-run.

## Design

[`DESIGN.md`](DESIGN.md) is the engineering plan — layer boundaries, data schemas, and build
order. It is the source of truth for how the module is put together; the companion
`astora-critical-effects-plan.md` is the source of truth for the rules themselves.
