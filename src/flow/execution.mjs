/* Turning a drawn entry into the thing a card can execute (DESIGN.md §6, §7.6).
 *
 * The one place the crit flow and the fumble flow meet. A fumble that breaks your own hand and a
 * critical that breaks someone else's are the same three channels pointed at a different person,
 * so they share this and differ only in who they hand it.
 *
 * Two calls, in this order, and the order is not arbitrary:
 *
 *   resolveExecution()  rolls the dice and looks the buffs up. Everything expensive or
 *                       non-deterministic happens here, once, GM-side, and the result is stored on
 *                       the card so every client draws the same numbers forever.
 *   attachExecution()   puts the save and the buttons on the card, which needs the record to
 *                       already be written — the buttons carry the DC, and the save is embedded
 *                       onto the same message.
 */

import { MODULE_ID } from "../const.mjs";
import { resolveBranches } from "../resolve/branches.mjs";
import { normalDamageTotal } from "../integrations/pf1-pipeline.mjs";
import { offerApplyButtons } from "./effect-apply.mjs";
import { blowDamage } from "./weapon-stuck.mjs";
import { postSave, promptForDC, saveDC } from "./save-request.mjs";

/**
 * Everything an entry's mechanics need decided, decided.
 *
 * Returns null when the entry has no mechanics at all, which is the common case today and a
 * first-class one: the card then renders exactly as it did before any of this existed.
 *
 * @param {object} entry
 * @param {object} opts
 * @param {ChatMessage|null} opts.sourceMessage  the attack card, when there is one
 * @param {number} [opts.attackIndex]
 * @param {object} [opts.rollData]  the attacker's, for `@` references in a damage formula
 * @returns {Promise<object|null>} the execution record, ready to store on the card
 */
export async function resolveExecution(entry, { sourceMessage = null, attackIndex = 0, rollData = {} } = {}) {
  if (!hasMechanics(entry)) return null;

  const branches = await resolveBranches(entry, { rollData });

  /* The DC every save on this card is rolled against, and the `saveDC` every buff it delivers is
   * stamped with: the attack's pre-reduction, non-critical damage (§6). Read as the normal parts of
   * the attack that critted rather than as "the card's damage total", so that switching crit-damage
   * suppression off cannot quietly redefine it. */
  const damage = sourceMessage ? normalDamageTotal(sourceMessage, attackIndex) : null;

  let save = null;
  if (branches.save) {
    let dc = saveDC(sourceMessage, attackIndex, branches.save);
    // No attack behind this resolution — §7.5's hand-driven case. Ask rather than invent: a DC
    // fabricated from the Critical Power total would look derived and be wrong.
    if (dc == null) dc = await promptForDC({ multiplier: branches.save, entryName: entry?.name });
    if (dc != null) save = { type: "fort", dc, multiplier: branches.save };
  }

  return {
    save,
    /* The fallback stamp for entries with no save of their own. A buff's own recovery check should
     * be as hard as the critical that caused it, so where this critical DID set a DC the buff gets
     * that one (including a doubled one) and otherwise it gets the raw damage. */
    saveDC: damage,
    /* §8.1's two inputs, read here because this is where the attack card is still in hand. Both are
     * about the *blow*, not the entry, so they are resolved once and carried rather than looked up
     * again from a button click that may happen an hour later on a different client. */
    blow: sourceMessage ? blowDamage(sourceMessage, attackIndex) : [],
    saved: branches.saved,
    failed: branches.failed,
    sharedDamage: branches.sharedDamage,
  };
}

/** Whether an entry has anything for the execution block to draw at all. */
export function hasMechanics(entry) {
  if (!entry) return false;
  return !!(
    entry.buffs?.length || entry.conditions?.length || entry.damage?.length ||
    entry.setHP != null || entry.negativeLevels != null ||
    entry.save || entry.onFail
  );
}

/**
 * Put the save and the apply buttons on the card.
 *
 * Split from `resolveExecution` because the record has to be written between the two: the buttons
 * carry the save DC onto the buffs they deliver, and `postSave` embeds onto the message the record
 * now lives on.
 *
 * @param {ChatMessage} message
 * @param {object} execution
 * @param {object} opts
 * @param {string} opts.scope           the result block's class, for the button mounts
 * @param {object} opts.target          { actorId, tokenId }
 * @param {string|null} [opts.sourceActorId]
 * @param {string|null} [opts.actionType]  PF1's action type, for §8.1's held/unheld split
 */
export async function attachExecution(
  message,
  execution,
  { scope, target = {}, sourceActorId = null, actionType = null } = {}
) {
  if (!message || !execution) return;

  if (execution.save?.dc) {
    await postSave(message, { dc: execution.save.dc, token: tokenOf(target) });
  }

  await offerApplyButtons(message, { execution, scope, target, sourceActorId, actionType });
}

/** The victim's token, if it is still on the scene — the save is addressed to a token, not an actor. */
function tokenOf({ tokenId = null } = {}) {
  if (!tokenId) return null;
  return canvas.scene?.tokens?.get(tokenId) ?? null;
}

/**
 * The roll data a damage formula is evaluated against: the attacker's.
 *
 * §6 — the effect is something they did, so `@attributes.hd.total` and friends are theirs. Falls
 * back to an empty object rather than to the victim's, because a formula silently reading the wrong
 * creature's numbers is worse than one that reads none.
 */
export function attackerRollData(actorId) {
  if (!actorId) return {};
  try {
    return game.actors.get(actorId)?.getRollData() ?? {};
  } catch (err) {
    console.error(`${MODULE_ID} | could not read the attacker's roll data:`, err);
    return {};
  }
}
