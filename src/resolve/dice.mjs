/* Showing dice for rolls this module made itself.
 *
 * Every roll here is evaluated in code and stored, not sent to chat as a roll message — so nothing
 * animates unless we ask. `showForRoll` is that ask, and it is the same call PF1 makes for an
 * action's own dice (action-use.mjs), so ours land looking like the system's.
 *
 * ── Pooled, always ──────────────────────────────────────────────────────────
 * One `PoolTerm` per *event*, not per roll. Three separate calls animate three times in sequence,
 * which reads as three things happening when a critical's damage, or a pair of condition durations,
 * is one thing happening. Callers therefore collect their rolls and call this once at the end.
 *
 * Broadcast to every client (`synchronize`), because these rolls decide something the table can see
 * on the card a moment later — how much damage, how many rounds — and a die only the GM watched is
 * a number the players are simply told.
 */

import { MODULE_ID } from "../const.mjs";

/**
 * Animate a set of rolls as one throw. Awaited, so a caller can let the dice settle before the
 * thing they decided lands.
 *
 * Rolls with no dice in them are dropped rather than pooled: a duration authored as the string
 * `"3"` is a Roll with no dice terms, and asking DSN to animate nothing produces either an empty
 * throw or an error depending on the version. Filtering here means callers never have to care
 * whether an author wrote a formula or a number.
 *
 * @param {Roll[]} rolls
 */
export async function showDice(rolls) {
  if (!game.dice3d) return;

  const withDice = (rolls ?? []).filter((roll) => roll?.dice?.length);
  if (!withDice.length) return;

  try {
    const pool = new foundry.dice.terms.PoolTerm();
    pool.rolls.push(...withDice);
    await game.dice3d.showForRoll(pool, game.user, true);
  } catch (err) {
    // Never fatal. A missed animation costs nothing; a throw here would abort the apply that was
    // about to happen.
    console.error(`${MODULE_ID} | could not show dice:`, err);
  }
}
