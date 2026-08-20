/* Attack-card trigger for the automated crit flow (DESIGN.md §7.2, §11 phase 7).
 *
 * Watches action uses for a critical THREAT and offers to open a resolution. A threat is the
 * whole gate: the confirmation roll is displayed but never interpreted, exactly as a natural 1
 * is the whole gate on the fumble path. Deciding "did this confirm?" means reading a target's AC,
 * which is unavailable or ambiguous often enough (several targets, no target, touch/flat-footed,
 * DR) that a wrong automatic answer costs more than a button that goes unused.
 *
 * This is the last piece that was blocked on the pipeline work: everything it opens — the prompt
 * card, the resolve layer, the outcome framework — has been usable from the manual resolver
 * since phase 4.
 */

import { MODULE_ID } from "../const.mjs";
import { DAMAGE_TYPES } from "../catalog/schema.mjs";
import { registerButtonType, addButtons } from "../chat/card-buttons.mjs";
import { buildContext } from "../resolve/context.mjs";
import { isCritImmune, critImmunitySources } from "../integrations/defense-manager.mjs";
import { displayName } from "../integrations/token-randomizer.mjs";
import { startCritResolution } from "./crit-dialog.mjs";
import { offerLethalButton } from "./lethal.mjs";

const BUTTON_TYPE = "resolve-crit";

/* Every attack on this use that threatened a critical.
 *
 * The natural 1 exclusion is load-bearing, not defensive. `hasCritConfirm` is the right signal for
 * a threat, but the fumble path *fabricates* it: forceFumbleConfirmation() sets it on a natural 1
 * so the forced confirmation roll renders on the card. Without this filter a fumble reads as a
 * threat and offers a critical resolution. It is also simply true — a natural 1 is an automatic
 * miss and can never threaten — so the two paths stay mutually exclusive by definition. */
function threats(actionUse) {
  // The INDEX is carried along, not just the attack: it is the key into the card's
  // `system.rolls.attacks`, which is where deferred critical damage has to be written back (§9).
  return (actionUse?.shared?.attacks ?? [])
    .map((atk, index) => ({ atk, index }))
    .filter(({ atk }) => atk.chatAttack?.hasCritConfirm && !atk.chatAttack?.attack?.isNat1);
}

async function attachCritButton(actionUse, message) {
  if (!message) return; // hidden chat — nowhere to attach

  const found = threats(actionUse);
  if (!found.length) return;

  // The first threatening attack seeds the resolution; a full attack that threatens twice is a
  // GM call about which one to resolve, and re-running the button covers the second.
  const [{ atk: first, index }] = found;

  const targets = actionUse.shared?.targets ?? [];

  await addButtons(message, [{
    type: BUTTON_TYPE,
    label: "Critical Effect",
    icon: "fa-solid fa-burst",
    gmOnly: true,
    data: {
      targetTokenId: targets[0]?.id ?? null,
      critMult: first.chatAttack?.rollData?.critMult ?? actionUse.shared?.action?.data?.ability?.critMult ?? 2,
      attackIndex: index,
      threatCount: found.length,
      /* Carried so the immunity marking can tell "the one target" from "the first of several".
       * The descriptor only ever keeps `targets[0]`, so with two targets a marker on the button
       * would be a claim about a creature the button doesn't necessarily name. */
      targetCount: targets.length,
    },
  }]);
}

/**
 * Mark the button when its single target is designated immune to critical hits.
 *
 * A marking, never a gate — the button stays live and does exactly what it did before. PF1 has no
 * fortification handling, several published creatures are immune "except…", and the GM is the one
 * driving the resolution; what they need is to be told, not stopped.
 *
 * Runs at render, per client, so marking a creature immune after the card posted shows up the next
 * time the log draws it. Only the *recorded* target is consulted: the click-time fallbacks
 * (`game.user.targets`, the controlled token) differ per viewer, and a marker that meant a
 * different creature for each person reading the card would be worse than none.
 *
 * Cards posted before `targetCount` existed carry no count, so they are never marked — the right
 * answer, since "one target or several" is exactly what those cards cannot say.
 */
function decorateCritButton(button, descriptor) {
  const { targetTokenId, targetCount } = descriptor?.data ?? {};
  if (targetCount !== 1 || !targetTokenId) return;

  const token = canvas.scene?.tokens?.get(targetTokenId) ?? null;
  if (!token || !isCritImmune(token)) return;

  button.classList.add("ce-card-btn-immune");

  const sources = critImmunitySources(token);
  const name = displayName(token, token.actor?.name ?? "That creature");
  button.dataset.tooltip = sources.length
    ? `${name} is immune to critical hits (${sources.join(", ")}). Click to resolve anyway.`
    : `${name} is immune to critical hits. Click to resolve anyway.`;

  const flag = document.createElement("i");
  flag.className = "fa-solid fa-shield-halved ce-card-btn-immune-flag";
  button.append(flag);
}

/**
 * Open a resolution from the attack that produced this card.
 *
 * The context is built from the LIVE action rather than the stored card, so the resolve layer
 * gets the same quality of input the manual resolver gives it.
 */
async function resolveCrit(descriptor, { message }) {
  const actorUuid = message?.system?.actor;
  const actor = (actorUuid ? fromUuidSync(actorUuid) : null) ?? ChatMessage.getSpeakerActor(message?.speaker);
  const item = actor?.items?.get(message?.system?.item?.id) ?? null;
  const action = item?.actions?.get(message?.system?.action?.id) ?? item?.defaultAction ?? null;

  const target =
    (descriptor.data?.targetTokenId ? canvas.scene?.tokens?.get(descriptor.data.targetTokenId) : null) ??
    [...(game.user.targets ?? [])][0]?.document ??
    canvas.tokens?.controlled?.[0]?.document ??
    null;

  if (!target) {
    ui.notifications.warn(`${MODULE_ID}: target a token to resolve the critical against.`);
    return;
  }

  const context = buildContext({
    target,
    manual: {
      item,
      action,
      attackerActor: actor,
      critMult: descriptor.data?.critMult ?? message?.system?.config?.critMult ?? 2,
      damageType: damageTypeOf(action),
    },
  });

  await startCritResolution({
    context,
    sourceMessageId: message.id,
    attackIndex: descriptor.data?.attackIndex ?? 0,
  });
}

/**
 * The action's damage type, so the resolution starts on the right table.
 *
 * The FIRST type the action deals that we keep tables for. A flaming sword lists slashing before
 * fire, and slashing is what the blow does to a body; the GM can change it at the Location stage
 * when the fire is the point.
 *
 * Reads `part.types` — a Set of PF1 registry ids since v11. The deprecated `part.type.values`
 * accessor still works but logs a compatibility warning on every attack, and the ids it returns
 * are the same ones, so there is nothing to gain by going through it.
 */
function damageTypeOf(action) {
  for (const part of action?.data?.damage?.parts ?? []) {
    for (const type of part?.types ?? []) {
      if (DAMAGE_TYPES.includes(type)) return type;
    }
  }
  return null;
}

export function registerCritTrigger() {
  registerButtonType(BUTTON_TYPE, resolveCrit, { decorate: decorateCritButton });

  Hooks.on("pf1PostActionUse", async (actionUse, message) => {
    try {
      await attachCritButton(actionUse, message);
    } catch (err) {
      console.error(`${MODULE_ID} | attaching the critical button failed:`, err);
    }

    try {
      // Rides along here rather than in its own hook: same card, same moment (§7.4).
      await offerLethalButton(message);
    } catch (err) {
      console.error(`${MODULE_ID} | offering the lethal draw failed:`, err);
    }
  });
}
