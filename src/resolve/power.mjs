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
 * Grade shift from the size difference between attacker and target (concept §4 step 3).
 *
 * PF1 v11 stores `system.traits.size.value` as a numeric index into `pf1.config.sizeChart`, so
 * one category of difference is one integer — the delta is a plain subtraction. A larger
 * attacker shifts up.
 */
export function sizeShift(attackerSize, targetSize) {
  const a = Number(attackerSize);
  const t = Number(targetSize);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return a - t;
}

/**
 * Flat modifier contributed by how the weapon is held (concept §4 step 5).
 *
 * Light weapon / secondary natural attack: −1. Two-handed / sole natural attack: +1. A sole
 * natural attack is the one that gets 1.5× the ability modifier to damage; see
 * `weaponClassFor` in context.mjs for how that is derived.
 */
export function flatModifierFor(weaponClass) {
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
 * `base + size + explosion + extra` is forced to the target's own index, which is inside the
 * ladder by definition, so `shiftGrade` produces no overflow and cannot clamp somewhere else.
 *
 * It also absorbs any overflow the automatic calculation had. That is the point: once the GM has
 * named a grade, "you shifted two past devastating" is no longer a fact about the result.
 *
 * @param {string} target      the grade the GM picked
 * @param {object} opts
 * @param {string} opts.base   the multiplier's own grade, from `gradeFor`
 * @param {number} opts.priorSteps  every shift that is not the GM's — size + explosion
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
 * Shifts stack (size delta + explosion tiers + any GM adjustment) and are applied together so
 * that overflow past the ends is computed once, on the summed shift, rather than per source —
 * shifting up one and down one must be a no-op, not two separate overflows.
 *
 * `extraTiers` and `extraFlat` are the GM's thumb on the scale: the Power stage offers a grade
 * override and a free-text modifier, and both arrive here rather than being applied to the total
 * afterwards, so the breakdown stays a complete account of how the pool was arrived at.
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
  extraTiers = 0,
  extraFlat = 0,
} = {}) {
  const base = gradeFor(critMult);

  const size = attackerSize == null || targetSize == null ? 0 : sizeShift(attackerSize, targetSize);
  const steps = size + (Number(explosionTiers) || 0) + (Number(extraTiers) || 0);

  const { grade, flat: overflow } = shiftGrade(base, steps);
  const weapon = flatModifierFor(weaponClass);
  const flat = overflow + weapon + (Number(extraFlat) || 0);

  return {
    base,
    grade,
    formula: powerFormula(grade),
    steps,
    flat,
    breakdown: {
      size,
      explosionTiers: Number(explosionTiers) || 0,
      extraTiers: Number(extraTiers) || 0,
      overflow,
      weapon,
      extraFlat: Number(extraFlat) || 0,
    },
  };
}
