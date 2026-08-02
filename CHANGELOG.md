# Changelog

## Unreleased

### Added
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
- **Fumble path, end to end.** A natural 1 forces a confirmation roll; a confirmed fumble puts a
  GM-only **Resolve Fumble** button on the attack card. The button picks an attack type
  (pre-selected from the weapon), posts a targeted `1d12` roll request showing the whole table
  with the rolled row highlighted, and writes the drawn effect back onto the attack card as a
  journal link.
- **Fumble tables** transcribed from the shipped RollTables into `data/fumbles.json` by
  `tools/tables-to-json.mjs`. The three tables each carried their own duplicate copy of every
  journal; these collapse into 19 distinct effects that the tables reference by id.
- **Draft `natural` fumble table**, hand-authored — no such RollTable ships in the pack. It
  reuses the entries that do not presuppose a held weapon. See `_naturalNote` in
  `data/fumbles.json`.

### Changed
- Fumble confirmation moved here from astora-mod (`scripts/critical-fumble.mjs`), which no
  longer carries it. Behaviour is unchanged.
