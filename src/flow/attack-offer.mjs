/* The crit and fumble buttons on an attack card, offered or withdrawn after it posted (DESIGN.md §7.8).
 *
 * The action-time triggers (crit-trigger.mjs, fumble-flow.mjs) attach their buttons from the live
 * action use. A d20 changed later — astora-mod's roll amendments reroll an attack into a threat or
 * a natural 1, or out of one — has no action use left to read, so the same descriptors are built
 * here from the card's stored metadata instead.
 */

import { updateButtons } from "../chat/card-buttons.mjs";
import { inferAttackType } from "./fumble-flow.mjs";

const TYPES = { crit: "resolve-crit", fumble: "resolve-fumble" };

function cardAction(message) {
  const actorUuid = message?.system?.actor;
  const actor = (actorUuid ? fromUuidSync(actorUuid) : null) ?? ChatMessage.getSpeakerActor(message?.speaker);
  const item = actor?.items?.get(message?.system?.item?.id) ?? null;
  const action = item?.actions?.get(message?.system?.action?.id) ?? item?.defaultAction ?? null;
  return { actor, item, action };
}

function cardTargets(message) {
  return (message?.system?.targets ?? []).map((uuid) => fromUuidSync(uuid)).filter(Boolean);
}

function critDescriptor(message, attackIndex) {
  const targets = cardTargets(message);
  const { action } = cardAction(message);
  return {
    type: TYPES.crit,
    label: "Critical Effect",
    icon: "fa-solid fa-burst",
    gmOnly: true,
    data: {
      targetTokenId: targets[0]?.id ?? null,
      critMult: message?.system?.config?.critMult ?? action?.data?.ability?.critMult ?? 2,
      attackIndex,
      threatCount: 1,
      targetCount: targets.length,
    },
  };
}

function fumbleDescriptor(message) {
  const { item, action } = cardAction(message);
  return {
    type: TYPES.fumble,
    label: game.i18n.localize("CRITICAL_EFFECTS.Fumble.ResolveButton"),
    icon: "fa-solid fa-face-dizzy",
    gmOnly: true,
    data: {
      attackType: inferAttackType(item, action),
      tokenId: message?.speaker?.token ?? null,
      count: 1,
      itemId: item?.id ?? null,
      actionId: action?.id ?? null,
      defenderTokenUuid: cardTargets(message)[0]?.uuid ?? null,
    },
  };
}

/**
 * Add the crit or fumble button to an attack card that didn't get one. A card already carrying
 * that button keeps it as it is: one per card, as at action time.
 *
 * @param {ChatMessage} message  the attack card
 * @param {object} opts
 * @param {"crit"|"fumble"} opts.kind
 * @param {number} [opts.attackIndex=0]  the attack that now threatens (crit only)
 */
export function offerAttackButton(message, { kind, attackIndex = 0 } = {}) {
  const type = TYPES[kind];
  if (!message || !type) return;
  return updateButtons(message, (list) => {
    if (list.some((d) => d.type === type)) return;
    const descriptor = kind === "crit" ? critDescriptor(message, attackIndex) : fumbleDescriptor(message);
    return [...list, { id: foundry.utils.randomID(), ...descriptor }];
  });
}

/**
 * Take the button back when the attack no longer threatens or fumbles. The crit button goes only
 * if it was seeded by that attack; the fumble button counts its natural 1s and goes with the last.
 *
 * @param {ChatMessage} message
 * @param {object} opts
 * @param {"crit"|"fumble"} opts.kind
 * @param {number} [opts.attackIndex=0]
 */
export function withdrawAttackButton(message, { kind, attackIndex = 0 } = {}) {
  const type = TYPES[kind];
  if (!message || !type) return;
  return updateButtons(message, (list) => {
    if (kind === "crit") {
      const next = list.filter((d) => !(d.type === type && (d.data?.attackIndex ?? 0) === attackIndex));
      return next.length === list.length ? undefined : next;
    }
    const fumble = list.find((d) => d.type === type);
    if (!fumble) return;
    const count = Number(fumble.data?.count) || 1;
    if (count > 1) {
      fumble.data.count = count - 1;
      return list;
    }
    return list.filter((d) => d !== fumble);
  });
}
