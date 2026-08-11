/* pf1-critical-effects — the Astora Homebrew master switch.
 *
 * Nearly everything this module does is an interpretation of critical hits, not a rule out of the
 * book. What this switch governs is narrower: the parts that change how *other* rules work, which
 * a table running closer to RAW would want gone. Today that is **dedicated healing** — the house
 * rule that some injuries can't simply be healed away and must absorb a threshold of hit points
 * that would otherwise have gone to the character.
 *
 * pf1-bleed-effects carries the same switch, and its Deep Bleed rule is built on this one's
 * machinery, so the two are read together: a deep bleed is only offered when *both* modules have
 * homebrew on (see `enabled` on the dedicated-healing API).
 *
 * ── What "off" means ─────────────────────────────────────────────────────────
 * It stops new obligations, not existing ones. No new item can be configured to need dedicated
 * healing, and no new deep bleed is inflicted — but anything already part-way through recovery
 * keeps its allocation dialog and can still be paid off. Turning a house rule off should not
 * strand a character with a wound the rules can no longer close. This mirrors, deliberately, how
 * pf1-bleed-effects' own setting has always behaved.
 *
 * A GM who wants the in-flight ones gone too removes the buff, or forces the bleed
 * (`pf1BleedEffects.clear(token, { force: true })`).
 *
 * Leaf-ish by design: imports only MODULE_ID, so any layer may read the switch without a cycle.
 */

import { MODULE_ID } from "./const.mjs";

/** Setting key. World scope: a house rule is a property of the campaign, not of a client. */
export const SETTING_HOMEBREW = "astoraHomebrew";

/**
 * Whether this world runs the Astora homebrew rules.
 *
 * Safe before the setting is registered (returns false), so init-time callers don't have to care
 * about ordering.
 *
 * @returns {boolean}
 */
export function homebrewEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING_HOMEBREW) === true;
  } catch {
    return false;
  }
}

export function registerHomebrewSetting() {
  game.settings.register(MODULE_ID, SETTING_HOMEBREW, {
    name: "Astora Homebrew rules",
    hint:
      "Enables non-RAW rules (currently dedicated healing). Pairs with pf1-bleed-effects' " +
      "matching setting. Off stops new ones only.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}

/* --- where a buff named by the catalog may be found -------------------------
 *
 * The catalog names buffs by name, and the card snapshots one to draw its header (§7.6). Which
 * compendia that lookup is allowed to search is a judgement about **this world**, not about the
 * content, which is why it is a setting rather than a constant.
 *
 * Default OFF, and the default is the strict one on purpose. Searching every item compendium finds
 * a buff of the right name wherever it lives, which is convenient right up until it silently finds
 * the *wrong* one — a "Broken Arm" from an unrelated module, drawn on the card as though it were
 * ours. A miss that says so is easier to fix than a hit that lied.
 *
 * Note this governs the **snapshot only**. Delivery is astora-mod's `applyBuffTo`, which searches
 * the buff sources configured in *that* module and does not consult this setting — so a GM who
 * keeps their buffs elsewhere turns this on to make the two agree, rather than to enable anything.
 */
export const SETTING_SEARCH_ALL_PACKS = "searchAllBuffPacks";

/** Whether a buff lookup may fall back to compendia outside this module's own pack. */
export function searchAllBuffPacks() {
  try {
    return game.settings.get(MODULE_ID, SETTING_SEARCH_ALL_PACKS) === true;
  } catch {
    return false;
  }
}

export function registerBuffLookupSetting() {
  game.settings.register(MODULE_ID, SETTING_SEARCH_ALL_PACKS, {
    name: "Look for effect buffs outside this module",
    hint:
      "Off: an effect's buff must be in this module's Critical Effect Buffs pack, and a missing " +
      "one is reported. On: every item compendium is searched by name — turn this on if you keep " +
      "your own copies of these buffs elsewhere.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}
