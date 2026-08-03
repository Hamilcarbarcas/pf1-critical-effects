/* The confirmation explosion (concept §4.2, DESIGN.md §7.2).
 *
 * "If a confirmation roll is itself within the threat range, Critical Power goes up a tier and the
 * confirmation is rolled again, repeating until it doesn't threaten."
 *
 * This is a property of dice that have already been thrown, not a decision anyone makes, so it
 * belongs with the attack roll rather than in the resolution dialog. It used to be a dialog stage
 * that rolled a FRESH d20 and tested that — which ignored PF1's actual confirmation entirely, so a
 * confirmation of 7 could still "explode" on the dialog's own new die.
 *
 * ── Where it runs ───────────────────────────────────────────────────────────
 * `pf1PostActionUse`, not a libWrapper. By then PF1 has rolled and animated the attack and its
 * confirmation, so the extra dice land after them in the right order, and the message exists to
 * record the count on. Rolling inside `addAttack` instead would put our dice on screen before the
 * confirmation that caused them.
 *
 * ── What it can and cannot fire on ──────────────────────────────────────────
 * Only attacks, by construction rather than by a check: it reads `chatAttack.critConfirm`, which
 * only exists inside the action-use attack pipeline. Skill checks, saves and ability checks never
 * produce one. PF1 also excludes combat maneuvers from crit confirmation
 * (`!this.action.isCombatManeuver`, chat-attack.mjs ~200), so CMB attacks cannot explode either.
 *
 * A natural 1 cannot explode: the fumble path fabricates a confirmation on one, and a fumble is
 * not a threat.
 */

import { MODULE_ID } from "../const.mjs";
import { suppressionEnabled } from "../integrations/pf1-pipeline.mjs";
import { setExplosions } from "../chat/card-mutate.mjs";

/** A keen weapon with a wide threat range can chain for a while; a runaway loop is a bug. */
const CAP = 10;

/**
 * Roll the explosion chain for one attack.
 *
 * The re-roll reuses the confirmation's own formula, which already carries every bonus that
 * applied to it — and, because the d20 override was stripped when PF1 built it
 * (pf1-pipeline.mjs), already has a plain d20 in front. Rebuilding the formula from parts would
 * have to re-derive both.
 *
 * @returns {Promise<{ count: number, rolls: Roll[] }>}
 */
export async function explodeFor(chatAttack, critRange) {
  if (!chatAttack?.hasCritConfirm) return { count: 0, rolls: [] };

  // The fumble path fabricates a confirmation on a natural 1 so it renders; a fumble is not a
  // threat, and whatever that confirmation rolls must not start a chain.
  if (chatAttack.attack?.isNat1) return { count: 0, rolls: [] };

  const first = chatAttack.critConfirm;
  if (!first?.isCrit) return { count: 0, rolls: [] };

  const rolls = [];
  let previous = first;

  // `count` is the number of CONFIRMATIONS that came up a threat, which is what the card reports
  // and what the resolution turns into grade shifts. The first one is already known to be a
  // threat, so it counts, and each re-roll that threatens adds another.
  let count = 0;

  while (previous?.isCrit && count < CAP) {
    count++;

    const roll = new pf1.dice.D20RollPF(first.formula, chatAttack.rollData, { critical: critRange });
    await roll.evaluate();
    roll.options.flavor = game.i18n.localize("PF1.CriticalConfirmation");
    rolls.push(roll);
    previous = roll;
  }

  if (count >= CAP) {
    ui.notifications.warn(`${MODULE_ID}: the confirmation explosion hit its ${CAP}-iteration cap.`);
  }

  return { count, rolls };
}

/** Show the extra dice, as one throw, the same way PF1 shows its own pools. */
async function animate(rolls) {
  if (!game.dice3d || !rolls.length) return;
  const pool = new foundry.dice.terms.PoolTerm();
  pool.rolls.push(...rolls);
  await game.dice3d.showForRoll(pool, game.user, true);
}

async function onActionUse(actionUse, message) {
  if (!message || !suppressionEnabled()) return;

  const critRange = actionUse?.shared?.action?.critRange ?? 20;
  const counts = {};

  for (const [index, atk] of (actionUse?.shared?.attacks ?? []).entries()) {
    const { count, rolls } = await explodeFor(atk.chatAttack, critRange);
    if (!count) continue;

    await animate(rolls);
    counts[index] = count;
  }

  if (Object.keys(counts).length) await setExplosions(message, counts);
}

export function registerExplosion() {
  Hooks.on("pf1PostActionUse", async (actionUse, message) => {
    try {
      await onActionUse(actionUse, message);
    } catch (err) {
      console.error(`${MODULE_ID} | confirmation explosion failed:`, err);
    }
  });
}
