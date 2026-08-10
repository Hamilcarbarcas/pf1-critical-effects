# Changelog

## Unreleased

### Fixed
- **The Dedicated Healing section's hint text is legible again.** The *Healing Required* and *Heal
  Check DC* hints (and the section's intro note) inherited a near-white colour on the buff sheet's
  beige Advanced tab. PF1's V1 item sheets style neither `.hint` nor `.notes`, and core's rule for
  them sits in a cascade layer that any unlayered module rule outranks, so the module now sets the
  colour explicitly — the same token the section's progress line already used.

### Changed
- **The effect pool is populated — 196 entries filling all 756 rows of the grid, and all 47 mortal
  cells.** Names, ranks, damage types and slots are settled; prose, conditions and buffs are
  placeholders to be refined entry by entry. Every one of the 63 tables has an effect on every row
  and no table falls back to a placeholder. 492 of the 756 rows are an exact rank match; the rest
  are the drift-fill the generator is built for, concentrated in the tables that are written one
  effect per severity band rather than three — beast **tail** and **wing**, aberrant
  **appendage**, and all 24 energy `general` tables.
- **The mortal (13+) grid is keyed by damage type.** `mortal.byPart` was 13 cells keyed anatomy ×
  location and damage-type agnostic, on the reasoning that "past row 12 a torn-off arm is a
  torn-off arm whether a sword or a mace did it". Writing the content disproved it: a mace, a spear
  and an axe end an arm as **Critical Internal Bleeding**, **Kebabed** and **Vorpal Cut**, and every
  single cell of the draft had three claimants. `byPart` is now `[damageType][anatomy][location]` —
  39 cells instead of 13, all 47 of the grid written. The `byDamageType` half is unchanged and
  still drops anatomy, because burned to ash is burned to ash whichever creature it was.
  - `content/mortal.md`'s body-part table gains a damage type in its first cell —
    `Bludgeoning · Humanoid · Head`. The parser takes it in any punctuation.
- **The effect catalog is now self-contained — the journal packs are gone.** An entry carries its
  own prose in a `text` field rather than a UUID pointing at a compendium journal, and the two
  shipped packs (**Critical Effects** journals, **Critical Tables** roll tables) have been removed
  from the module. The prose is a paragraph and it belongs on the chat card next to the result,
  where it is actually read — a compendium round-trip, a drift-lint, an import tool and a UUID in
  every entry bought a click-through and a second place for the content to be wrong.
  - Effect prose now goes through PF1's **enricher**, so `@Bleed[2d6;deep=20]`, `@Condition[stunned]`
    and `@Damage[1d6]` written into an entry render as the clickable buttons those modules already
    provide. That is the manual path, kept deliberately alongside the automated one below.
  - The chat card shows the effect's name, its conditions, its description and its GM note in that
    order — what mechanically happened, then what it reads like, then what has to be ruled on.
  - `tools/tables-to-json.mjs`, which transcribed the shipped RollTables into JSON, is deleted; the
    pools have been the source of truth since phase 9.
- **The effect pool is empty.** Every shipped journal and effect was a placeholder, so there was
  nothing worth migrating to the new shape and the content track restarts against it. The mortal
  worksheet (`content/mortal.md`, the 13+ addendum) is unaffected and its 21 rows remain. Fumble
  and lethal entries keep their names and tags; only their journal links are gone.
- **One Apply button instead of the apply-buff button.** It now covers both of an entry's
  mechanical channels — conditions and buff — because the GM's decision is "did this land", not
  "did the buff half of this land". Conditions are applied *before* buff delivery opens its
  Refresh/Overwrite prompt, so cancelling that prompt no longer costs you the conditions the
  critical inflicted. The fumble flow offers the same button, which it previously had no way to.
- `game.criticalEffects.lint()` reports **condition drift** in place of journal drift: conditions
  the content uses that PF1 doesn't know, conditions PF1 has that the module's static list lacks, a
  usage count per condition, and any entry configuring bleed damage while pf1-bleed-effects is
  absent.

### Added
- **`conditions` on an effect, fumble or lethal entry** — the PF1 statuses a wound imposes, applied
  natively and with real durations. Previously these existed only as prose for a GM to read and
  apply by hand.
  - An **array**, because the content is full of pairs: *dazed 1 round and deafened 1d4 minutes*,
    *stunned 1 round and fatigued*.
  - A duration is `{ value, units, end? }`. `value` may be a **dice formula**, rolled when the
    condition lands. `units` is turn/round/minute/hour/day. `end` is `turnStart` (PF1's default),
    `turnEnd` or `initiative` — so *"until the end of your next turn"* is expressible, and is
    distinct from one round despite being the same six seconds.
  - This is PF1's own mechanism, not a buff standing in for one: the duration goes onto the
    condition's Active Effect, PF1 expires it against world time and **deletes** it, and a GM can
    right-click the condition on the character sheet to read or change the rounds remaining in the
    system's own dialog. No item on the sheet, nothing to track by hand.
  - Omitting the duration means the condition stays until something takes it off.
- **Bleed configuration on a `bleed` condition** — `{ formula, ability?, mode?, deep? }`, driving
  [pf1-bleed-effects](https://github.com/Hamilcarbarcas/pf1-bleed-effects). Hit point bleed, ability
  damage or drain, and optionally a *deep* wound that closes only after a threshold of dedicated
  healing (needs **Astora Homebrew rules** on in both modules).
  - **Omitting the block is a real answer**, not an unfinished one: it is the inert vanilla marker,
    which is also exactly what a world without pf1-bleed-effects gets. Neither is reported as an
    error at the table.
  - The condition is set before the bleed API is called, so the sheet shows one bleed condition
    rather than two — and it is the one carrying the duration. A timed bleed therefore ends
    properly: the effect expires, PF1 deletes it, and the module clears its stored bleeds.
- **"Astora Homebrew rules" setting** (world scope, off by default) — one switch for everything in
  this module that changes how other rules work. Currently that means dedicated healing; anything
  non-RAW added later joins it there. pf1-bleed-effects carries the identically-named setting for
  its own house rules, and the two are read together: its Deep Bleed rule is built on this
  module's dedicated healing, so a deep bleed is only inflicted when both switches are on, and
  turning on only one warns the GM instead of silently downgrading every deep bleed.
  - Deliberately **not** a master switch over the module. Nearly all of this is an interpretation
    of critical hits rather than a rule out of the book; the switch covers the parts a table
    running closer to RAW would want gone. **Defer critical damage** stays an independent setting
    — it rewires PF1's attack pipeline and needs a reload, which deserves to be found and reasoned
    about on its own rather than buried under something broader.
  - **Off stops new obligations, not existing ones.** The Dedicated Healing section is hidden on
    unconfigured buffs so no new threshold can be set, but a buff that already carries one keeps
    its section and its allocation dialog. Switching a house rule off must not strand a character
    mid-recovery with a wound the rules can no longer close.
  - `api.dedicatedHealing.enabled()` reports the switch, so other modules can check before
    creating a new obligation. Registration and allocation stay available regardless.
- **Dedicated Healing section on the buff sheet's Advanced tab** — a collapsible menu for the
  healing required, the Heal check DC, and (once configured) the progress so far with a reset
  control. Replaces typing the numbers into the PF1 dictionary-flag table by hand. Buffs only:
  clearing a condition deactivates the item, which is a buff-only field.
- **Provider API for dedicated healing.** Anything that can absorb dedicated healing is now a
  *participant* — a name, a threshold, a running total, and an `allocate` callback — and buffs are
  simply the built-in provider. `registerProvider(id, enumerate)` lets another module put
  something that isn't an item into the same allocation dialog; pf1-bleed-effects' Deep Bleed rule
  is the reference consumer. Enumerators must be synchronous, because the heal is suppressed from
  a sync hook.
  - Published on `game.modules.get("pf1-critical-effects").api.dedicatedHealing` at **init**, not
    only on `game.criticalEffects` at ready — ready hooks run in module load order, and
    pf1-bleed-effects sorts ahead of this module.
  - **Blocked participants.** A participant may report `blocked: true` with a short
    `blockedReason`, for a wound that exists but cannot absorb healing *yet* — an arrow still in
    it. It is listed in the allocation dialog, greyed and sorted last, with the reason where its
    input would be, rather than being quietly omitted: healing that vanishes with no explanation
    reads as a bug. Blocked participants are never allocated to, and an actor whose wounds are
    *all* blocked heals normally with no dialog at all. Additive and backwards-compatible —
    providers that don't set the field behave exactly as before. pf1-bleed-effects' healing-blocked
    deep bleeds are the first consumer.
- **pf1-bleed-effects added as a recommended module.** A great deal of the critical and fumble
  content inflicts ongoing bleed ("2d6 bleed", "a Heal check cannot stop it"), which that module
  turns into automated per-round damage rather than prose to track by hand.

### Changed
- **`requestBoneSetting` is now `requestHealCheck`.** The old name dated from when this only
  applied to broken bones. No alias — the sole caller is the *Dedicated Healing Use* compendium
  macro, which buffs invoke by compendium reference, so updating it there fixes actor-held copies
  too.
- **Dedicated healing config moved off the PF1 dictionary flags** onto this module's own flag
  (`flags.pf1-critical-effects.dedicatedHealing`). Built-in PF1 flags suited a feature whose only
  interface was the Advanced tab's flag table; now that it has a UI of its own, they're free again.
  The `useFortSave` flag on the injury buffs is unrelated and stays.

### Migration
- **`dhDC` / `dhRequired` / `dhReceived` / `dhCheckSuccess` are no longer read.** The compendium
  buffs ship migrated, but a buff **already on an actor** carrying only the old flags is inert:
  re-apply it from the *Critical Effect Buffs* pack, or fill in the new Advanced-tab section by
  hand. Any healing already banked against an old-flag injury is not carried over.
- **Fumble quick action** in pf1-roll-requests, a second way into the fumble flow for a fumble with
  no attack card behind it — a house rule, a hazard, an attack rolled before the module was
  watching. It asks the same table question and posts the same player-rolled `1d20` draw the
  **Resolve Fumble** button does; only the entry point differs.
  - The fumbler is the **selected token**, not roll-requests' actor prompt. That prompt lists
    assigned PCs and player-owned linked NPCs only, so the creature that most often fumbles is not
    in it, and what it returns is an actor id that then has to be guessed back into one of the
    actor's tokens. Nothing selected is answered with a notice rather than a guess.
  - A draw with no attack card **posts a card of its own** when the roll lands, carrying the
    fumbler's name — the same answer the standalone resolver gives a hand-driven crit, and the same
    renderer paints the result into both. Created only once there is a result to put in it, so an
    abandoned or unmapped draw leaves nothing behind.
- **Anatomy is a catalog dimension** (`effects.json` v3). Effect tables are now keyed
  `damageType → anatomy → location` rather than `damageType → location`: a beast's foreleg and a
  humanoid's weapon hand no longer share twelve rows. (The location half of that key has since
  become weapon-damage-only — see Changed.)
- **Mortal effects.** A `mortal[anatomy][location]` entry, read *on top of* row 12 at the 13+
  clamp and damage-type agnostic. Optional — absent, 13+ stays "row 12 plus the Fort save".
- **Tagged effect pool** (`data/pool.json`), now the source of truth for effect content;
  `data/effects.json` becomes generated build output. Each effect carries a `rank` (1-12 severity
  score), anatomy-qualified `slots` (`humanoid/arm`, `*/torso`) and `damageTypes`, and
  `tools/pool-to-tables.mjs` works out which of the roll tables it lands in. One effect tagged
  across several damage types and body parts covers many rows, so saturating the grid takes a few
  hundred effects rather than one per row. Runtime is unchanged — the engine still indexes a
  stored 12-row table and never queries the pool.
- **Nearest-fit placement with a drift cap.** Rank is a severity score, not a row address: a
  candidate is seated at the free row nearest its rank, within ±1 (`--drift n`). That flex is what
  stops the pool needing an exact peg for every hole — an effect written as a 6 for bludgeoning
  also serves a slashing table that needs a 7. The cap is what stops a rank-8 wound landing on row
  12 and counting as filled; out-of-range rows stay placeholders. `pins` override placement for
  authorial decisions.
- **Coverage report** (`content/COVERAGE.md`, via `tools/pool-report.mjs`) — the content work
  queue for all three tracks. Band-gaps in tables that already have content are listed
  closest-to-done first and kept separate from wholly untouched tables, plus untriaged (rankless)
  and untagged entries, fumble counts per attack type, and lethal counts per damage type.
- **Fumble pool** (`data/fumble-pool.json`), the same tag-and-generate treatment as effects;
  `data/fumbles.json` becomes generated output (`tools/fumbles-to-tables.mjs`). The only tag is
  `attackTypes` — there is **no rank**, because a fumble table's rows are unordered peers rather
  than a severity ladder, so the die picks which fumble and not how bad it is. A short table gets
  placeholders rather than repeats: with peers a repeat silently doubles that outcome's odds.
- **Severity bands** (`SEVERITY_BANDS`) as authoring structure — 1-3 minor, 4-6 moderate,
  7-9 severe, 10-12 grave. Still not a runtime layer: the power total indexes straight into the
  row and nothing in the resolution path reads a band.
- **Module scaffold.** The content-only compendium module gains code: an entry point, a
  stylesheet, localization, declared relationships (`pf1`, requiring `lib-wrapper` and
  `pf1-roll-requests`, recommending `astora-mod`), and two new empty packs — `effect-buffs`
  (Item) and `macros` (Macro) — for mechanics to grow into.
- **Own GM socket** (`module.pf1-critical-effects`), carrying generic primitives only:
  `updateDocument`, `createChatMessage`, and `createRollRequest`. Independent of astora-mod, so
  nothing here stops working when that module is absent.
- **Catalog layer.** `data/effects.json` (the critical effect pool) and `data/fumbles.json` (the
  fumble tables) are loaded and indexed once at `ready`, then queried synchronously. Entries
  without mechanical outcomes are first-class: the flow resolves, names, and journal-links them
  and stops.
- **Validation and lint.** Structural validation refuses unusable rows without failing the load.
  `game.criticalEffects.lint()` reports dead journal links, journals no entry points at, thin
  buckets, unregistered outcome types, and outcome coverage as a progress metric.
- **Fumble path, end to end.** A natural 1 forces a confirmation roll and puts a GM-only
  **Resolve Fumble** button on the attack card. The button picks an attack type
  (pre-selected from the weapon) and posts a targeted `1d20` roll request — the table is *not*
  printed onto the card, so the nineteen fumbles that didn't happen stay unspoiled, but the result
  still reads as the entry's name; the **player** clicks to roll it. Whenever that roll lands, the
  drawn effect is written
  back onto the attack card as a journal link — completed from a global hook, so an open-ended
  wait or a GM reload doesn't lose the pending draw.
- **Fumble tables** transcribed from the shipped RollTables into `data/fumbles.json` by
  `tools/tables-to-json.mjs`. The three tables each carried their own duplicate copy of every
  journal; these collapse into 19 distinct effects that the tables reference by id.
- **Draft `natural` fumble table**, hand-authored — no such RollTable ships in the pack. It
  reuses the entries that do not presuppose a held weapon. See `_naturalNote` in
  `data/fumbles.json`.

- **Resolve layer** (`src/resolve/`) — the critical-effect maths, pure and synchronous, with no
  UI and no world mutation, so it is testable from the console and shared by the automated flow
  and the manual resolver.
  - `power.mjs` — the Glancing→Devastating grade ladder, base grade from crit multiplier, size
    shift, the ±1 weapon-class modifier, one step of the confirmation explosion, and
    `computeGrade()` which stacks every shift and reports an auditable breakdown. Shifts past
    either end of the ladder convert to a flat ±1 per step, computed once on the summed shift so
    that up-one-down-one is a no-op.
  - `location.mjs` + `data/anatomy.json` — the three d12 location tables as data, per-creature-type
    anatomy defaults, and the beast fallback chain (a row naming a limb the target lacks walks to
    the next candidate, terminating at the torso). Chosen locations are recorded as chosen rather
    than rolled.
  - `context.mjs` — reads the world once into a frozen object that everything downstream reads
    from, including the "sole natural attack" derivation.
- Anatomy data is validated on load on the same terms as the other catalogs.
- **Critical resolution dialog** — one GM-only ApplicationV2 per resolution
  (`flow/crit-dialog.mjs` + `apps/crit-dialog.hbs`), advancing through the stage sequence. The
  machinery is the GM's business, so it does not go in chat; what lands in chat is the dice the
  players roll, and the finished result written back onto the attack card.
  - State is **in memory** on the GM's client. A reload or a closed window abandons the
    resolution — re-open it from the attack card's button. That is the deliberate trade: the
    alternative is persisting every intermediate step to the world to make a few clicks
    recoverable.
  - The stage sequence (`flow/stages.mjs`) is **data**, not control flow, and the only branch is
    the trigger: picking damage alone ends the resolution there, so the three stages after it are
    simply absent rather than skipped through.
  - Each stage lets the GM correct what the automation inferred instead of forcing a restart:
    creature type and damage type at **Location**, an absolute grade dropdown and a free-text
    modifier at **Power**, and a dropdown of all fourteen rows at **Result**.
  - **Confirm Result** is the commit, and it is the only thing that writes: the effect goes onto
    the attack card, deferred critical damage is rolled *then* rather than when it was chosen, the
    roll-request cards come down, and the dialog closes. Cancelling takes the cards with it, since
    an abandoned resolution kills the process.
- **Location and Power are rolled by the attacking player**, as targeted pf1-roll-requests cards
  carrying the relevant table (`showTable`), so the player sees the chart and their row
  highlighted rather than a bare number. The dialog shows what it is waiting for and can cancel.
  - The **location table is resolved for the target** before it is sent: rows run through the beast
    fallback chain, so a wolf's card reads "Left Leg" where a naga's reads "Torso" for the same
    face, and adjacent rows that land in the same place are merged into one band.
  - The **Power request carries the effect table itself**, as the fourteen outcomes a total can
    produce: "no effect", the twelve rows for that damage type and body part, and the save-or-die
    at 13+. The same list is the GM's override dropdown, so an index into it means the same thing
    in both places.
  - **Choose Location** posts the same chart as a `selectFromTable` card, so a called shot is the
    player's pick rather than the GM's. The pick arrives as an index, which is why the resolved
    location rides along on each row.
  - Request cards **stay up for the whole resolution** rather than vanishing when their number
    arrives, so the table can still see what was rolled and against what while the GM works.
  - The power roll's flat modifier goes into the **formula** (`2d6+1`), not added afterwards, so
    the number the player rolls is the number the table reads.
  - A resolution with no attacker token — the standalone resolver, typically — rolls in the dialog
    instead of dead-ending.
- Features can register their own GM socket handlers (`registerHandler`), so the socket keeps only
  generic primitives of its own.
- **Standalone resolver** (`flow/resolver-app.mjs`) — an ApplicationV2 with manual inputs for
  target, crit multiplier, damage type, weapon class, size and anatomy, showing a live preview of
  the Critical Power those inputs buy. It runs the *same* resolve path as the automated flow and
  hands off to the same resolution dialog, so it is a different way in rather than a second
  implementation. Available as a **Critical Effect** quick action in pf1-roll-requests, and as
  `game.criticalEffects.openResolver()`.
- **Lethal draws** (`flow/lethal.mjs`, `data/lethal.json`) — flavour-only narration for a hit
  already determined to kill. Available as a **Lethal Blow** quick action for any kill, including
  ones with no attack card behind them, and as a GM-only button on an attack card whose damage
  could plausibly have downed a target. That gate only decides whether to *surface* the button:
  damage isn't applied at render time, DR may eat some of it, and "kills" isn't `hp <= 0`, so it
  is a prediction and never blocks a GM who wants the draw anyway.
- Lethal entries were transcribed from the `… - Lethal` **journal folders**, not the RollTables —
  the three `Lethal - …` tables that ship in the pack are empty. Bludgeoning currently has no
  entries; a draw against an empty bucket reports that rather than failing.

- **Outcome framework** (`outcomes/registry.mjs`) — typed descriptors resolved through a registry
  keyed by `type`; nothing ever evaluates a stored string, so outcomes survive serialisation onto
  a chat card and render identically for every client.
  - Each descriptor is **isolated**: one failing handler logs, reports itself in the card summary,
    and lets the rest of the array apply. An effect whose back end is missing degrades to what a
    journal-only entry would have given you, never a broken resolution.
  - An outcome of an **unregistered type** is a reported no-op, never a thrown error, so a
    half-migrated catalog still runs.
  - **Undo** is recorded as serialisable data rather than an in-memory closure, so a misfire can
    still be reverted after a reload. Reversal runs newest-first.
- **Built-in handlers** (`outcomes/handlers.mjs`): `buff` (pull from a pack, create on the target,
  activate), `condition` (PF1 status ids — undo will not cure a condition the target already had),
  `note` (no automation; a GM adjudication line), and `delegate` (apply another entry's outcomes —
  the downgrade primitive `save.onSuccess` is expressed with, guarded against cycles).
- **Apply / Undo in the resolution dialog**, shown only when the drawn entry actually carries
  mechanics. An entry without them renders identically and simply has no button.

- **Dedicated healing migrated in from astora-mod** (`integrations/dedicated-healing.mjs`) — the
  house rule where treated conditions absorb healing before it reaches hit points. Its only
  consumers were critical-effect buffs, so it belongs here; after this migration a broken-bone
  effect works with astora-mod absent entirely. The socket channel moved with its listener, the
  Heal-check roll request now routes through this module's own GM socket, and the entry point is
  `game.criticalEffects.dedicatedHealing.requestBoneSetting(actor, item)`.
- **Bone buffs and their macros migrated**: 19 Broken/Shattered buffs into `effect-buffs` and 4
  script-call macros into `macros`, with all 61 script-call UUIDs, 7 cross-buff `@UUID` links, and
  the macro's compendium lookup retargeted. The packs are now self-contained — nothing in them
  references astora-mod.
- astora-mod's rest manager tags GM-applied healing with a `healDelegate` option (was
  `astoraHealDelegate`) so the allocation dialog opens for whoever submitted the rest. The old key
  is still honoured.

- **Automated critical flow.** A critical *threat* on an attack puts a GM-only **Critical Effect**
  button on the card, which opens a resolution built from the live action — the same dialog,
  resolve layer and outcome framework the manual resolver has been driving since phase 4. A threat
  is the whole gate; the confirmation is displayed but never interpreted. A natural 1 is explicitly
  not a threat — it is an automatic miss, and the fumble path fabricates a confirmation roll on one
  — so a fumble and a critical can never both be offered for the same attack.
- Card buttons are written through a per-message queue. Foundry invokes hook callbacks without
  awaiting them, so two features attaching to the same card from the same hook both read the flag
  before either wrote it, and the later write discarded the earlier button.
- **Deferred critical damage** (`integrations/pf1-pipeline.mjs`, off by default — see the
  **Defer critical damage** setting). With it on, PF1's critical-damage pass is skipped so the card
  shows base damage and a threat; critical damage is rolled fresh only if it is chosen over an
  effect, and animated at that moment through the same Dice So Nice API PF1 uses. The confirmation
  roll is untouched and still animates.
  - The damage lands in **PF1's own critical column**, not a block of our own. Suppression leaves
    that cell rendered but blank, so it is filled rather than added — and the rolls are written
    into `system.rolls.attacks[i].critDamage` in PF1's serialised form, which is what makes the
    card's **Apply** button work: PF1 rebuilds per-type damage instances from those rolls to
    compute DR and energy resistance. A total painted into the DOM alone would apply as an untyped
    lump.
  - The total shown is the whole critical (base plus the extra passes), the way PF1 composes it,
    so the dialog and the card never quote two different figures for one hit.
  - When no critical damage is ever rolled, the column's apply anchors are **removed** rather than
    left inert — their `data-value` is empty, so a click only logged a warning.
  - Implemented as a libWrapper **MIXED** wrapper on `ChatAttack.prototype.addDamage`. Not an
    OVERRIDE, since ckl-roll-bonuses works in this neighbourhood; not a WRAPPER either, because
    WRAPPER is a contract that the wrapper always chains and suppression is precisely a decision
    not to. MIXED still sorts ahead of any OVERRIDE. Verified that no other installed module wraps
    that method.
  - Suppression leaves `critDamage.rolls` empty, which every consumer in the system already guards
    against with a length check, so nothing else changes.
- The lethal-draw button is now offered on attack cards automatically, alongside the crit trigger.
- **The finished resolution is written onto the attack card** — the location, the row it landed
  on, the drawn effect as a journal link, and the save if there is one. Same role the fumble result block plays,
  so chat still tells the whole story without the machinery being in it.

- **A d20 override does not carry into a confirmation roll.** PF1's attack dialog can replace the
  d20 with any formula — `20` for an auto-hit, `2d20kh` for a re-roll effect — held in
  `rollData.d20`. The critical confirmation is rolled through the same path with the same roll
  data, so it inherited the override and a `20` confirmed every critical automatically. Both
  confirmation paths now force a plain `1d20`: an override buys the attack it was spent on, not a
  free confirmation as well.
  - The **fumble** side rebuilds its forced confirmation with the d20 term replaced and every
    bonus term kept, flavour and order intact, so the breakdown still reads like the attack's.
  - The **critical** side is a libWrapper **WRAPPER** on `ChatAttack.prototype.addAttack` that
    strips `rollData.d20` for the `critical: true` pass only, restoring it in a `finally` — the
    same roll data drives the remaining attacks of a full attack, each of which should still get
    the override on its own attack roll. WRAPPER because it always chains, and because
    ckl-roll-bonuses registers a WRAPPER on that same method.

- **Effects are tables, not a pool.** The shipped content was already authored as one 1d12
  RollTable per damage type × body part, so the Critical Power total now indexes straight into a
  row — 1 the mildest outcome for that location, 12 the worst. The severity bands, the weighted
  pool and `query()`/`draw()` are gone; `catalog.effectFor()` is the whole lookup.
  - `tools/effect-tables-to-json.mjs` transcribes the tables into `data/effects.json`. **Twelve
    rows is an invariant**, enforced by the validator rather than assumed: the resolution clamps
    and indexes without checking for a hole, so a short table fails at load instead of silently
    producing nothing at the table. A row covering a range fills every index in it, which is also
    how a deliberate repeat is expressed.
  - Slots with no content yet (wings, tails, appendages) get full tables of marked placeholders,
    so the invariant holds everywhere and `lint()` can report coverage per table — `s/wing 0/12`
    rather than one unactionable percentage. Currently **144 of 252 rows written**.
  - The shipped tables are **alphabetical**, having been auto-generated from folder contents. They
    need reordering by severity for the mechanic to mean anything; emitting to JSON makes that a
    text edit rather than twelve drags per table in the Foundry UI.
- **No severity layer.** `resolve/severity.mjs` is gone with the bands it computed: the effect
  table's twelve rows *are* the severity ladder, so a second scale could only disagree with the
  first. Critical immunity survives the change as a penalty to the Critical Power total — rows
  shrugged off — folded into the modifier so it appears in the grade breakdown rather than
  silently moving the answer.
- **The grade override is solved for, not nudged.** `power.tiersToReach()` converts the GM's
  absolute pick ("make this devastating") into the shift the model works in, forcing the summed
  shift to the target's own index. The dropdown therefore lands on the grade it names every time,
  and absorbs whatever overflow the automatic calculation had — once the GM has named a grade,
  "you shifted two past devastating" is no longer a fact about the result.
- **Player agency stayed with the dice.** Luck-point spending was built — an offer card, a source
  picker, a player→GM dispatch, a `requiresLuck` stage marker — and then removed: astora-mod's
  luck menu already exists, and a second place to spend a point that lives only inside a crit
  resolution bought less than it cost. `computeGrade`'s luck inputs became the generic
  `extraTiers` / `extraFlat` behind the Power stage's own controls, and the called shot that a
  spend used to buy is simply a button. astora-mod remains recommended, now for buff automation.
- **The dialog carries its own dark/amber styling** rather than the system's parchment, matching
  the other astora-family windows. Every colour is stated rather than inherited, so the window
  does not change character with the client's theme.
- **The confirmation explosion moved out of the dialog** (`flow/explosion.mjs`) and happens with
  the attack roll, gated on **Defer critical damage**. Each confirmation that is itself a threat
  rolls another; the count is reported on the attack card as **Critical Explosion ×N** and read
  back by the resolution as grade shifts.
  - It fires on attacks and nothing else *by construction*: it reads `chatAttack.critConfirm`,
    which only exists inside the action-use attack pipeline, so skill checks, saves and ability
    checks can never reach it. PF1 already excludes combat maneuvers from crit confirmation.
  - A natural 1 never explodes — the fumble path fabricates a confirmation on one, and a fumble is
    not a threat.
  - The re-roll reuses the confirmation's own formula, so it inherits every bonus that applied to
    it *and* the already-stripped d20 override, rather than re-deriving both.
  - Runs on `pf1PostActionUse` rather than as a wrapper, so the extra dice land after the
    confirmation that caused them instead of before it. Capped at 10 iterations.

- **The per-part breakdown comes back too.** The critical column's total is only the header; PF1
  lists one row per damage part under it, with the roll and its damage type. Suppression left the
  critical half of every row blank, and those cells are now filled from the deferred rolls.
  - Paired positionally, exactly as PF1's `finalize()` does it — crit roll *a* into row *a*,
    not grouped by critical pass.
  - The critical pass rolls `critMult - 1` times **and** adds the action's `critParts`, so it can
    produce more rolls than there are normal rows. PF1 sizes its row list to the longer of the two;
    a suppressed card was built to the shorter one, so the extra rows are appended with an empty
    normal side — the shape PF1 would have rendered.
  - The roll cell is built with `roll.toAnchor()`, the same call PF1 makes, so the expandable dice
    breakdown behaves identically. The damage type goes through PF1's own partial rather than being
    copied from the normal side, because `critParts` can introduce a type the normal parts lack.
  - The rows are found by walking down from the `<th data-damage-type="critical">` header rather
    than by shape. "Every `<tr>` made of `<td>`s" also catches `<tr class="attack">` — the attack
    roll and its confirmation sit in one *above* the damage header — which made row 0 the wrong
    row and left the real ones untouched.
  - The critical cells are taken as the row's second **half**, not as indexes 2 and 3. Little
    Helper's "Meld Damage & Type" merges each roll+type pair into one `colspan="2"` cell and
    deletes the second, so a melded row has two cells and index 2 finds nothing. The split is safe
    either way — the template emits the same number of cells on both sides, so the row is
    symmetric by construction and a pairwise transform keeps it that way — and it is
    order-independent: melded before we run, we fill one cell; melded after, we fill two and the
    meld collapses them like any other pair.
  - A melded cell takes the normal side's own classes with `normal` read as `critical`, and its
    anchor takes whatever classes decorated the normal one. Mirroring rather than hardcoding means
    the two halves keep matching without this module knowing which other module did what.
  - Appended overflow rows are cloned from the row above rather than built, so they inherit the
    real cell count, colspans and melding instead of a guess at them.

### Fixed
- **The manual resolver could not open at all** — `Template part "form" must render a single HTML
  element`. Its template had two roots, the body `<div>` and the submit `<footer>`, and
  ApplicationV2 requires exactly one per part. The footer is now its own part on core's generic
  footer template. The input `change` listener moved from `_onRender` to `_onFirstRender` as well:
  it is bound to the persistent frame element and re-renders the app, so per-render binding stacked
  one listener per re-render.
- **"Compound Fracture" collapsed eight distinct journals into one catalog entry.** Entry ids are
  slugged names and the pack ships eight separate Compound Fracture journals — the arm and leg
  versions differ materially (1d6 bleed / DC 10 vs 1d8 bleed / DC 15), so every table pointed at
  the bludgeoning-arm journal and seven were orphaned. Split into `compound-arm-fracture` and
  `compound-leg-fracture`, each carrying its own journal. The fold-in tool now refuses any name
  used for two different effects, so this class of collapse cannot recur silently.
- **Deferred critical damage never reached the attack card**, which kept reading `0` after a
  resolution. PF1's `AttackDamage#total` initialises to **0**, not to nothing, so a suppressed
  critical column renders the literal text `0` — and the injection's guard skipped any cell whose
  total looked non-blank, which was all of them. It now compares the rendered total against what
  `system.rolls` actually holds, so `0` is recognised as the placeholder it is.
  - The headless check that should have caught this passed the template a bare `{}` for
    `critDamage`, so `{{total}}` rendered blank and the suite asserted the wrong contract. The
    fixture now mirrors the real class field for field, and a second suite executes the injection
    against a DOM rather than only inspecting the markup it targets.
  - A column with nothing rolled yet now reads `—` and drops its apply buttons, rather than
    offering a click that applies zero damage.
- **Crit damage is written back as plain data.** PF1 replaces the serialised rolls in
  `system.rolls` with live `Roll` instances in place at prepare time, and `deepClone` passes class
  instances through by reference; the write-back now round-trips through JSON so each roll goes
  back in the form PF1 stored it.
- `.dedicated-healing-form` lost its selector during the migration from astora-mod, leaving an
  orphaned `padding` block; the dialog had no padding rule at all.
- **The confirmation explosion never looked at PF1's confirmation roll.** The dialog stage rolled
  a *fresh* d20 and tested that, so the real confirmation was ignored entirely and the dialog's own
  new die could "explode" about one time in twenty — a confirmation of 7 still advanced.
- The crit resolution dialog crashed on open, twice: it assigned `this.id` and `this.state`, both
  of which ApplicationV2 defines as getter-only. Its own fields are now `resolutionId` and `crit`.
  ApplicationV2 reserves ten names — `classList`, `element`, `form`, `hasFrame`, `id`, `minimized`,
  `rendered`, `state`, `title`, `window` — and a subclass that assigns to any of them throws on
  construction. Overriding `title` with a getter, which this dialog does, remains fine.

### Changed
- **Only bludgeoning, piercing and slashing roll a hit location** (`effects.json` v4). Fire, cold,
  electricity, acid, sonic, force, positive and negative energy arrive as a wash rather than as a
  blow, so there is nothing for a location roll to mean and no called shot to make. They keep the
  *anatomy* axis — burning a humanoid is not burning an ooze — and drop the location one, collapsing
  thirteen tables each into one per anatomy under the pseudo-slot `general`. The grid goes from 130
  tables / 1,560 rows to **63 tables / 756 rows**.
  - **`mortal` splits into two halves keyed by different axes**, because the axis that
    distinguishes a death is not the same on both sides of the grid.
    `mortal.byPart[anatomy][location]` covers the weapon types and ignores which of the three did
    it — a torn-off arm is a torn-off arm whether a sword or a mace did it — while
    `mortal.byDamageType[damageType]` covers the rest and ignores anatomy, because burned to ash and
    blasted apart are plainly not one result and a mortal fire result is the same story for a
    humanoid and a beast. 13 entries plus 8, and `mortalCells()` enumerates both so nothing has to
    reconstruct the rule. `mortalFor` now takes the damage type as its first argument.
  - `LOCALIZED_DAMAGE_TYPES` names the three, and `slotFor(damageType, location)` is the single
    place that decision is made: a non-localized type answers `general` whatever location it is
    handed, so `effectFor("fire", "beast", "wing", 7)` is a lookup that ignores an axis rather than
    a mistake. `general` is deliberately absent from `SLOTS` — no location table can produce it and
    nothing in the resolve layer knows it exists.
  - **The dialog's Location stage narrows rather than disappearing.** It is the only place the
    creature type and the damage type are chosen and the tables are keyed by both, so for those
    seven it presents itself as **Target**: the two selects stay, the limb layout and location chart
    go, and the two location buttons become one **Continue**. With no damage type picked yet neither
    path is offered — an unset type must not silently take the non-localized one. The readout gained
    a **Damage** line, since for those seven it is the only thing that says which table a result
    came from.
  - **Content:** pool effects for the energy types are tagged `<anatomy>/general` (or `*/general`).
    An effect whose damage tags select nothing — a fire tag with only body-part slots, or the
    reverse — is reported by `pool-to-tables.mjs` without failing the build. `content/mortal.md`
    becomes two tables, told apart by each row's first cell so they can sit anywhere in the file.
    Nothing was lost in the change: every energy table in the pool was empty.
- **`force` is a damage type the module keeps tables for**, and follows the energy types in every
  respect: no hit location, one table per anatomy, its own mortal row. It had been excluded
  alongside `untyped`, `precision` and `nonlethal` on the grounds that those describe how damage is
  dealt rather than what it does to a body, which is not true of force.
- **The Critical Effect quick action takes its source from the canvas selection** rather than
  roll-requests' actor prompt, for the same reasons the new Fumble action does: the prompt cannot
  offer a monster or an unlinked token, and it answers with an actor where a roll request needs a
  token. The selected token seeds the source; with nothing selected the source starts blank and the
  resolver's own dropdown still offers every token on the scene, which a source-less resolution has
  always supported. The target is unaffected — its dropdown already opens on the targeted token.
- **Hit location is a d20, and the beast and aberrant tables are now generated per creature**
  (`anatomy.json` v2). The band layout is the same for every anatomy — **1-12 limbs, 13-18 torso,
  19-20 head** — and the limb band is divided between the body parts that creature actually has.
  Twelve faces is the whole point of the die: it splits evenly by 1, 2, 3 **and** 4, so every layout
  comes out even with no remainder rule and no fallback chain.
  - **Beast** gains checkboxes for **Legs / Arms / Wings / Tail** at the dialog's Location stage.
    The band splits evenly between whatever is ticked: 3 faces apiece for four, 4 for three, 6 for
    two, all 12 for one.
  - **Aberrant** gains up to **four appendage types, each with a name you can type in**. The name is
    descriptive only — every appendage reads the same `appendage` effect table however it is
    labelled — so a card can say "Tentacle" at no content cost. Blank names read as "Appendage".
  - **A creature with no limbs ticked** folds the limb band into the torso and reads
    `1-18 Torso, 19-20 Head`, which is what an ooze wanted all along.
  - The layout is **saved onto the target actor as it is edited**, so a creature is described once
    rather than once per critical. Writes go to the world actor even when the crit was against an
    unlinked token, so every token of that creature picks it up.
  - The dialog lists the resulting bands live under the controls, so a change's effect on the odds
    is visible before anything is rolled against it.
  - Previously the three tables were written out in full and a creature that lacked a limb fell
    through a chain of candidates to something it did have. That left the odds at the mercy of the
    fallback: a wolf and a dragon read the same rows, and the wolf's missing wings quietly became
    extra legs.
- **The standalone resolver wears the resolution dialog's theme.** Both windows now carry a shared
  `ce-window` class holding the dark-panel/amber scheme, so the resolver no longer opens as a
  system-parchment form that hands off to a dark dialog. Its submit button moved out of core's
  generic footer part into the body for the same reason — the footer's button is core-styled.
- **A resolution with no attack card behind it now posts a card of its own.** Previously `record()`
  returned early when there was no source message, so a hand-driven resolution's result existed
  nowhere but the GM's dialog — which closes on Confirm. It now creates a card carrying the two
  facts the attack card would have supplied (source → target, and the Critical Power grade and
  roll), and the effect goes onto it through the same `critResult` flag an attack card gets. The
  existing render hook draws it, so the result block looks identical on both, and the Apply-buff
  button attaches by the same route.
- **The resolver has a source, and its rolls go out as roll requests again.** The actor picked in
  the quick action's prompt is now the *source* — whose player is asked to roll the hit location
  and the Critical Power — rather than the target. It previously became the target, which left the
  resolution with no attacker at all: `attackerToken` was always null, so every roll fell through
  to the GM-side fallback and no request card was ever posted. The source is a dropdown beside the
  target and can be set to **— none —**, which keeps the old local-roll behaviour deliberately.
  Several picked actors resolve to the first; a resolution has one source.
- **Source and target size are named dropdowns**, not numeric spinners: Fine through Colossal,
  labelled from `pf1.config.actorSizes`. Both are filled in from the chosen tokens rather than
  defaulting to Medium, and re-derived when the token on that side changes.
- **The resolver no longer asks for damage type or an anatomy override.** The resolution dialog
  asks for both at its Location stage regardless, so the resolver was collecting answers that a
  second question could then contradict. Both are still honoured when passed to `openResolver()`
  as a seed. A resolution opened from the resolver therefore starts with damage type unset and
  must have one chosen at the Location stage.
- **The resolver opens the resolution at Location, not Trigger.** The Trigger stage chooses between
  critical damage and a critical effect; a hand-driven resolution has no attack card behind it, so
  there is no suppressed critical damage to release and two of its three answers were dead. The
  stage is dropped from the rail entirely rather than shown as completed — it was never asked.
  `startCritResolution` takes a `choice` for this.
- **No more `—` for an attacker that doesn't exist.** A resolution with genuinely no attacker —
  the resolver with its source set to none, or `openResolver()` from the console — drops the whole
  `attacker →` clause from the dialog's header and title instead of naming a placeholder. Both
  sides' names now route through pf1-token-randomizer, which previously only the target's did.
- **Size and weapon class swapped sides in the Critical Power roll.** The weapon class
  (light / two-handed / secondary or sole natural) now shifts the **grade tier** instead of giving
  a flat ±1, and the attacker/target size difference now gives a **flat ±1 per size category**
  instead of shifting the tier. The arithmetic of each is unchanged — only which half of the result
  it lands in.
  This is not a reshuffle: a tier changes the die pool, so it alters the spread as well as the
  average (1d4 → 2d8) and is bounded by the five-rung ladder, while a flat modifier is unbounded
  and moves only the total. A large size gap therefore scales without limit rather than saturating
  at Devastating, and light-vs-two-handed changes how swingy the roll is rather than nudging it.
  `flatModifierFor` → `weaponClassTiers`, `sizeShift` → `sizeModifier`, and the `breakdown` keys
  `size` / `weapon` → `sizeFlat` / `weaponTiers`. A GM grade override now leaves the size modifier
  standing, since naming a grade says nothing about how much bigger the attacker was.
- **Fumble tables are d20, not d12, and there are six of them.** `bow` splits into `bows` and
  `crossbows` (PF1 has both as weapon groups, and they fail differently), and `unarmed` separates
  from `natural`. Each table is 20 rows, one outcome per face, up from 12 faces covered by ranges.
  `inferAttackType` pre-selects the new types from the weapon; unarmed is a soft guess (PF1 has no
  first-class unarmed marker) and falls through to melee, which the dialog dropdown corrects.

### Removed
- **Left and right hit locations.** A location is a body part now, not a left or right one — which
  side of the creature it was is the GM's call in the moment it matters. Enumerating it doubled
  every location table to say something no effect content ever keyed off. `locationFor` no longer
  returns `side`, `fellBack` or `from`, and results read "Leg" where they used to read "Left Leg".
  Records already written onto old cards are stored strings and are unaffected.
- **Per-damage-type content worksheets** and their two tools (`scaffold-worksheets.mjs`,
  `worksheets-to-catalog.mjs`), superseded by the tagged pool. `tools/effect-tables-to-json.mjs`
  goes too: it regenerated `effects.json` from the shipped RollTables, which now silently
  clobbers generated output. `content/mortal.md` stays — the 13+ addendum is authored per body
  part and is not pool-shaped.

### Changed
- Fumble confirmation moved here from astora-mod (`scripts/critical-fumble.mjs`), which no
  longer carries it. Behaviour is unchanged.
