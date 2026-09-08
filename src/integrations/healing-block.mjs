/* Healing suppression (DESIGN.md §8.2) — an effect that stops its bearer recovering hit points.
 *
 * Distinct from dedicated healing (§8) in both storage and intent, and deliberately so. A wound
 * that *absorbs* healing is a debt: the healing arrives, goes somewhere useful, and the wound
 * closes when enough of it has. A poison that stops you healing is a refusal: the healing does not
 * land at all, and nothing is paid off.
 *
 * ── Configured by boolean flag, not by a sheet section ───────────────────────
 * Three PF1 boolean flags, typed into the Advanced tab of whatever buff, feat or condition item
 * carries the effect:
 *
 *   noHealing           refuses both
 *   noMagicalHealing    refuses spells, magical consumables, su/sp abilities
 *   noNaturalHealing    refuses rest, healing dice, extraordinary fast healing and regeneration
 *
 * The built-in flags rather than a flag of this module's own with a UI on top, because this is the
 * narrow case they exist for: hand-entered data on the Advanced tab, authored once per effect and
 * never written by code. `actor.itemFlags.boolean` aggregates them across **active** items only, so
 * switching the buff off restores healing with no cleanup hook, and `.sources` names the culprit
 * for the chat message.
 *
 * There is no Heal-check gate. A boolean flag cannot carry a DC, and the effect is removed or
 * switched off when the check is passed — which is what a GM would do to it anyway.
 *
 * ── Precedence: suppression comes first ──────────────────────────────────────
 * Healing that is blocked never becomes dedicated healing. A wound cannot absorb hit points that
 * were never going to arrive, and a `clearOnHeal` wound must not close on a cure spell that did
 * nothing. Enforced two ways, because one of them is not enough on its own:
 *
 *  1. This module's listener is registered before dedicated healing's (see registration in
 *     critical-effects.mjs), so it runs first within this module.
 *  2. A suppressed application is marked with `SUPPRESSED_KEY`, and `onApplyDamage` returns on it.
 *     Registration order settles listeners inside one module; the marker settles the question for
 *     anything reading the same options afterwards, in any module, in any order.
 *
 * ── Magical or natural ───────────────────────────────────────────────────────
 * The two can be blocked separately, so every heal has to be classified. PF1 already draws this
 * line and it is not worth inventing a second one: `system.abilityType` of `su`/`sp` is magical,
 * `ex` is not (pf1.config.abilityTypes). Spells and magical consumables are magical by item type.
 *
 * Heals with no source item — a bare `applyDamage(-10)` from a macro, a module's automation —
 * cannot be classified, and **fail closed**: any active suppression refuses them. A curse does not
 * make exceptions because a macro was terse, and anything that should be exempt can say what it is
 * by passing an item. The cost is real and worth stating: a homebrew regeneration macro is stopped
 * by a magic-only block until it passes its source item.
 *
 * ── What is suppressed, and what is not ──────────────────────────────────────
 * Hit points only. Nonlethal damage, ability damage and temporary hit points are not hit point
 * recovery and are left alone — which is why a dual heal is converted to a nonlethal-only heal
 * rather than zeroed outright: the nonlethal half of a cure spell was never blocked, and dropping
 * it would be a second house rule nobody asked for.
 *
 * Rest is not intercepted here. It never reaches `applyDamage` — PF1's own rest writes the actor
 * directly, and astora-mod's rest engine replaces that path wholesale — so the rest gate belongs at
 * those sites, which consult `wouldBlock` through this module's API. Nor is a hand-typed hit point
 * total: a GM correcting a number is bookkeeping, not treatment, and the same line pf1-bleed-effects
 * draws for what counts as healing is drawn here.
 */

import { MODULE_ID } from "../const.mjs";

/** The boolean flags an effect carries to refuse healing. */
export const FLAGS = Object.freeze({
  all: "noHealing",
  magical: "noMagicalHealing",
  natural: "noNaturalHealing",
});

/**
 * Left on the `applyDamage` options of an application this module suppressed.
 *
 * The contract for everything downstream: the hit points named by `value` are not going to arrive,
 * whatever `value` still says. Read it rather than inferring from a zeroed value — a dual heal is
 * suppressed by being redirected to nonlethal, and keeps a negative value it will honour.
 */
export const SUPPRESSED_KEY = "ceHealingBlocked";

/**
 * Set on `applyDamage` options to pass a heal through untouched.
 *
 * The escape hatch the fail-closed rule needs. Two callers want it for opposite reasons:
 *
 *  - **Dedicated healing's `_applyHp`**, which re-enters `applyDamage` with the residual of an
 *    allocation. That heal was already judged when it first arrived, and the re-entrant call
 *    carries no source item — so without this it would be classified unknown and refused, killing
 *    the leftover of a heal this module had just allowed through.
 *  - **A GM or macro overruling the effect** for one application, without switching the buff off.
 *
 * Not a per-effect setting: it exempts one application, not one effect.
 */
export const EXEMPT_KEY = "ignoreHealingBlock";

/** @typedef {"magical"|"natural"|"unknown"} HealingKind */

/* ── Who is suppressing ────────────────────────────────────────────────────── */

/**
 * The active items on an actor carrying one boolean flag.
 *
 * `itemFlags.boolean` is built during actor data preparation from active items only, so a switched
 * off buff contributes nothing and no de-duplication is needed here.
 *
 * @param {Actor} actor
 * @param {string} flag
 * @returns {Item[]}
 */
function sourcesOf(actor, flag) {
  return actor?.itemFlags?.boolean?.[flag]?.sources ?? [];
}

/**
 * The effects on an actor that would refuse healing of this kind.
 *
 * Unknown fails closed: anything suppressing either kind refuses it.
 *
 * @param {Actor} actor
 * @param {HealingKind} kind
 * @returns {Item[]} The items refusing, deduplicated; empty when the healing may land.
 */
export function refusedBy(actor, kind) {
  const flags =
    kind === "unknown" ? [FLAGS.all, FLAGS.magical, FLAGS.natural] : [FLAGS.all, FLAGS[kind]];

  // One item may carry both `noHealing` and a narrower flag; the message should name it once.
  return [...new Set(flags.flatMap((flag) => sourcesOf(actor, flag)))];
}

/**
 * Whether magical healing is refused. Convenience for callers with no application to classify.
 *
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function refusesMagical(actor) {
  return refusedBy(actor, "magical");
}

/**
 * Whether natural healing is refused — the question every rest path asks.
 *
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function refusesNatural(actor) {
  return refusedBy(actor, "natural");
}

/* ── Classification ────────────────────────────────────────────────────────── */

/** Consumable subtypes that are magic items rather than mundane kit. */
const MAGICAL_CONSUMABLES = new Set(["potion", "scroll", "wand", "staff", "rod"]);

/**
 * What kind of healing an `applyDamage` application is.
 *
 * Reads only the source item, never the amount or the target: the same cure spell is magical
 * whoever drinks it. `su`/`sp`/`ex` is PF1's own distinction and the one an author has already
 * made on the feature's sheet, so nothing here needs configuring per effect.
 *
 * @param {object} options - The options `applyDamage` was called with.
 * @returns {HealingKind}
 */
export function classify(options) {
  const item = options?.item ?? options?.action?.item ?? null;
  if (!item) return "unknown";

  if (item.type === "spell") return "magical";
  if (item.type === "consumable") {
    return MAGICAL_CONSUMABLES.has(item.system?.subType) ? "magical" : "unknown";
  }

  // Features, and anything else carrying PF1's ability type.
  switch (item.system?.abilityType) {
    case "su":
    case "sp":
      return "magical";
    case "ex":
      return "natural";
    default:
      return "unknown";
  }
}

/**
 * Whether this application of healing is refused, and by what.
 *
 * The single entry point for other modules — order-independent, because it asks the question
 * outright rather than looking for a marker another listener may not have left yet.
 *
 * Hit points only, so three applications are never refused, matching `restoresHitPoints` in
 * dedicated healing: nonlethal-only healing, healing directed at wounds under the Wounds & Vigor
 * rules, and anything that is not healing at all.
 *
 * @param {Actor} actor
 * @param {object} options - `applyDamage` options, or `{ item }` for a caller with no application.
 * @returns {Item[]} The items refusing it; empty when the healing may land.
 */
export function wouldBlock(actor, options = {}) {
  if (!(actor instanceof Actor)) return [];
  if (options[EXEMPT_KEY]) return []; // deliberately overruled for this application
  if (options.value !== undefined && !(Number(options.value) < 0)) return []; // damage, or nothing
  if (options.asNonlethal || options.asWounds) return []; // not hit point recovery

  return refusedBy(actor, classify(options));
}

/* ── The intercept ─────────────────────────────────────────────────────────── */

/** Announce a refusal, so healing quietly doing nothing isn't a bug report. */
function announce(actor, refusers) {
  const names = refusers.map((i) => `<strong>${i.name}</strong>`).join(", ");
  ChatMessage.create({
    content: `<p><strong>${actor.name}</strong> cannot recover hit points — ${names}.</p>`,
    speaker: { alias: "Healing Blocked" },
  }).catch((err) => console.error(`${MODULE_ID} | healing block: could not post refusal`, err));
}

/**
 * Suppress a refused heal in place.
 *
 * Runs on `pf1ApplyDamage`, which fires before any of `applyDamage`'s own arithmetic and re-reads
 * `options.value` afterwards, so mutating the options here is the whole mechanism — no wrapper,
 * and nothing to unwind if another listener declines to continue.
 *
 * @param {Actor} actor
 * @param {object} options
 */
function onApplyDamage(actor, options) {
  if (options[SUPPRESSED_KEY]) return; // already handled; never announce twice
  if (!actor?.isOwner) return; // the applying client is an owner; anyone else is racing it

  const refusers = wouldBlock(actor, options);
  if (!refusers.length) return;

  options[SUPPRESSED_KEY] = true;

  /* Hit points only. A dual heal also clears nonlethal, and that half was never suppressed — so
   * rather than zeroing the application, redirect it. `asNonlethal` healing reduces the nonlethal
   * pool and leaves `hp.value` untouched, which is exactly the wanted outcome and is PF1's own
   * arithmetic rather than a reimplementation of it. Without dual heal there is no second half to
   * preserve, and turning it on here would invent healing that was never offered. */
  if (options.dualHeal) options.asNonlethal = true;
  else options.value = 0;

  announce(actor, refusers);
}

export function registerHealingBlock() {
  Hooks.on("pf1ApplyDamage", onApplyDamage);
}
