/* Critical Power — the die pool whose total indexes the effect table (concept §2, §4;
 * DESIGN.md §5.2).
 *
 * Pure and synchronous. Nothing here reads the world or rolls anything; callers hand in numbers
 * and get numbers back, which is what makes the whole grade calculation testable from the
 * console and shared between the automated flow and the manual resolver.
 */

/** The grade ladder, weakest first. Index is the rung; shifts move along this array. */
export const GRADES = ["glancing", "solid", "heavy", "brutal", "devastating"];

/** Die pool per grade (concept §2). */
const FORMULA = {
  glancing: "1d4",
  solid: "1d6",
  heavy: "2d4",
  brutal: "2d6",
  devastating: "2d8",
};

/** Average of each pool, for showing a grade's weight on the card without rolling it. */
const AVERAGE = { glancing: 2.5, solid: 3.5, heavy: 5, brutal: 7, devastating: 9 };

export const powerFormula = (grade) => FORMULA[grade] ?? null;
export const powerAverage = (grade) => AVERAGE[grade] ?? null;
export const gradeIndex = (grade) => GRADES.indexOf(grade);

/**
 * Base grade from the weapon's critical multiplier.
 *
 * Only ×2/×3/×4 map to a grade: Glancing and Devastating have no multiplier of their own and are
 * reachable only by shifting (concept §2). A multiplier outside that range is clamped rather than
 * rejected — a ×5 weapon should behave as the hardest-hitting thing on the ladder, not as nothing.
 */
export function gradeFor(critMult) {
  const mult = Math.round(Number(critMult) || 2);
  if (mult <= 2) return "solid";
  if (mult === 3) return "heavy";
  return "brutal";
}

/**
 * Move `steps` rungs along the ladder.
 *
 * Steps past either end do not clamp and vanish — they convert to a flat ±1 per step (concept
 * §2). Returning both halves from one function is the point: the overflow rule would otherwise
 * be reimplemented at every call site that shifts a grade (size delta, explosion, GM adjustment).
 *
 * @param {string} grade
 * @param {number} steps  positive shifts up, negative down
 * @returns {{ grade: string, flat: number }}
 */
export function shiftGrade(grade, steps) {
  const start = gradeIndex(grade);
  if (start < 0) return { grade, flat: 0 };

  const target = start + Math.trunc(steps || 0);
  const clamped = Math.min(Math.max(target, 0), GRADES.length - 1);

  return { grade: GRADES[clamped], flat: target - clamped };
}

/**
 * **Flat** modifier from the size difference between attacker and target (concept §4 step 3).
 *
 * PF1 v11 stores `system.traits.size.value` as a numeric index into `pf1.config.sizeChart`, so one
 * category of difference is one integer — the delta is a plain subtraction. A larger attacker adds.
 *
 * This used to shift the grade a tier per category and now adds to the total instead; the weapon
 * class went the other way. See the note on `weaponClassTiers`.
 */
export function sizeModifier(attackerSize, targetSize) {
  const a = Number(attackerSize);
  const t = Number(targetSize);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return a - t;
}

/**
 * **Tier** shift from how the weapon is held (concept §4 step 5).
 *
 * Light weapon / secondary natural attack: one tier down. Two-handed / sole natural attack: one
 * tier up. A sole natural attack is the one that gets 1.5× the ability modifier to damage; see
 * `weaponClassFor` in context.mjs for how that is derived.
 *
 * ── The swap ────────────────────────────────────────────────────────────────
 *
 * These two inputs traded places: size used to move the tier and weapon class used to add a flat
 * ±1, and it is now the other way round. The arithmetic of each is unchanged — what changed is
 * which half of the result it lands in.
 *
 * It matters more than a reshuffle, because the two are not interchangeable. A tier changes the
 * *die pool*, so it widens or narrows the spread as well as moving the average (1d4 → 2d8), and it
 * is bounded by the five-rung ladder with the overflow rule catching anything past the ends. A flat
 * modifier moves the total and nothing else, and is unbounded. So putting size on the flat side
 * means a big size gap now scales without limit rather than saturating at Devastating, and putting
 * weapon class on the tier side means light-vs-two-handed changes how swingy the roll is rather
 * than nudging it.
 */
export function weaponClassTiers(weaponClass) {
  switch (weaponClass) {
    case "light":
    case "naturalSecondary":
      return -1;
    case "twoHanded":
    case "naturalSole":
      return 1;
    default:
      return 0; // oneHanded, naturalPrimary, unknown
  }
}

/**
 * The weapon classes, in the order they are offered, and how each one reads.
 *
 * Lives next to `weaponClassTiers` so a class cannot gain a name in one place and a tier in
 * another. Lower-case because these are read mid-sentence in the Power line's derivation trail
 * ("Solid ×2 → Glancing (light weapon −1)"); the resolver's dropdown capitalises its own copy.
 */
export const WEAPON_CLASSES = [
  "light",
  "oneHanded",
  "twoHanded",
  "naturalPrimary",
  "naturalSecondary",
  "naturalSole",
];

const WEAPON_CLASS_LABELS = {
  light: "light weapon",
  oneHanded: "one-handed",
  twoHanded: "two-handed",
  naturalPrimary: "natural, primary",
  naturalSecondary: "natural, secondary",
  naturalSole: "natural, sole attack",
};

export const weaponClassLabel = (weaponClass) => WEAPON_CLASS_LABELS[weaponClass] ?? null;

/** Grade keys are stored lower-case; this is the display form. */
export const gradeLabel = (grade) => (grade ? `${grade[0].toUpperCase()}${grade.slice(1)}` : "");

/**
 * One iteration of the confirmation explosion (concept §4.2).
 *
 * If a confirmation roll is itself within the threat range, Critical Power goes up a tier and
 * the confirmation is rolled again, repeating until it doesn't threaten. This is only the test
 * for a single roll; the loop lives on the prompt card (§7.2) because each iteration is a fresh
 * roll request.
 *
 * Reads the natural d20 face, not the modified total — a threat is a property of the die.
 *
 * @param {Roll|number} roll  a D20RollPF, or a bare natural die result
 * @param {number} critRange  low end of the threat range (20 for ×2/20, 19 for 19-20, …)
 * @returns {{ threatened: boolean, tiersGained: number, natural: number|null }}
 */
export function explosionStep(roll, critRange) {
  const natural = naturalFace(roll);
  const threshold = Number(critRange) || 20;

  if (natural == null) return { threatened: false, tiersGained: 0, natural: null };

  const threatened = natural >= threshold;
  return { threatened, tiersGained: threatened ? 1 : 0, natural };
}

/** The natural d20 face behind a roll, however it was handed to us. */
function naturalFace(roll) {
  if (typeof roll === "number") return Number.isFinite(roll) ? roll : null;
  // pf1's D20RollPF exposes the d20 term directly; fall back to the first d20 die found.
  const die = roll?.d20 ?? roll?.dice?.find((d) => d.faces === 20);
  const result = die?.total ?? die?.results?.find((r) => r.active)?.result;
  return Number.isFinite(result) ? result : null;
}

/**
 * The `extraTiers` that makes a computed grade come out as `target` (§7.2, the Power stage).
 *
 * The GM's grade dropdown is an ABSOLUTE choice — "make this devastating" — but the model only
 * knows shifts, so the pick has to be expressed as one. Solving for the shift rather than nudging
 * by the difference is what makes the dropdown land on the picked grade every time: the sum
 * `base + weapon + explosion + extra` is forced to the target's own index, which is inside the
 * ladder by definition, so `shiftGrade` produces no overflow and cannot clamp somewhere else.
 *
 * Note that the size gap is NOT part of `priorSteps` any more — it is a flat modifier now and does
 * not move the grade at all, so overriding the grade leaves it untouched, which is correct.
 *
 * It also absorbs any overflow the automatic calculation had. That is the point: once the GM has
 * named a grade, "you shifted two past devastating" is no longer a fact about the result.
 *
 * @param {string} target      the grade the GM picked
 * @param {object} opts
 * @param {string} opts.base   the multiplier's own grade, from `gradeFor`
 * @param {number} opts.priorSteps  every shift that is not the GM's — weapon class + explosion
 * @returns {number}
 */
export function tiersToReach(target, { base, priorSteps = 0 } = {}) {
  const to = gradeIndex(target);
  const from = gradeIndex(base);
  if (to < 0 || from < 0) return 0;
  return to - (from + (Number(priorSteps) || 0));
}

/**
 * Compose every grade input into one auditable result.
 *
 * Shifts stack (weapon class + explosion tiers + any GM adjustment) and are applied together so
 * that overflow past the ends is computed once, on the summed shift, rather than per source —
 * shifting up one and down one must be a no-op, not two separate overflows.
 *
 * The size gap is on the **flat** side and the weapon class on the **tier** side; they swapped
 * places. See `weaponClassTiers` for why that is a real change and not a reshuffle.
 *
 * `extraTiers` and `extraFlat` are the GM's thumb on the scale: the Power stage offers a grade
 * override and a free-text modifier, and both arrive here rather than being applied to the total
 * afterwards, so the breakdown stays a complete account of how the pool was arrived at.
 *
 * `critImmunity` is the target's own reduction, given as the positive number of rows it shrugs off
 * and negated here. It has its own input rather than being folded into `extraFlat` by the caller
 * because `explainGrade` names every contribution, and a target's toughness attributed to the GM's
 * modifier box is worse than not naming it at all.
 *
 * @returns {{ grade: string, formula: string, flat: number, steps: number, base: string,
 *             breakdown: object }}
 */
export function computeGrade({
  critMult,
  attackerSize = null,
  targetSize = null,
  explosionTiers = 0,
  weaponClass = null,
  critImmunity = 0,
  extraTiers = 0,
  extraFlat = 0,
} = {}) {
  const base = gradeFor(critMult);

  // Tier side: weapon class, the explosion, and the GM's grade pick.
  const weaponTiers = weaponClassTiers(weaponClass);
  const steps = weaponTiers + (Number(explosionTiers) || 0) + (Number(extraTiers) || 0);

  const { grade, flat: overflow } = shiftGrade(base, steps);

  // Flat side: the size gap, whatever the tier shift overflowed by, the target's immunity, and
  // the GM's own modifier.
  const sizeFlat = attackerSize == null || targetSize == null ? 0 : sizeModifier(attackerSize, targetSize);
  const immunityFlat = -(Number(critImmunity) || 0);
  const flat = overflow + sizeFlat + immunityFlat + (Number(extraFlat) || 0);

  return {
    base,
    grade,
    formula: powerFormula(grade),
    steps,
    flat,
    breakdown: {
      // Echoed rather than merely consumed: `explainGrade` reads the result alone, and the base
      // grade is meaningless without the multiplier it came from.
      critMult: Math.round(Number(critMult) || 2),
      weaponClass: weaponClass ?? null,

      weaponTiers,
      explosionTiers: Number(explosionTiers) || 0,
      extraTiers: Number(extraTiers) || 0,
      overflow,
      sizeFlat,
      immunityFlat,
      extraFlat: Number(extraFlat) || 0,
    },
  };
}

/** ±n with a typographic minus, matching the tier suffixes in the resolver's own labels. */
const signed = (n) => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

/**
 * A `computeGrade` result as the parts the Power line reads back (§7.2).
 *
 * The readout used to say only "Glancing 1d4 — from solid", which names the two ends and none of
 * the reasons: a ×2 light weapon and a ×3 secondary natural attack produce the same line, and
 * neither says which input moved it. This turns the breakdown into the sentence
 * "Solid ×2 → Glancing (light weapon −1)", plus the flat modifiers as their own named list.
 *
 * Every contribution that is non-zero is named; zeroes are dropped rather than shown as "+0",
 * because the point is to account for the number that IS there.
 *
 * Pure, like the rest of this file — it formats numbers into strings and reads nothing. The
 * capitalisation is applied here rather than in CSS: the trail mixes grade keys, which need it,
 * with authored phrases like "light weapon", which `text-transform: capitalize` would mangle.
 *
 * @param {object} result  a `computeGrade` return value
 * @returns {{ base: string, grade: string, critMult: number, shifted: boolean,
 *             tiers: Array<{label: string, delta: number, text: string}>,
 *             flats: Array<{label: string, delta: number, text: string}> }}
 */
export function explainGrade(result) {
  const b = result?.breakdown ?? {};
  const part = (delta, label) => ({ delta, label, text: `${label} ${signed(delta)}` });

  const tiers = [];
  if (b.weaponTiers) tiers.push(part(b.weaponTiers, weaponClassLabel(b.weaponClass) ?? "weapon"));
  if (b.explosionTiers) {
    // One threat is "confirm threat"; several is worth counting, since each was a separate roll.
    const label = b.explosionTiers === 1 ? "confirm threat" : `${b.explosionTiers} confirm threats`;
    tiers.push(part(b.explosionTiers, label));
  }
  if (b.extraTiers) tiers.push(part(b.extraTiers, "GM"));

  const flats = [];
  if (b.sizeFlat) flats.push(part(b.sizeFlat, "size"));
  // Overflow is the ladder's doing, not an input's — named so the total never gains an unexplained
  // point when a shift runs off the end.
  if (b.overflow) flats.push(part(b.overflow, "past the ladder"));
  if (b.immunityFlat) flats.push(part(b.immunityFlat, "crit immunity"));
  if (b.extraFlat) flats.push(part(b.extraFlat, "GM"));

  return {
    base: gradeLabel(result?.base),
    grade: gradeLabel(result?.grade),
    critMult: b.critMult ?? 2,
    // Shown whenever a tier moved, not merely when the ends differ: shifts that cancel out
    // (light weapon −1 and a confirm threat +1) are still two facts about this critical.
    shifted: tiers.length > 0 || result?.base !== result?.grade,
    tiers,
    flats,
  };
}
