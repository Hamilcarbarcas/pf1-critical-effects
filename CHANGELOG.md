# Changelog

## Unreleased

### Added
- **Anatomy is a catalog dimension** (`effects.json` v3). Effect tables are now keyed
  `damageType → anatomy → location` rather than `damageType → location`: a beast's foreleg and a
  humanoid's weapon hand no longer share twelve rows. The grid is 10 damage types × 13 anatomy ×
  location pairs × 12 rows.
- **Mortal effects.** A `mortal[anatomy][location]` entry, read *on top of* row 12 at the 13+
  clamp and damage-type agnostic. Optional — absent, 13+ stays "row 12 plus the Fort save".
- **Content worksheets** (`content/`). Effect content is authored as markdown — one file per
  damage type plus `mortal.md` — and folded into the catalog by
  `tools/worksheets-to-catalog.mjs`, behind a per-table `**Status:** approved` review gate.
  `tools/scaffold-worksheets.mjs` is its inverse; the round trip is byte-identical. Format and
  rules: `content/README.md`.
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
  (pre-selected from the weapon) and posts a targeted `1d12` roll request showing the whole
  table; the **player** clicks to roll it. Whenever that roll lands, the drawn effect is written
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
- Fumble confirmation moved here from astora-mod (`scripts/critical-fumble.mjs`), which no
  longer carries it. Behaviour is unchanged.
