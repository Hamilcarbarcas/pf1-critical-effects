/* The "an attack card just posted" moment, under both ways a full attack can be rolled.
 *
 * Normally that is `pf1PostActionUse`: one use, one card, and `shared.attacks[i]` is attack `i` on
 * that card. pf1-sequential-attacks breaks that pairing — it posts a card per attack (or per
 * "Roll All Remaining" batch) and fires `pf1PostActionUse` once at the end with only the LAST card
 * and the whole sequence's attack list. An index read off that list names the wrong row on the
 * wrong card, which is how a second-attack crit ended up storing its damage on attack 1 of a card
 * that only has attack 0.
 *
 * So under sequential mode the handlers run from that module's per-card hook instead, where
 * `shared.attacks` holds exactly the card's own attacks in the card's order. The end-of-sequence
 * `pf1PostActionUse` is recognised by `shared.sequentialAttack`, which core never sets, and skipped
 * — each card has already been handled once.
 */

const CARD_HOOK = "pf1SequentialAttacks.postCard";

/**
 * Register `fn(actionUse, message)` to run once per posted attack card.
 * @param {(actionUse: ActionUse, message: ChatMessage|null) => Promise<void>|void} fn
 */
export function onAttackCard(fn) {
  Hooks.on("pf1PostActionUse", (actionUse, message) => {
    if (actionUse?.shared?.sequentialAttack) return; // handled per card below
    return fn(actionUse, message);
  });
  Hooks.on(CARD_HOOK, fn);
}
