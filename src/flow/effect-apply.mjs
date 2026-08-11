/* The mechanical half of an effect: apply buttons and damage anchors on the chat card (§6, §7.6).
 *
 * An entry has three independent mechanical channels, and the split is about what each is good for:
 *
 *   `buff`        an Item with changes, context notes and a healing lifecycle. Delivered by
 *                 astora-mod, which is where the delivery logic already lives.
 *   `conditions`  PF1 statuses, applied natively with their own durations (resolve/conditions.mjs).
 *                 No dependency at all — this half works in a bare PF1 world.
 *   `damage`      a damage instance of the effect's own, applied through PF1 (resolve/damage.mjs).
 *
 * Over the three sits an optional Fortitude save, which splits the entry into two **branches**.
 *
 * ── One button per branch, and both of them always ──────────────────────────
 * Buff and conditions are offered together, per branch. The GM's decision is "did this land", not
 * "did the buff half of this land"; a card with `Apply Broken Arm` and `Apply Conditions` side by
 * side invites applying half a critical, which no entry is written to mean.
 *
 * When there is a save, BOTH branch buttons are live regardless of what the save rolled. That is
 * deliberate (§6, "Both branches, always"): a luck point spent to turn a failure into a success, a
 * GM deciding an NPC eats the full result anyway, a save rolled late or by the wrong person — every
 * one of those is the table outranking the die, and a card that has decided which button is legal
 * has taken that call away.
 *
 * ── Damage is not on that button ────────────────────────────────────────────
 * Applying damage is a separate decision with its own dialog, its own reduction handling and its
 * own notion of who is selected — the one channel PF1 already has an answer for. So it keeps PF1's
 * two hammer anchors, in the damage table's own header, and this file only handles the click.
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
 * names itself, shows its prose, applies its conditions and rolls its damage — the §0 rule that
 * absence degrades an entry, never the engine.
 */

import { MODULE_ID } from "../const.mjs";
import { registerButtonType, addButtons } from "../chat/card-buttons.mjs";
import { mountFor } from "../chat/effect-block.mjs";
import { applyConditions, describeConditions } from "../resolve/conditions.mjs";
import { damageInstances, halfOf } from "../resolve/damage.mjs";

const BUTTON_TYPE = "apply-effect";

/** astora-mod's buff delivery API, or null when it isn't there to ask. */
export function buffDelivery() {
  if (!game.modules.get("astora-mod")?.active) return null;
  return game.astoraMod?.buffDelivery ?? null;
}

/** Which halves of a branch can actually be applied here and now. */
function deliverable(branch) {
  return {
    // A buff is only offered when it can be delivered. A button that reports "astora-mod isn't
    // installed" on every click is worse than no button: the header still shows what the buff was
    // and the prose still says what happened, which is what a world without astora signed up for.
    buff: branch?.buffName && buffDelivery() ? branch.buffName : null,
    conditions: branch?.conditions?.length ? branch.conditions : [],
  };
}

/**
 * Offer the apply buttons for a resolved execution — one per branch that has anything to apply.
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
 * @param {object} opts.execution  the stored execution record (branches, save, damage)
 * @param {string} opts.scope      the result block's class, for the mount selectors
 * @param {object} opts.target     { actorId, tokenId } from the resolution's display snapshot
 * @param {string} [opts.sourceActorId]  the attacker, stamped onto the buff
 */
export async function offerApplyButtons(message, { execution, scope, target = {}, sourceActorId = null } = {}) {
  if (!message || !execution) return;

  const branched = !!execution.failed;
  const descriptors = [];

  for (const key of ["saved", "failed"]) {
    const branch = execution[key];
    if (!branch) continue;

    const { buff, conditions } = deliverable(branch);
    if (!buff && !conditions.length) continue;

    /* Named for what it will do, so a GM knows before clicking. The buff half leads when there is
     * one — it is the heavier of the two — and conditions alone name themselves. With two branches
     * the outcome is prefixed, because on this card the question is not only *what* but *which*. */
    const what = buff ? `Apply ${buff}` : `Apply ${describeConditions(conditions)}`;
    const label = branched ? `${key === "saved" ? "Saved" : "Failed"} · ${what}` : what;

    descriptors.push({
      type: BUTTON_TYPE,
      label,
      icon: "fa-solid fa-wand-sparkles",
      mount: mountFor(scope, key, branched),
      /* GM-only, and not by preference — creating an item or an active effect on an actor the
       * clicker does not own requires a GM, and the target of a critical usually is not theirs. The
       * alternative would be proxying this over the module's socket, which §0 forbids: the socket
       * carries generic primitives only, never a handler for one feature. */
      gmOnly: true,
      data: {
        branch: key,
        buffName: buff,
        conditions,
        targetActorId: target.actorId ?? null,
        targetTokenId: target.tokenId ?? null,
        sourceActorId,
        /* The DC this critical's own save was set at, stamped onto whatever buff this delivers.
         * Every delivered buff gets one whether or not the entry had a save, because injury buffs
         * DC their own recovery checks against it — one derivation, one name (§6). */
        saveDC: execution.save?.dc ?? execution.saveDC ?? null,
      },
    });
  }

  if (descriptors.length) await addButtons(message, descriptors);
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
       * prompt asks.
       *
       * `saveDC` is a first-class field of the delivery payload: `buildStamp` puts it on the
       * applied buff as `@sourceInfo.saveDC` and mirrors it into a real dictionary flag as
       * `@dFlags.<buffTag>.saveDC`, which is the spelling that survives the hop into a
       * roll-bonuses conditional. Passed at delivery so the buff's own create/toggle scripts can
       * read it — setting it afterwards would be a frame too late for them. */
      const buff = await api.applyBuffTo(
        actor,
        {
          buffName: data.buffName,
          sourceActorId: data.sourceActorId ?? undefined,
          ...(Number.isFinite(data.saveDC) ? { saveDC: data.saveDC } : {}),
        },
        { interactive: true }
      );
      // A null return means applyBuffTo already said why in a notification of its own.
      if (buff) applied.push(buff.name);
    }
  }

  if (applied.length) ui.notifications.info(`${MODULE_ID}: ${actor.name} — ${applied.join("; ")}.`);
}

/* --- effect damage ----------------------------------------------------------
 *
 * The click behind the two hammer anchors the execution block draws. Ours rather than PF1's for
 * two reasons, and neither is preference:
 *
 *   - PF1's handler reads `attackIndex` off `button.closest("[data-index]")` and builds typed
 *     instances from `message.systemRolls.attacks[i]` (utils/chat.mjs ~434). On an attack card that
 *     would silently apply this damage with the *attack's* damage types and reduction; on a
 *     standalone result card there are no instances at all.
 *   - The anchors deliberately carry no `data-action`, so PF1's blanket `a[data-action]` binder
 *     does not fire on them as well as us.
 *
 * What we do call is `ActorPF.applyDamage` — the **static**, not the instance method. That is what
 * Little Helper wraps with libWrapper for its untargeted-apply confirmation, so routing through it
 * and passing `message` earns that dialog with no work. Damage lands on the canvas selection, like
 * any other damage row on any other card: the point of that confirmation is that a GM sometimes
 * means to hit someone else.
 */
async function applyEffectDamage(event, message, getExecution) {
  const anchor = event.currentTarget;
  const branch = anchor.dataset.branch ?? "saved";
  const ratio = Number(anchor.dataset.ratio) || 1;

  const damage = getExecution(message)?.[branch]?.damage;
  if (!damage?.parts?.length) {
    ui.notifications.warn(`${MODULE_ID}: that damage is no longer on this card.`);
    return;
  }

  const value = ratio === 0.5 ? halfOf(damage.total) : damage.total;
  if (!value) return;

  try {
    await pf1.documents.actor.ActorPF.applyDamage(value, {
      event,
      element: anchor,
      message,
      reference: message.uuid,
      instances: damageInstances(damage.parts),
      // Not PF1's critical damage — this is the effect's own instance, and a critMult applied to it
      // would multiply something that was never multiplied in the first place.
      isCritical: false,
      critMult: 0,
      interactive: true,
    });
  } catch (err) {
    // "No valid targets" throws rather than returning, and is a user error, not a fault.
    if (String(err?.message).includes("No valid targets")) return;
    console.error(`${MODULE_ID} | applying effect damage failed:`, err);
    ui.notifications.error(`${MODULE_ID}: that damage could not be applied — see the console.`);
  }
}

/**
 * Bind the damage anchors a result block just drew.
 *
 * Called by the block's own render hook rather than by a delegated document-level listener, because
 * the anchors are recreated on every render and a stale delegate would outlive the card.
 *
 * @param {HTMLElement} root  the rendered message element
 * @param {ChatMessage} message
 * @param {(message: ChatMessage) => object|null} getExecution  reads the stored record back
 */
export function bindDamageAnchors(root, message, getExecution) {
  for (const anchor of root.querySelectorAll('[data-ce-action="applyDamage"]')) {
    if (anchor.dataset.ceBound) continue;
    anchor.dataset.ceBound = "1";
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      applyEffectDamage(event, message, getExecution);
    });
  }
}

export function registerEffectApply() {
  registerButtonType(BUTTON_TYPE, applyEffect);
}
