/* pf1-defense-manager — critical immunity.
 *
 * DESIGN.md §10 recorded "designating a creature crit-immune" as deferred: PF1 v11 models critical
 * immunity nowhere at all, and this module's own `flags.pf1-critical-effects.critImmunity` is a
 * *mitigation dial* — a number of effect-table rows a target shrugs off — not a designation. The
 * designation now lives in pf1-defense-manager, as a **Critical Immunity** entry in a source item's
 * Granted Defenses, next to that creature's DR and energy resistances. The two do not overlap and
 * neither feeds the other:
 *
 *   `critImmunity` (number)   softens a resolution that is happening — a penalty to Critical Power.
 *   `critImmune`   (boolean)  says a resolution should not be happening — an indicator, never a gate.
 *
 * The boolean deliberately does **not** apply a Critical Power penalty of its own. The GM keeps the
 * override (§1: the module informs, the GM rules), and a silent penalty behind a button they chose
 * to click anyway would be a number nobody could account for.
 *
 * Optional dependency: with the module absent, inactive, or its API not yet published, every call
 * answers "not immune" and nothing is marked. Callers need no guard of their own.
 */

const DEFENSE_MANAGER_ID = "pf1-defense-manager";

/** @returns {object|null} the live API, or null when the module isn't there to ask. */
function api() {
  const mod = game.modules.get(DEFENSE_MANAGER_ID);
  if (!mod?.active) return null;
  return mod.api ?? null;
}

/**
 * Whether a target is designated immune to critical hits.
 *
 * @param {Actor|TokenDocument|Token|null} target - An actor, or anything carrying one.
 * @returns {boolean} False whenever the answer cannot be established.
 */
export function isCritImmune(target) {
  if (!target) return false;
  try {
    return api()?.isCritImmune?.(target) === true;
  } catch (err) {
    console.error(`${DEFENSE_MANAGER_ID} | asking whether a target is crit-immune failed:`, err);
    return false;
  }
}

/**
 * What grants that immunity, for a tooltip — "Undead Traits", "Fortification (heavy)".
 *
 * @param {Actor|TokenDocument|Token|null} target
 * @returns {string[]} Empty when not immune, or when the source list cannot be read.
 */
export function critImmunitySources(target) {
  if (!target) return [];
  try {
    const sources = api()?.critImmunitySources?.(target);
    return Array.isArray(sources) ? sources : [];
  } catch {
    return [];
  }
}
