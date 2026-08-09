/* The mechanical half of an effect: an apply button on the attack card (DESIGN.md §6).
 *
 * An entry has two independent mechanical channels, and the split is about what each is good for:
 *
 *   `buff`        an Item with changes, context notes and a healing lifecycle. Delivered by
 *                 astora-mod, which is where the delivery logic already lives.
 *   `conditions`  PF1 statuses, applied natively with their own durations (resolve/conditions.mjs).
 *                 No dependency at all — this half works in a bare PF1 world.
 *
 * They are offered by ONE button rather than two. The GM's decision is "did this land", not "did
 * the buff half of this land"; a card with `Apply Broken Arm` and `Apply Conditions` side by side
 * invites applying half a critical, which no entry is written to mean.
 *
 * ── Why a button and not the dialog ─────────────────────────────────────────
 * The resolution dialog is GM-only and closes on Confirm. Anything applied from it leaves no trace
 * anyone else can see, and no way to apply it a moment later once the GM has decided the save
 * landed. On the card it is where the effect already is, for as long as the card exists.
 *
 * ── Why astora-mod does the buff work ───────────────────────────────────────
 * `buffDelivery.applyBuffTo` is not just "copy an item onto an actor". It finds the buff on the
 * actor first and prompts Refresh / Overwrite / Ignore when it is already there; it preserves
 * `system.links`, which a plain `toObject()` copy silently strips; and it stamps source info the
 * buff's own script calls can read. Re-implementing that would be re-implementing astora's buff
 * system.
 *
 * The coupling is contained: this file is the only one that knows astora exists, the buff half is
 * skipped when it isn't installed, and an entry whose buff cannot be delivered still resolves,
 * names itself, shows its prose and applies its conditions — the §0 rule that absence degrades an
 * entry, never the engine.
 */

import { MODULE_ID } from "../const.mjs";
import { registerButtonType, addButtons } from "../chat/card-buttons.mjs";
import { applyConditions, describeConditions } from "../resolve/conditions.mjs";

const BUTTON_TYPE = "apply-effect";

/** astora-mod's buff delivery API, or null when it isn't there to ask. */
export function buffDelivery() {
  if (!game.modules.get("astora-mod")?.active) return null;
  return game.astoraMod?.buffDelivery ?? null;
}

/** Which halves of this entry can actually be applied here and now. */
function deliverable(entry) {
  return {
    // A buff is only offered when it can be delivered. A button that reports "astora-mod isn't
    // installed" on every click is worse than no button: the prose and the note still say what
    // happened, which is what a world without astora-mod signed up for.
    buff: entry?.buff && buffDelivery() ? entry.buff : null,
    conditions: entry?.conditions?.length ? entry.conditions : [],
  };
}

/**
 * Offer whatever mechanics an effect carries, on the card the resolution was recorded to.
 *
 * Buffs are addressed **by name**, not by uuid, because that is what `applyBuffTo` takes and
 * because a name survives things a uuid does not: the packs are LevelDB and ids change when a pack
 * is recompiled, and the GM may keep their buffs in a pack of their own. Name lookup also finds a
 * copy already on the actor, which is what makes Refresh work.
 *
 * Conditions travel on the descriptor rather than as an entry id, so a button on an old card still
 * applies what that card actually resolved even if the catalog has been re-authored since.
 *
 * @param {ChatMessage} message
 * @param {object} opts
 * @param {object} opts.entry   the catalog entry that was drawn
 * @param {object} opts.target  { actorId, tokenId } from the resolution's display snapshot
 * @param {string} [opts.sourceActorId]  the attacker, stamped onto the buff
 */
export async function offerApplyButton(message, { entry, target = {}, sourceActorId = null } = {}) {
  if (!message || !entry) return;

  const { buff, conditions } = deliverable(entry);
  if (!buff && !conditions.length) return;

  // Named for what it will do, so a GM knows before clicking. The buff half leads when there is
  // one — it is the heavier of the two — and conditions alone name themselves.
  const label = buff ? `Apply ${buff}` : `Apply ${describeConditions(conditions)}`;

  await addButtons(message, [{
    type: BUTTON_TYPE,
    label,
    icon: "fa-solid fa-wand-sparkles",
    /* GM-only, and not by preference — creating an item or an active effect on an actor the
     * clicker does not own requires a GM, and the target of a critical usually is not theirs. The
     * alternative would be proxying this over the module's socket, which §0 forbids: the socket
     * carries generic primitives only, never a handler for one feature. */
    gmOnly: true,
    data: {
      buffName: buff,
      conditions,
      entryId: entry.id,
      targetActorId: target.actorId ?? null,
      targetTokenId: target.tokenId ?? null,
      sourceActorId,
    },
  }]);
}

/** The token's actor if it is still on the scene, else the base actor. */
function resolveTarget({ targetTokenId, targetActorId }) {
  const token = targetTokenId ? canvas.scene?.tokens?.get(targetTokenId) : null;
  return token?.actor ?? (targetActorId ? game.actors.get(targetActorId) : null);
}

async function applyEffect(descriptor) {
  const data = descriptor?.data ?? {};
  const actor = resolveTarget(data);
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID}: the target of that critical is no longer available.`);
    return;
  }

  const applied = [];

  /* Conditions first. They are the half that cannot prompt, so they land before the buff delivery
   * dialog takes the GM's attention — and if the GM cancels that dialog, the conditions the
   * critical inflicted are still on the target rather than lost with it. */
  applied.push(...(await applyConditions(actor, data.conditions)));

  if (data.buffName) {
    const api = buffDelivery();
    if (!api?.applyBuffTo) {
      ui.notifications.warn(`${MODULE_ID}: astora-mod's buff delivery is not available.`);
    } else {
      /* `interactive` is left on deliberately. If the buff is already on the target — a second
       * broken arm, a crit on a creature that has one — the GM is the one who should decide
       * between refreshing it and stacking a fresh copy, and that decision is exactly what the
       * prompt asks. */
      const buff = await api.applyBuffTo(
        actor,
        { buffName: data.buffName, sourceActorId: data.sourceActorId ?? undefined },
        { interactive: true }
      );
      // A null return means applyBuffTo already said why in a notification of its own.
      if (buff) applied.push(buff.name);
    }
  }

  if (applied.length) ui.notifications.info(`${MODULE_ID}: ${actor.name} — ${applied.join("; ")}.`);
}

export function registerEffectApply() {
  registerButtonType(BUTTON_TYPE, applyEffect);
}
