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
| **Recommended** | `astora-mod` | Everything runs; luck-point spending is unavailable. |

## What works today

### Fumble resolution

1. Rolling a **natural 1** on an attack automatically rolls a confirmation die, shown on the
   attack card.
2. If the confirmation fails — or if the module cannot tell, because there was no single target
   with a readable AC — a GM-only **Resolve Fumble** button appears on the card.
3. Clicking it asks which table to draw from. The attack type is pre-selected from the weapon:
   natural attacks use the natural table, bows and crossbows the bow table, other ranged attacks
   the thrown table, everything else melee.
4. A `1d12` roll request is posted for the fumbling token, showing the **whole table** with the
   rolled row highlighted, so the player can see what they avoided.
5. The result is written back onto the original attack card as a link to its journal entry.

The button is only ever *suggested*, never enforced — a GM who wants to resolve a fumble the
module didn't flag can, and one the module did flag can be ignored.

## Compendia

| Pack | Contents |
|---|---|
| **Critical Effects** (Journal) | The effect descriptions. The prose players and GMs actually read. |
| **Critical Tables** (RollTable) | The original browsable tables, kept for reference. |
| **Critical Effect Buffs** (Item) | Buffs carrying the mechanics of an effect. Grows with the content track. |
| **Critical Effect Macros** (Macro) | Script calls for effects whose behaviour doesn't fit a typed outcome. |

The fumble flow draws from `data/fumbles.json` rather than the RollTables, so it can attach
mechanics to a result and reason about it without a compendium round-trip. The RollTables remain
the browsable, GM-facing copy.

## For GMs and developers

`game.criticalEffects` is available after `ready`:

```js
// Content health report — dead journal links, unreferenced journals, thin buckets,
// outcome coverage. Everything it reports is a warning.
await game.criticalEffects.lint();

// Fumble tables
game.criticalEffects.fumbles.table("melee");     // the rows
game.criticalEffects.fumbles.draw("melee", 7);   // what a 7 means
game.criticalEffects.fumbles.entry("stumble");   // one entry

// The effect pool (populated by the content track)
game.criticalEffects.catalog.query({ location: "leg", damageType: "b", severity: "severe" });
```

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
