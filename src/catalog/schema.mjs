/* Catalog validation and dev-time lint (DESIGN.md §3).
 *
 * Two jobs, deliberately kept apart:
 *
 *   validate*()  — structural. Refuses data the engine cannot use at all. Pure and synchronous.
 *   lint()       — see catalog.mjs. Content-quality reporting: unknown condition ids, table
 *                  coverage, mortal coverage. Everything it reports is a warning; none of it
 *                  stops a load.
 *
 * The content strategy is **self-contained** (v5): an entry with `id` and `name` is COMPLETE, and
 * `text`, `note`, `buff` and `conditions` are all optional and additive. Nothing in the engine may
 * assume any of them exist. There is no `journal` — prose is ours, stored here, rendered by us.
 *
 * This module is imported by the Node build tools as well as by the running module, so it must
 * stay free of every Foundry and PF1 global. That is why CONDITION_IDS is a written-out list
 * rather than a read of `pf1.registry.conditions`; catalog.mjs cross-checks the two at runtime.
 */

/**
 * The four severity bands, as **authoring** structure only.
 *
 * The engine has no severity layer: the Critical Power total indexes straight into the twelve
 * rows (see `effectAt`). But the twelve rows are *written* three at a time — a table is four
 * bands of three, mildest band first — and that grouping is what the content worksheets in
 * `content/` are organised by, what the fold-in tool checks, and what the GM's override
 * dropdown groups by. Keeping it here means the ladder is defined once rather than in the
 * tool, the worksheet template, and the dialog separately.
 *
 * `mortal` is not one of these. It sits past row 12 (the 13+ clamp) and is authored once per cell
 * of its own grid rather than as a row of any table.
 */
export const SEVERITY_BANDS = [
  { key: "minor", label: "Minor", rows: [1, 3] },
  { key: "moderate", label: "Moderate", rows: [4, 6] },
  { key: "severe", label: "Severe", rows: [7, 9] },
  { key: "grave", label: "Grave", rows: [10, 12] },
];

/** Which band a 1-12 row sits in. Rows outside that span have no band — 13+ is mortal. */
export const bandForRow = (row) =>
  SEVERITY_BANDS.find(({ rows: [min, max] }) => row >= min && row <= max) ?? null;

/**
 * Which locations each anatomy can actually be hit in — the effect grid's real shape.
 *
 * Derived from what the three d20 location layouts can produce, and the reason the grid is 13
 * anatomy × location pairs rather than 3 × 7 = 21: a humanoid has no tail to shatter and an
 * ooze has no arm to break, so those tables are not merely unwritten, they are meaningless.
 * The validator uses this to tell "still to author" apart from "does not exist", which is what
 * keeps the content progress metric honest.
 *
 * Kept in step with anatomy.json by `validateAnatomy`, which reports any slot a location table
 * can produce that is missing from here.
 */
export const ANATOMY_LOCATIONS = {
  humanoid: ["arm", "leg", "torso", "head"],
  beast: ["arm", "leg", "torso", "head", "tail", "wing"],
  aberrant: ["appendage", "torso", "head"],
};

/**
 * Every (anatomy, location) pair a damage type's tables cover, in a stable order.
 *
 * Omit `damageType` for the **localized** shape — the 13 body-part pairs, which is what `mortal`
 * and the location layer are built on. Pass one and a non-localized type answers with its three
 * `general` pairs instead (see `LOCALIZED_DAMAGE_TYPES`).
 */
export const anatomyLocationPairs = (damageType = null) =>
  Object.entries(ANATOMY_LOCATIONS).flatMap(([anatomy, locations]) =>
    (damageType === null ? locations : slotsFor(damageType, anatomy)).map((location) => ({ anatomy, location }))
  );

/**
 * Damage types the catalog keeps tables for — **PF1's own registry ids**, not abbreviations.
 *
 * One vocabulary, running from an action's damage part through the catalog to the dialog's
 * dropdown. The earlier `b`/`p`/`s` had no source outside this module: PF1 calls them
 * `bludgeoning`/`piercing`/`slashing` (`pf1.registry.damageTypes`), so code that read an attack's
 * damage type and compared it against a letter never matched, and the dropdown was never
 * pre-filled.
 *
 * Narrower than PF1's registry on purpose: `untyped`, `precision`, `nonlethal` and `areaOfEffect`
 * describe how damage is dealt rather than what it does to a body, and there is no table for them.
 * `force` is in, and follows the energy types in every respect — no hit location, its own mortal.
 */
export const DAMAGE_TYPES = [
  "bludgeoning",
  "piercing",
  "slashing",
  "fire",
  "cold",
  "electric",
  "acid",
  "sonic",
  "force",
  "positive",
  "negative",
];

/** Display names, for the pickers. PF1's own labels, except where its are terser than useful. */
export const DAMAGE_TYPE_LABELS = {
  bludgeoning: "Bludgeoning",
  piercing: "Piercing",
  slashing: "Slashing",
  fire: "Fire",
  cold: "Cold",
  electric: "Electricity",
  acid: "Acid",
  sonic: "Sonic",
  force: "Force",
  positive: "Positive Energy",
  negative: "Negative Energy",
};

/** The list a `<select>` wants. */
export const damageTypeOptions = () =>
  DAMAGE_TYPES.map((key) => ({ key, label: DAMAGE_TYPE_LABELS[key] ?? key }));

/**
 * The damage types whose effects depend on WHERE they landed — the three weapon types.
 *
 * Everything else (fire, cold, electric, acid, sonic, force, positive, negative) is
 * **non-localized**: it arrives as an area or a wash rather than as a blow, so there is no body part
 * to roll for and no called shot to make. Those types still vary by anatomy — a fire critical does
 * something different to a humanoid than to an ooze — so the grid keeps its anatomy axis and drops
 * only the location one, collapsing to a single `general` table per anatomy.
 *
 * This is a **rules** distinction, not a data-shape one: keeping it named here rather than
 * inferring it from which tables happen to exist is what stops "this type has no arm table" and
 * "this type has no arms" from being the same statement.
 */
export const LOCALIZED_DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing"];

/** Does this damage type roll for a hit location? Unknown and absent types read as non-localized. */
export const isLocalized = (damageType) => LOCALIZED_DAMAGE_TYPES.includes(damageType);

/**
 * The one pseudo-location a non-localized damage type's tables live under.
 *
 * Deliberately NOT in `LOCATIONS` or `SLOTS`: no location table can ever produce it, and nothing
 * in `resolve/location.mjs` knows it exists. It is a table key, not a body part — which is what
 * keeps the catalog's shape uniform (`tables[dt][anatomy][slot]`) without pretending a fire
 * critical hit someone's leg.
 */
export const GENERAL_SLOT = "general";

/** Which slots a damage type's tables cover for one anatomy: the body parts, or just `general`. */
export const slotsFor = (damageType, anatomy) =>
  isLocalized(damageType) ? (ANATOMY_LOCATIONS[anatomy] ?? []) : [GENERAL_SLOT];

/**
 * The table key a lookup should use.
 *
 * The single normalization point for the whole engine: a caller may hand over whatever location it
 * has — a rolled one, a stale one, or none — and a non-localized damage type answers `general`
 * regardless. That is why `effectFor("fire", "beast", "wing", 7)` is not a bug, it is a lookup that
 * quietly ignores an axis that does not apply.
 */
export const slotFor = (damageType, location) => (isLocalized(damageType) ? (location ?? null) : GENERAL_SLOT);

/** Every (damage type, anatomy, location) cell of the effect grid — 63 tables, 756 rows. */
export const gridCells = () =>
  DAMAGE_TYPES.flatMap((damageType) =>
    anatomyLocationPairs(damageType).map((pair) => ({ damageType, ...pair }))
  );

/** The non-localized damage types, in DAMAGE_TYPES order. Each keeps one mortal row. */
export const generalDamageTypes = () => DAMAGE_TYPES.filter((dt) => !isLocalized(dt));

/**
 * Every cell `mortal` covers, and the two halves are keyed by **different axes** — which is the
 * whole of what makes mortal awkward and is why it is enumerated here rather than derived at use.
 *
 * | | Keyed by | Agnostic to | Count |
 * |---|---|---|---|
 * | `part` | damage type × anatomy × location | — | 39 |
 * | `damageType` | damage type | anatomy | 8 |
 *
 * > **Revised in phase 12.** `part` was previously keyed by anatomy × location alone — 13 cells,
 * > damage-type agnostic — on the reasoning that "past row 12 a torn-off arm is a torn-off arm
 * > whether a sword or a mace did it". Writing the content disproved it. A mace, a spear and an
 * > axe end a head three different ways (**caved cranium**, **pierced brain**, **decapitated**) and
 * > collapsing those into one row throws away the distinction the 13+ result exists to make. So the
 * > weapon half keeps the damage-type axis and every cell is written per damage type.
 *
 * The asymmetry that remains is real: **anatomy** is what drops out of the non-localized half. A
 * mortal fire result is the same story for a humanoid and a beast — burned to ash is burned to ash
 * — while burned to ash and blasted apart are plainly not one result, so the damage type is the
 * whole of what distinguishes that side.
 *
 * @returns {{ kind: "part"|"damageType", key: string, anatomy?: string, location?: string,
 *             damageType?: string }[]}
 */
export const mortalCells = () => [
  ...LOCALIZED_DAMAGE_TYPES.flatMap((damageType) =>
    anatomyLocationPairs().map(({ anatomy, location }) => ({
      kind: "part",
      key: `${damageType}/${anatomy}/${location}`,
      damageType,
      anatomy,
      location,
    }))
  ),
  ...generalDamageTypes().map((damageType) => ({ kind: "damageType", key: damageType, damageType })),
];

/**
 * The six fumble tables, keyed by how the attack was delivered.
 *
 * `bows` and `crossbows` are separate because PF1's own weapon groups are (`pf1.config.weaponGroups`)
 * and because they fail differently — a bowstring snaps, a crossbow's mechanism jams. `unarmed` and
 * `natural` are likewise distinct: a natural attack is a claw or a bite, an unarmed strike is a
 * person's fist, and "you break a finger" only reads for one of them.
 */
export const FUMBLE_TABLES = ["melee", "thrown", "bows", "crossbows", "unarmed", "natural"];

/**
 * Rows in a fumble table. A d20, unlike the effect tables' d12.
 *
 * The two ladders are not the same scale and are not meant to be: an effect table's twelve rows
 * run from a bruise to a mortal wound, while a fumble table's twenty are **unordered peers** — all
 * equally likely, none worse than another, the die picking flavour rather than severity. Fumbles
 * never threaten mortal peril (concept doc §2), so there is nothing for a severity ladder to
 * measure and fumble pool entries carry no rank.
 */
export const FUMBLE_ROWS = 20;

export const ANATOMIES = ["humanoid", "beast", "aberrant"];

/**
 * Body parts a d20 location table row may name (§5.3) — every location the effect grid's localized
 * half is keyed by. `appendage` is what the aberrant table produces and is a location in its own
 * right, not a synonym for `arm`.
 *
 * `GENERAL_SLOT` is deliberately absent: it is a table key for the damage types that never roll
 * here at all.
 */
export const SLOTS = ["head", "torso", "arm", "leg", "wing", "tail", "appendage"];

// --- conditions (§3, §6) ----------------------------------------------------

/**
 * The PF1 condition ids an entry may inflict — `pf1.registry.conditions` keys, written out.
 *
 * Written out rather than read from the registry because this module is imported by the Node
 * build tools, which have no `pf1` global. `lint()` cross-checks this list against the live
 * registry, so a system update that renames a condition is reported rather than discovered when
 * a critical silently fails to apply.
 *
 * PF1's registry also carries the movement modes below. Those wear a condition's clothes —
 * nothing inflicts them on a victim — so they are deliberately out. `dead` is in: the mortal rows
 * genuinely reach it.
 */
export const CONDITION_IDS = [
  "bleed", "blind", "confused", "cowering", "dazed", "dazzled", "dead", "deaf", "disabled",
  "dying", "entangled", "exhausted", "fatigued", "flatFooted", "frightened", "grappled",
  "helpless", "incorporeal", "invisible", "nauseated", "panicked", "paralyzed", "petrified",
  "pinned", "prone", "shaken", "sickened", "sleep", "squeezing", "stable", "staggered",
  "stunned", "unconscious",
];

/**
 * Registry entries that are movement modes rather than conditions, listed so `lint()` can tell
 * "PF1 added a condition we don't know about" from "PF1 has always had these and we don't want
 * them". Without this the reverse check would report four permanent false positives, which is the
 * fastest way to teach someone to ignore a report.
 */
export const MOVEMENT_CONDITIONS = ["burrow", "fly", "hover", "swim"];

/**
 * How long a condition lasts, in seconds per unit.
 *
 * PF1 stores a condition's life as `duration.seconds` on its Active Effect and expires it against
 * world time (`ActorPF#expireActiveEffects`), so every unit an author writes is converted to
 * seconds at apply time. `turn` and `round` are both 6 seconds and are NOT redundant: which one is
 * written decides the natural `end` timing, and "until the end of your next turn" is a turn, not a
 * round.
 */
export const CONDITION_DURATION_UNITS = {
  turn: 6,
  round: 6,
  minute: 60,
  hour: 3600,
  day: 86400,
};

/**
 * When exactly a duration that has run out actually ends — PF1's `durationEndEvents`, declared on
 * its base Active Effect data model as `system.end`.
 *
 * Optional, and `turnStart` is what PF1 assumes when it is absent. `turnEnd` is the one worth
 * writing: it is the difference between "stunned 1 round" and "flat-footed until the end of your
 * next turn", which are the same six seconds and not the same effect.
 */
export const CONDITION_END_EVENTS = ["turnStart", "initiative", "turnEnd"];

/** The one condition that carries a payload beyond its own name. See `validateBleed`. */
export const BLEED_CONDITION = "bleed";

/**
 * Ability scores a bleed may drain or damage instead of hit points. pf1-bleed-effects' `kind` is
 * `"hp"` or `"<ability>.<damage|drain>"`; we validate the halves rather than the joined string so
 * the error names which half is wrong.
 */
export const BLEED_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const BLEED_MODES = ["damage", "drain"];

/** The `kind` string pf1-bleed-effects' API takes, built from a validated bleed block. */
export const bleedKind = ({ ability = null, mode = "damage" } = {}) =>
  ability ? `${ability}.${mode}` : "hp";

const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * A duration `value` is a number of units or a dice formula rolled when the condition lands.
 *
 * Deliberately permissive about the formula: this module cannot evaluate one (no Foundry `Roll`
 * here), so it checks the shape and leaves "is that a legal expression" to the roll itself. A
 * malformed formula degrades to the fallback in `resolve/conditions.mjs`, never to a thrown error
 * in the middle of applying a critical.
 */
const isDurationValue = (v) =>
  (typeof v === "number" && Number.isFinite(v) && v > 0) || /^[\d\s+\-*/dD()]+$/.test(String(v ?? "").trim());

/**
 * Structural check of one condition descriptor. Shared by every catalog that can carry one —
 * effects, fumbles and lethal all inflict conditions and there is no reason for three dialects.
 *
 * @param {object} condition
 * @param {string} where  message prefix naming the entry
 * @returns {string[]} problems; empty means usable
 */
export function validateCondition(condition, where) {
  const problems = [];

  if (!isPlainObject(condition)) return [`${where}: condition must be an object`];
  if (!isNonEmptyString(condition.id)) return [`${where}: condition is missing \`id\``];
  if (!CONDITION_IDS.includes(condition.id)) problems.push(`${where}: unknown condition "${condition.id}"`);

  const { duration } = condition;
  if (duration != null) {
    if (!isPlainObject(duration)) {
      problems.push(`${where}: \`duration\` must be an object when present`);
    } else {
      if (!isDurationValue(duration.value)) {
        problems.push(`${where}: \`duration.value\` must be a positive number or a dice formula`);
      }
      if (!(duration.units in CONDITION_DURATION_UNITS)) {
        problems.push(
          `${where}: \`duration.units\` must be one of ${Object.keys(CONDITION_DURATION_UNITS).join(", ")}`
        );
      }
      if (duration.end != null && !CONDITION_END_EVENTS.includes(duration.end)) {
        problems.push(`${where}: \`duration.end\` must be one of ${CONDITION_END_EVENTS.join(", ")}`);
      }
    }
  }

  /* The bleed payload is pf1-bleed-effects' configuration, and it is OPTIONAL on purpose: a bleed
   * condition with no block is the vanilla PF1 marker — a status icon and no damage — which is
   * exactly what a world without that module gets anyway. Absence is the documented default, not
   * an omission to warn about. */
  if (condition.bleed != null) {
    if (condition.id !== BLEED_CONDITION) {
      problems.push(`${where}: \`bleed\` means nothing on the "${condition.id}" condition`);
    }
    if (!isPlainObject(condition.bleed)) {
      problems.push(`${where}: \`bleed\` must be an object when present`);
    } else {
      const { formula, ability, mode, deep } = condition.bleed;
      if (!isNonEmptyString(formula)) problems.push(`${where}: \`bleed.formula\` is required`);
      if (ability != null && !BLEED_ABILITIES.includes(ability)) {
        problems.push(`${where}: \`bleed.ability\` must be one of ${BLEED_ABILITIES.join(", ")}`);
      }
      if (mode != null && !BLEED_MODES.includes(mode)) {
        problems.push(`${where}: \`bleed.mode\` must be one of ${BLEED_MODES.join(", ")}`);
      }
      if (mode != null && ability == null) {
        problems.push(`${where}: \`bleed.mode\` means nothing without \`bleed.ability\` — hit point bleed has no mode`);
      }
      if (deep != null && (!Number.isInteger(deep) || deep <= 0)) {
        problems.push(`${where}: \`bleed.deep\` must be a positive integer of hit points`);
      }
    }
  }

  return problems;
}

// --- damage (§6) ------------------------------------------------------------

/**
 * Damage types a `damage` part may be authored as.
 *
 * Wider than `DAMAGE_TYPES`, which is the list the *tables* are keyed by. A critical effect deals
 * damage as its own instance and is under no obligation to deal it as one of the eleven types the
 * grid has tables for — `untyped` and `nonlethal` are both things a wound plausibly does, and
 * neither is ever going to have a twelve-row table of its own.
 *
 * Unknown types are reported and **kept**, not dropped. This module cannot see
 * `pf1.registry.damageTypes` (it is imported by the Node tools), so an unrecognised id here is at
 * least as likely to be a type PF1 knows and this list does not; PF1 treats one it genuinely does
 * not know as untyped, which is a far better outcome than silently losing the damage.
 */
export const DAMAGE_PART_TYPES = [...DAMAGE_TYPES, "untyped", "precision", "nonlethal"];

/**
 * Structural check of one `{ formula, type }` damage part.
 *
 * The formula is checked for presence only, not for parseability: there is no Foundry `Roll` here,
 * and a formula that will not evaluate degrades to no damage at roll time (`resolve/damage.mjs`)
 * rather than throwing in the middle of a resolution.
 */
export function validateDamagePart(part, where) {
  if (!isPlainObject(part)) return [`${where}: damage part must be an object`];

  const problems = [];
  if (!isNonEmptyString(part.formula)) problems.push(`${where}: damage part is missing \`formula\``);
  if (!isNonEmptyString(part.type)) problems.push(`${where}: damage part is missing \`type\``);
  else if (!DAMAGE_PART_TYPES.includes(part.type)) {
    problems.push(`${where}: unrecognised damage type "${part.type}"; it will be rolled as authored`);
  }
  return problems;
}

/** Whether a part is usable at all — the test `validateEffects` drops on. An unknown *type* is not. */
const damagePartIsUsable = (part) => isPlainObject(part) && isNonEmptyString(part.formula) && isNonEmptyString(part.type);

/** Structural check of a whole `damage` array. Absent and empty are both fine. */
export function validateDamage(damage, where) {
  if (damage == null) return [];
  if (!Array.isArray(damage)) return [`${where}: \`damage\` must be an array when present`];
  return damage.flatMap((part, i) => validateDamagePart(part, `${where} damage part #${i}`));
}

// --- saves and the failed branch (§6) ---------------------------------------

/**
 * Structural check of `save` — a **DC multiplier**, not a save descriptor.
 *
 * Every save in this catalog is a Fortitude save against the attack's own damage (§6), so there is
 * no type to author and no DC to author. `1` is that DC, `2` is the doubled DC most of the 13+ rows
 * call for, and absent is no save at all. The cap is deliberate: a multiplier past 2 is far more
 * likely to be a DC someone typed into the wrong field than a rule.
 */
export function validateSave(save, where) {
  if (save == null) return [];
  if (!Number.isInteger(save) || save < 1 || save > 2) {
    return [`${where}: \`save\` must be 1 (DC) or 2 (doubled DC), or absent for no save`];
  }
  return [];
}

/**
 * Structural check of `onFail` — the failed branch, which is the same three mechanical channels
 * again and is validated by exactly the same rules.
 *
 * A channel it names **replaces** the base one; a channel it omits falls through. Explicit `null`
 * therefore means something different from absent: it clears the base channel for this branch.
 * Neither is checkable here — both are legal shapes — but it is why this cannot simply be a
 * required-fields check.
 */
export function validateOnFail(onFail, where) {
  if (onFail == null) return [];
  if (!isPlainObject(onFail)) return [`${where}: \`onFail\` must be an object when present`];

  const problems = [];
  if (onFail.buff !== undefined && onFail.buff !== null && !isNonEmptyString(onFail.buff)) {
    problems.push(`${where}: \`onFail.buff\` must be a buff name or null`);
  }
  problems.push(...validateConditions(onFail.conditions, `${where} onFail`));
  problems.push(...validateDamage(onFail.damage, `${where} onFail`));

  for (const key of Object.keys(onFail)) {
    if (!["buff", "conditions", "damage"].includes(key)) {
      problems.push(`${where}: \`onFail.${key}\` is not a mechanical channel and will be ignored`);
    }
  }
  return problems;
}

/**
 * The salvage pass that mirrors `validateOnFail`'s reporting: keep every channel that is usable,
 * drop the rows that are not. Same rule the conditions channel has always followed — a bad row
 * costs the entry that row, never the entry.
 */
function keepMechanics(source) {
  if (source == null) return source;
  const kept = { ...source };
  if (Array.isArray(kept.conditions)) {
    kept.conditions = kept.conditions.filter((c) => !validateCondition(c, "").length);
  } else if (kept.conditions != null) {
    kept.conditions = [];
  }
  if (Array.isArray(kept.damage)) {
    kept.damage = kept.damage.filter(damagePartIsUsable);
  } else if (kept.damage != null) {
    kept.damage = [];
  }
  return kept;
}

/** Structural check of an entry's whole `conditions` array. Absent and empty are both fine. */
export function validateConditions(conditions, where) {
  if (conditions == null) return [];
  if (!Array.isArray(conditions)) return [`${where}: \`conditions\` must be an array when present`];

  const problems = [];
  const seen = new Set();
  for (const [i, condition] of conditions.entries()) {
    problems.push(...validateCondition(condition, `${where} condition #${i}`));
    /* Two of the same condition on one entry cannot both take: PF1 keeps ONE Active Effect per
     * condition, so the second application is dropped and its duration lost. That is a content
     * bug — "stunned 1 round and stunned 1d4 rounds" means one of them, and the author has to say
     * which. */
    if (condition?.id) {
      if (seen.has(condition.id)) problems.push(`${where}: applies "${condition.id}" twice; only the first would take`);
      seen.add(condition.id);
    }
  }
  return problems;
}

/**
 * Structural validation of data/effects.json.
 * @returns {{ errors: string[], warnings: string[], entries: object[] }}
 *   `entries` contains only the rows that passed; a bad row is dropped, not fatal.
 */
/** Every effect table is exactly this many rows — see the invariant note in validateEffects. */
export const TABLE_ROWS = 12;

/**
 * Structural validation of data/effects.json.
 *
 * The shape is a flat entry pool plus `tables[damageType][anatomy][location]` — an array of
 * exactly 12 entry ids, indexed by the Critical Power roll, mildest first. Same shape as
 * fumbles.json: entries are shared and a table references them by id, so a repeat costs one id
 * rather than a duplicated row.
 *
 * **Anatomy is a real dimension** (v3), not something location implies. `arm` means a hand that
 * drops a weapon on a humanoid and a foreleg that buckles on a beast, and the two want different
 * twelve rows even though they share a slot name. There is no inheritance between anatomies in the
 * data — every table is written out in full.
 *
 * **Location is a dimension only for the three weapon types** (v4). A non-localized damage type
 * arrives as a wash rather than as a blow, so it keeps the anatomy axis and drops the location one:
 * its tables live under the single `general` slot. The grid is therefore 3 localized types × 13
 * anatomy/location pairs, plus 8 non-localized types × 3 anatomies — 63 tables, 756 rows.
 * `gridCells()` is the definition of it, and `slotsFor()` is the per-cell shape.
 *
 * **12 rows is an invariant, not a convention.** The resolution indexes into the table with a
 * clamped roll and never checks for a hole, so a short table is an error here rather than a
 * surprise at the table. Unwritten content is expressed as `placeholder: true` entries, which
 * keeps the invariant true while `lint()` reports how much is still to author.
 *
 * `mortal` is the 13+ addendum, read on top of row 12 rather than instead of it, and it has **two
 * halves keyed by different axes** (see `mortalCells`):
 * `mortal.byPart[damageType][anatomy][location]` for the weapon types,
 * `mortal.byDamageType[damageType]` for everything else. Optional throughout: an absent entry
 * leaves the 13+ result as "row 12 plus the Fort save", which is what the rules said before any of
 * them were written.
 *
 * **v5 removes `journal` and adds `text` and `conditions`.** Prose is stored here rather than in a
 * compendium journal, and the mechanical half of an entry is now two optional channels rather than
 * one: `buff` for anything that needs changes and a lifecycle, `conditions` for the PF1 statuses a
 * wound imposes directly.
 *
 * **v6 adds `damage`, `save` and `onFail`** (§6). A third mechanical channel — a damage instance of
 * the entry's own, typed, entirely separate from PF1's critical column — and a save layer over all
 * three: `save` is a Fortitude DC *multiplier*, and `onFail` is the same three channels again for
 * the failed branch, overriding the base ones channel by channel. Every v5 entry is a valid v6
 * entry; all three fields are optional and absent means what it has always meant.
 *
 * @returns {{ errors: string[], warnings: string[], entries: object[], tables: object,
 *             mortal: object }}
 */
export function validateEffects(data) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const tables = {};
  const mortal = { byPart: {}, byDamageType: {} };

  const bail = (message) => ({ errors: [...errors, message], warnings, entries, tables, mortal });

  if (!isPlainObject(data)) return bail("effects.json: root is not an object");
  if (data.version !== 6) warnings.push(`effects.json: version is ${data.version}, expected 6`);
  if (!Array.isArray(data.entries)) return bail("effects.json: `entries` is not an array");

  const seen = new Set();

  for (const [i, entry] of data.entries.entries()) {
    const where = `effects.json entry #${i}${entry?.id ? ` (${entry.id})` : ""}`;
    const problems = [];

    if (!isNonEmptyString(entry?.id)) problems.push("missing `id`");
    else if (seen.has(entry.id)) problems.push(`duplicate id "${entry.id}"`);
    if (!isNonEmptyString(entry?.name)) problems.push("missing `name`");

    if (entry?.text != null && typeof entry.text !== "string") problems.push("`text` must be a string when present");
    if (entry?.buff != null && !isNonEmptyString(entry.buff)) problems.push("`buff` must be a buff name when present");
    if (entry?.note != null && typeof entry.note !== "string") problems.push("`note` must be a string when present");
    if (entry?.tags !== undefined && !Array.isArray(entry.tags)) problems.push("`tags` must be an array when present");
    if (entry?.journal != null) problems.push("`journal` was removed in v5 — prose belongs in `text`");

    if (problems.length) {
      errors.push(`${where}: ${problems.join("; ")}`);
      continue;
    }

    /* Every mechanical channel is reported as a WARNING and the bad rows dropped, rather than
     * taking the entry down with them. An entry's name and prose are the part the flow cannot do
     * without; a condition it cannot apply, a damage part it cannot roll or a save it cannot read
     * degrades it to what a text-only entry would have given you, which is the §0 rule — absence
     * degrades an entry, never the engine. */
    const mechanicalProblems = [
      ...validateConditions(entry.conditions, where),
      ...validateDamage(entry.damage, where),
      ...validateSave(entry.save, where),
      ...validateOnFail(entry.onFail, where),
    ];

    /* A save with no failed branch is not malformed, it is pointless: both buttons would offer the
     * same mechanics and the roll would decide nothing. Worth saying out loud, because the likely
     * cause is an `onFail` that was meant to be written and wasn't. */
    if (entry.save != null && entry.onFail == null) {
      warnings.push(`${where}: has a save but no \`onFail\`, so both branches would apply the same thing`);
    }
    // The converse is a real error of the same kind, and reads the other way round: a failed branch
    // nothing can ever reach.
    if (entry.save == null && entry.onFail != null) {
      warnings.push(`${where}: has \`onFail\` but no \`save\`, so the failed branch is unreachable`);
    }

    if (mechanicalProblems.length) {
      warnings.push(...mechanicalProblems);
      const kept = keepMechanics(entry);
      // A `save` that did not validate is dropped outright: there is no partially-usable multiplier,
      // and a save left in at some guessed value would set a DC nobody authored.
      if (validateSave(entry.save, where).length) kept.save = null;
      if (entry.onFail != null) {
        kept.onFail = isPlainObject(entry.onFail) ? keepMechanics(entry.onFail) : null;
      }
      entries.push(kept);
    } else {
      entries.push(entry);
    }

    seen.add(entry.id);
  }

  if (!isPlainObject(data.tables)) return bail("effects.json: `tables` is not an object");

  for (const [damageType, anatomies] of Object.entries(data.tables)) {
    if (damageType.startsWith("_")) continue; // annotation key, not a damage type
    if (!DAMAGE_TYPES.includes(damageType)) warnings.push(`effects.json: unknown damage type "${damageType}"`);
    if (!isPlainObject(anatomies)) {
      errors.push(`effects.json: tables.${damageType} is not an object`);
      continue;
    }

    tables[damageType] = {};
    for (const [anatomy, locations] of Object.entries(anatomies)) {
      if (!ANATOMIES.includes(anatomy)) warnings.push(`effects.json: tables.${damageType}.${anatomy}: unknown anatomy`);
      if (!isPlainObject(locations)) {
        errors.push(`effects.json: tables.${damageType}.${anatomy} is not an object`);
        continue;
      }

      tables[damageType][anatomy] = {};
      for (const [location, ids] of Object.entries(locations)) {
        const where = `effects.json tables.${damageType}.${anatomy}.${location}`;
        /* Harmless but dead: nothing can ever ask for these twelve rows. Two ways to get there —
         * a body part this anatomy does not have, or any body part at all under a damage type
         * that does not roll for one. */
        if (!slotsFor(damageType, anatomy).includes(location)) {
          warnings.push(
            isLocalized(damageType)
              ? `${where}: a ${anatomy} is never hit in the ${location}; this table is unreachable`
              : `${where}: ${damageType} does not roll for a location, so only "${GENERAL_SLOT}" is read; this table is unreachable`
          );
        }

        if (!Array.isArray(ids)) {
          errors.push(`${where}: not an array`);
          continue;
        }
        if (ids.length !== TABLE_ROWS) {
          errors.push(`${where}: has ${ids.length} rows, expected exactly ${TABLE_ROWS}`);
          continue;
        }

        const missing = ids.filter((id) => !seen.has(id));
        if (missing.length) {
          errors.push(`${where}: references unknown entries ${[...new Set(missing)].join(", ")}`);
          continue;
        }

        tables[damageType][anatomy][location] = ids;
      }
    }
  }

  /* Mortal: optional entry ids, in two halves keyed by different axes (see mortalCells). Missing is
   * fine and silent — the 13+ clamp degrades to "row 12 plus the save", which is the rule as
   * written. A mortal pointing at an entry that does not exist is NOT fine, because the card would
   * render a blank addendum on the one result that kills someone. */
  const readMortalId = (id, where) => {
    if (id == null) return null;
    if (!isNonEmptyString(id)) { errors.push(`${where}: must be an entry id string`); return null; }
    if (!seen.has(id)) { errors.push(`${where}: references unknown entry "${id}"`); return null; }
    return id;
  };

  if (data.mortal != null && !isPlainObject(data.mortal)) {
    errors.push("effects.json: `mortal` is not an object");
  } else {
    const byPart = data.mortal?.byPart;
    if (byPart != null && !isPlainObject(byPart)) {
      errors.push("effects.json: `mortal.byPart` is not an object");
    } else {
      /* Three levels since v5: damage type, then anatomy, then location. The damage-type level is
       * the one that was added — see mortalCells for why a mace and an axe do not share a head. */
      for (const [damageType, anatomies] of Object.entries(byPart ?? {})) {
        if (damageType.startsWith("_")) continue;
        if (!DAMAGE_TYPES.includes(damageType)) {
          warnings.push(`effects.json: mortal.byPart.${damageType}: unknown damage type`);
        } else if (!isLocalized(damageType)) {
          warnings.push(
            `effects.json: mortal.byPart.${damageType}: ${damageType} rolls no location, so its mortal comes from mortal.byDamageType; this branch is unreachable`
          );
        }
        if (!isPlainObject(anatomies)) {
          errors.push(`effects.json: mortal.byPart.${damageType} is not an object`);
          continue;
        }

        mortal.byPart[damageType] = {};
        for (const [anatomy, locations] of Object.entries(anatomies)) {
          if (!ANATOMIES.includes(anatomy)) warnings.push(`effects.json: mortal.byPart.${damageType}.${anatomy}: unknown anatomy`);
          if (!isPlainObject(locations)) {
            errors.push(`effects.json: mortal.byPart.${damageType}.${anatomy} is not an object`);
            continue;
          }

          mortal.byPart[damageType][anatomy] = {};
          for (const [location, id] of Object.entries(locations)) {
            const where = `effects.json mortal.byPart.${damageType}.${anatomy}.${location}`;
            /* The half that is keyed by body part is the LOCALIZED half. `general` here would be a
             * mortal nothing can reach: the non-localized types read the other map entirely. */
            if (location === GENERAL_SLOT) {
              warnings.push(`${where}: non-localized damage reads mortal.byDamageType, so this entry is unreachable`);
            }
            const entryId = readMortalId(id, where);
            if (entryId) mortal.byPart[damageType][anatomy][location] = entryId;
          }
        }
      }
    }

    const byDamageType = data.mortal?.byDamageType;
    if (byDamageType != null && !isPlainObject(byDamageType)) {
      errors.push("effects.json: `mortal.byDamageType` is not an object");
    } else {
      for (const [damageType, id] of Object.entries(byDamageType ?? {})) {
        if (damageType.startsWith("_")) continue;
        const where = `effects.json mortal.byDamageType.${damageType}`;
        if (!DAMAGE_TYPES.includes(damageType)) warnings.push(`${where}: unknown damage type`);
        else if (isLocalized(damageType)) {
          warnings.push(`${where}: ${damageType} rolls a location, so its mortal comes from mortal.byPart; this entry is unreachable`);
        }
        const entryId = readMortalId(id, where);
        if (entryId) mortal.byDamageType[damageType] = entryId;
      }
    }
  }

  return { errors, warnings, entries, tables, mortal };
}

/**
 * Structural validation of data/fumbles.json.
 * @returns {{ errors: string[], warnings: string[], tables: object, entries: object[] }}
 */
export function validateFumbles(data) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const tables = {};

  if (!isPlainObject(data)) return { errors: ["fumbles.json: root is not an object"], warnings, tables, entries };
  if (data.version !== 4) warnings.push(`fumbles.json: version is ${data.version}, expected 4`);
  if (!Array.isArray(data.entries)) return { errors: ["fumbles.json: `entries` is not an array"], warnings, tables, entries };
  if (!isPlainObject(data.tables)) return { errors: ["fumbles.json: `tables` is not an object"], warnings, tables, entries };

  const byId = new Map();
  for (const [i, entry] of data.entries.entries()) {
    const where = `fumbles.json entry #${i}${entry?.id ? ` (${entry.id})` : ""}`;
    if (!isNonEmptyString(entry?.id) || !isNonEmptyString(entry?.name)) {
      errors.push(`${where}: requires \`id\` and \`name\``);
      continue;
    }
    if (byId.has(entry.id)) { errors.push(`fumbles.json: duplicate entry id "${entry.id}"`); continue; }
    if (entry.journal != null) warnings.push(`${where}: \`journal\` was removed in v3 — prose belongs in \`text\``);

    /* Same treatment as effects, and the same three channels: a fumble can inflict conditions, deal
     * damage and turn on a save exactly as a critical can (§7.6). A bad row is a warning and is
     * dropped, never a reason to lose the row the d20 has to land on. */
    let usable = entry;
    const mechanicalProblems = [
      ...validateConditions(entry.conditions, where),
      ...validateDamage(entry.damage, where),
      ...validateSave(entry.save, where),
      ...validateOnFail(entry.onFail, where),
    ];
    if (mechanicalProblems.length) {
      warnings.push(...mechanicalProblems);
      usable = keepMechanics(entry);
      if (validateSave(entry.save, where).length) usable.save = null;
      if (entry.onFail != null) {
        usable.onFail = isPlainObject(entry.onFail) ? keepMechanics(entry.onFail) : null;
      }
    }

    byId.set(usable.id, usable);
    entries.push(usable);
  }

  for (const [key, rows] of Object.entries(data.tables)) {
    if (key.startsWith("_")) continue; // annotation key, not a table
    if (!FUMBLE_TABLES.includes(key)) warnings.push(`fumbles.json: unknown table "${key}"`);
    if (!Array.isArray(rows)) { errors.push(`fumbles.json: table "${key}" is not an array`); continue; }

    const sorted = [...rows].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
    let expected = 1;
    let ok = true;

    for (const row of sorted) {
      const [min, max] = row?.range ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        errors.push(`fumbles.json: table "${key}" has a row with an invalid \`range\``);
        ok = false;
        continue;
      }
      if (!byId.has(row.id)) {
        errors.push(`fumbles.json: table "${key}" row ${min}-${max} references unknown entry "${row.id}"`);
        ok = false;
      }
      // A hole here means a d12 roll that resolves to nothing at the table.
      if (min !== expected) warnings.push(`fumbles.json: table "${key}" expected coverage to resume at ${expected}, found ${min}`);
      expected = max + 1;
    }

    if (expected !== FUMBLE_ROWS + 1) {
      warnings.push(`fumbles.json: table "${key}" covers 1-${expected - 1}, expected 1-${FUMBLE_ROWS}`);
    }
    if (ok) tables[key] = sorted;
  }

  // Absent, not merely rejected — a table that failed validation has already been reported and
  // saying "no melee table" about one that is plainly there just sends you looking in the wrong place.
  for (const key of FUMBLE_TABLES) {
    if (!(key in data.tables)) warnings.push(`fumbles.json: no "${key}" table`);
  }

  return { errors, warnings, tables, entries };
}

/**
 * Structural check of data/lethal.json (§7.4).
 *
 * Lethal entries are flavour for a death that has already happened — no rank, no location — so
 * there is very little to be wrong. An empty damage type is reported but is not a defect: the
 * content track fills these unevenly.
 *
 * They may still carry `conditions`, which is not as odd as it sounds: `dead` is a PF1 condition,
 * and a lethal draw is exactly the moment to set it.
 *
 * @returns {{ problems: string[], entries: object[] }}
 */
export function validateLethal(data) {
  const problems = [];
  const entries = [];

  if (!isPlainObject(data)) return { problems: ["lethal.json: root is not an object"], entries };
  if (data.version !== 2) problems.push(`lethal.json: version is ${data.version}, expected 2`);
  if (!Array.isArray(data.entries)) return { problems: [...problems, "lethal.json: `entries` is not an array"], entries };

  const seen = new Set();
  for (const [i, entry] of data.entries.entries()) {
    const where = `lethal.json entry #${i}${entry?.id ? ` (${entry.id})` : ""}`;

    if (!isNonEmptyString(entry?.id) || !isNonEmptyString(entry?.name)) {
      problems.push(`${where}: requires \`id\` and \`name\``);
      continue;
    }
    if (seen.has(entry.id)) { problems.push(`${where}: duplicate id`); continue; }
    if (!Array.isArray(entry.damageTypes) || entry.damageTypes.length === 0) {
      problems.push(`${where}: \`damageTypes\` must be a non-empty array`);
      continue;
    }
    for (const dt of entry.damageTypes) {
      if (!DAMAGE_TYPES.includes(dt)) problems.push(`${where}: unknown damage type "${dt}"`);
    }
    if (entry.journal != null) problems.push(`${where}: \`journal\` was removed in v2 — prose belongs in \`text\``);
    problems.push(...validateConditions(entry.conditions, where));

    seen.add(entry.id);
    entries.push(entry);
  }

  // A damage type with no entries is NOT reported here. It is a content gap, not a structural
  // fault, and the content track fills these unevenly — reporting it on every load would print a
  // permanent "issue" that no amount of correct code can clear. `lint()` covers it instead.

  return { problems, entries };
}

/**
 * Structural check of data/anatomy.json.
 *
 * Returns a flat list of problems rather than the errors/warnings split the other two use: a
 * broken location table has no partial-credit reading — either the d20 resolves or it doesn't —
 * so there is nothing here to salvage row by row.
 *
 * Since v2 only humanoid is a written table; beast and aberrant are generated from the creature's
 * own layout (resolve/location.mjs). So this checks two different things: the humanoid table row
 * by row, and the PARAMETERS the generator works from — the bands, the category order, and the
 * appendage cap — because a bad band leaves a hole in every generated table at once.
 *
 * @returns {string[]}
 */
export function validateAnatomy(data) {
  const problems = [];

  if (!isPlainObject(data)) return ["anatomy.json: root is not an object"];
  if (data.version !== 2) problems.push(`anatomy.json: version is ${data.version}, expected 2`);
  if (!ANATOMIES.includes(data.default?.anatomy)) problems.push("anatomy.json: `default.anatomy` must be a known anatomy");

  const die = data.die;
  if (!Number.isInteger(die) || die < 2) problems.push(`anatomy.json: \`die\` must be an integer face count, found ${die}`);

  /* The bands have to tile 1..die with no gap and no overlap, in this order: a hole here is a roll
   * that resolves to no body part at all. */
  const bands = data.bands;
  if (!isPlainObject(bands)) {
    problems.push("anatomy.json: `bands` is not an object");
  } else {
    let expected = 1;
    for (const key of ["limbs", "torso", "head"]) {
      const [min, max] = bands[key] ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        problems.push(`anatomy.json: band "${key}" is not a valid [min, max]`);
        expected = null;
        continue;
      }
      if (expected !== null && min !== expected) {
        problems.push(`anatomy.json: band "${key}" starts at ${min}, expected ${expected}`);
      }
      expected = max + 1;
    }
    if (expected !== null && Number.isInteger(die) && expected !== die + 1) {
      problems.push(`anatomy.json: bands cover 1-${expected - 1}, expected 1-${die}`);
    }
  }

  const order = data.beastOrder;
  if (!Array.isArray(order) || !order.length) {
    problems.push("anatomy.json: `beastOrder` must be a non-empty array of slots");
  } else {
    for (const slot of order) {
      if (!SLOTS.includes(slot)) problems.push(`anatomy.json: \`beastOrder\` names unknown slot "${slot}"`);
      /* The two halves of the grid's shape have to agree. A slot the generator can produce but
       * ANATOMY_LOCATIONS doesn't list is a hit location with no effect table behind it — the one
       * failure mode that surfaces as "nothing happened" at the table rather than as a load-time
       * complaint. */
      else if (!ANATOMY_LOCATIONS.beast?.includes(slot)) {
        problems.push(`anatomy.json: \`beastOrder\` can produce "${slot}", which ANATOMY_LOCATIONS does not list for beast`);
      }
    }
  }

  if (!ANATOMY_LOCATIONS.aberrant?.includes("appendage")) {
    problems.push("anatomy.json: aberrant layouts produce \"appendage\", which ANATOMY_LOCATIONS does not list for aberrant");
  }

  /* Every count up to the cap has to divide the limb band evenly, or some appendage silently gets
   * a wider slice than its neighbour. The generator handles a remainder rather than breaking, so
   * this is a warning about the layout being lopsided, not about it being invalid. */
  const cap = data.maxAppendages;
  const faces = Array.isArray(bands?.limbs) ? bands.limbs[1] - bands.limbs[0] + 1 : null;
  if (!Number.isInteger(cap) || cap < 1) {
    problems.push(`anatomy.json: \`maxAppendages\` must be a positive integer, found ${cap}`);
  } else if (Number.isInteger(faces)) {
    for (let n = 1; n <= cap; n++) {
      if (faces % n) problems.push(`anatomy.json: ${faces} limb faces do not divide evenly by ${n}, so a ${n}-appendage layout is lopsided`);
    }
  }

  // The terminal fallback has to be a slot every creature is guaranteed to have.
  const fallback = data._fallbackSlot ?? "torso";
  if (!["torso", "head"].includes(fallback)) problems.push(`anatomy.json: \`_fallbackSlot\` "${fallback}" is not a universal slot`);

  // Only humanoid is written out; the other two have no table to check.
  if (!isPlainObject(data.tables)) return [...problems, "anatomy.json: `tables` is not an object"];

  const rows = data.tables.humanoid;
  if (!Array.isArray(rows)) {
    problems.push("anatomy.json: no \"humanoid\" table");
  } else {
    let expected = 1;
    for (const row of [...rows].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0))) {
      const [min, max] = row?.range ?? [];
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        problems.push("anatomy.json: \"humanoid\" has a row with an invalid `range`");
        continue;
      }
      if (min !== expected) problems.push(`anatomy.json: "humanoid" expected coverage to resume at ${expected}, found ${min}`);
      expected = max + 1;

      if (!SLOTS.includes(row.slot)) problems.push(`anatomy.json: "humanoid" row ${min}-${max} names unknown slot "${row.slot}"`);
      else if (!ANATOMY_LOCATIONS.humanoid?.includes(row.slot)) {
        problems.push(`anatomy.json: "humanoid" row ${min}-${max} can produce "${row.slot}", which ANATOMY_LOCATIONS does not list for it`);
      }
    }
    if (Number.isInteger(die) && expected !== die + 1) {
      problems.push(`anatomy.json: "humanoid" covers 1-${expected - 1}, expected 1-${die}`);
    }
  }

  for (const [type, entry] of Object.entries(data.byCreatureType ?? {})) {
    if (!ANATOMIES.includes(entry?.anatomy)) problems.push(`anatomy.json: creature type "${type}" maps to unknown anatomy "${entry?.anatomy}"`);

    // Both lists are optional — a humanoid type needs neither — but a present one must be usable.
    if (entry?.beastLimbs != null) {
      if (!Array.isArray(entry.beastLimbs)) problems.push(`anatomy.json: creature type "${type}" has a non-array \`beastLimbs\``);
      else for (const limb of entry.beastLimbs) {
        if (!Array.isArray(order) || !order.includes(limb)) problems.push(`anatomy.json: creature type "${type}" lists "${limb}", which is not in \`beastOrder\``);
      }
    }
    if (entry?.appendages != null) {
      if (!Array.isArray(entry.appendages)) problems.push(`anatomy.json: creature type "${type}" has a non-array \`appendages\``);
      else if (Number.isInteger(cap) && entry.appendages.length > cap) {
        problems.push(`anatomy.json: creature type "${type}" lists ${entry.appendages.length} appendages, more than \`maxAppendages\` (${cap})`);
      }
    }
  }

  return problems;
}
