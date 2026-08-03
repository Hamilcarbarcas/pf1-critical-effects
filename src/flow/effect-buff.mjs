/* The mechanical half of an effect: an apply-buff button on the attack card (DESIGN.md §6).
 *
 * This replaces the typed-outcome framework that used to live in `outcomes/`. That framework was
 * built for a world where an entry carried an array of descriptors — buff, condition, note,
 * delegate — each with its own handler and its own undo. In practice one type carries all of the
 * mechanics (`buff`), conditions are better expressed as an enricher in the journal prose, and a
 * note is text. A registry, four handlers and a reversible-descriptor protocol was a lot of
 * machinery for "create this buff".
 *
 * ── Why the button and not the dialog ───────────────────────────────────────
 * The resolution dialog is GM-only and closes on Confirm. A buff that is applied from it leaves no
 * trace anyone else can see, and no way to apply it a moment later once the GM has decided the
 * save landed. On the card it is where the effect already is, next to the journal link, for as
 * long as the card exists.
 *
 * ── Why astora-mod does the work ────────────────────────────────────────────
 * `buffDelivery.applyBuffTo` is not just "copy an item onto an actor". It finds the buff on the
 * actor first and prompts Refresh / Overwrite / Ignore when it is already there; it preserves
 * `system.links`, which a plain `toObject()` copy silently strips (the old `buff` handler here did
 * exactly that, and so does Little Helper's own apply); and it stamps source info the buff's own
 * script calls can read. Re-implementing that would be re-implementing astora's buff system.
 *
 * The coupling is contained: this file is the only one that knows astora exists, the button is
 * only offered when it is installed, and an entry whose buff cannot be delivered still resolves,
 * names itself and links its journal — the §0 rule that absence degrades an entry, never the
 * engine.
 */

import { MODULE_ID } from "../const.mjs";
import { registerButtonType, addButtons } from "../chat/card-buttons.mjs";

const BUTTON_TYPE = "apply-effect-buff";

/** astora-mod's buff delivery API, or null when it isn't there to ask. */
export function buffDelivery() {
  if (!game.modules.get("astora-mod")?.active) return null;
  return game.astoraMod?.buffDelivery ?? null;
}

/**
 * Offer the buff an effect carries, on the card the resolution was recorded to.
 *
 * Buffs are addressed **by name**, not by uuid, because that is what `applyBuffTo` takes and
 * because a name survives things a uuid does not: the packs are LevelDB and ids change when a pack
 * is recompiled, and the GM may keep their buffs in a pack of their own. Name lookup also finds a
 * copy already on the actor, which is what makes Refresh work.
 *
 * @param {ChatMessage} message
 * @param {object} opts
 * @param {object} opts.entry   the catalog entry that was drawn
 * @param {object} opts.target  { actorId, tokenId } from the resolution's display snapshot
 * @param {string} [opts.sourceActorId]  the attacker, stamped onto the buff
 */
export async function offerBuffButton(message, { entry, target = {}, sourceActorId = null } = {}) {
  if (!message || !entry?.buff) return;

  // Offered only when it can actually be delivered. A button that reports "astora-mod isn't
  // installed" on every click is worse than no button: the journal link and the note still say
  // what happened, which is what a world without astora-mod signed up for.
  if (!buffDelivery()) return;

  await addButtons(message, [{
    type: BUTTON_TYPE,
    label: `Apply ${entry.buff}`,
    icon: "fa-solid fa-wand-sparkles",
    /* GM-only, and not by preference — creating an item on an actor the clicker does not own
     * requires a GM, and the target of a critical usually is not theirs. The alternative would be
     * proxying `applyBuffTo` over this module's socket, which §0 forbids: the socket carries
     * generic primitives only, never a handler for one feature. */
    gmOnly: true,
    data: {
      buffName: entry.buff,
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

async function applyEffectBuff(descriptor) {
  const api = buffDelivery();
  if (!api?.applyBuffTo) {
    ui.notifications.warn(`${MODULE_ID}: astora-mod's buff delivery is not available.`);
    return;
  }

  const data = descriptor?.data ?? {};
  const actor = resolveTarget(data);
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID}: the target of that critical is no longer available.`);
    return;
  }

  /* `interactive` is left on deliberately. If the buff is already on the target — a second broken
   * arm, a crit on a creature that has one — the GM is the one who should decide between
   * refreshing it and stacking a fresh copy, and that decision is exactly what the prompt asks. */
  const buff = await api.applyBuffTo(
    actor,
    { buffName: data.buffName, sourceActorId: data.sourceActorId ?? undefined },
    { interactive: true }
  );

  // A null return means applyBuffTo already said why in a notification of its own.
  if (buff) ui.notifications.info(`${MODULE_ID}: applied ${buff.name} to ${actor.name}.`);
}

export function registerEffectBuff() {
  registerButtonType(BUTTON_TYPE, applyEffectBuff);
}
