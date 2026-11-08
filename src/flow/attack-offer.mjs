/* The crit and fumble buttons on an attack card, offered or withdrawn after it posted (DESIGN.md §7.8).
 *
 * The action-time triggers (crit-trigger.mjs, fumble-flow.mjs) attach their buttons from the live
 * action use. A d20 changed later — astora-mod's roll amendments reroll an attack into a threat or
 * a natural 1, or out of one — has no action use left to read, so the same descriptors are built
 * here from the card's stored metadata instead.
 */

import { updateButtons } from "../chat/card-buttons.mjs";
import { inferAttackType } from "./fumble-flow.mjs";
import { dropPendingConfirmation } from "./confirm-deferral.mjs";

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
      indices: [attackIndex],
      threatCount: 1,
      targetCount: targets.length,
    },
  };
}

function fumbleDescriptor(message, attackIndex) {
  const { item, action } = cardAction(message);
  return {
    type: TYPES.fumble,
    label: game.i18n.localize("CRITICAL_EFFECTS.Fumble.ResolveButton"),
    icon: "fa-solid fa-face-dizzy",
    gmOnly: true,
    data: {
      attackType: inferAttackType(item, action),
      tokenId: message?.speaker?.token ?? null,
      indices: [attackIndex],
      count: 1,
      itemId: item?.id ?? null,
      actionId: action?.id ?? null,
      defenderTokenUuid: cardTargets(message)[0]?.uuid ?? null,
    },
  };
}

/* §7.8: one button per kind, covering the attacks in `data.indices`. The crit button resolves the
 * first of them; `count` / `threatCount` mirror the list's length. */
function setIndices(descriptor, indices) {
  descriptor.data.indices = indices;
  if (descriptor.type === TYPES.crit) {
    descriptor.data.attackIndex = indices[0];
    descriptor.data.threatCount = indices.length;
  } else {
    descriptor.data.count = indices.length;
  }
}

/**
 * Add the crit or fumble button to an attack card, or add this attack to the one already there.
 *
 * @param {ChatMessage} message  the attack card
 * @param {object} opts
 * @param {"crit"|"fumble"} opts.kind
 * @param {number} [opts.attackIndex=0]  the attack that now threatens or fumbles
 */
export function offerAttackButton(message, { kind, attackIndex = 0 } = {}) {
  const type = TYPES[kind];
  if (!message || !type) return;
  return updateButtons(message, (list) => {
    const existing = list.find((d) => d.type === type);
    if (existing) {
      // Buttons from before `indices` existed carry no list; they keep their old behavior.
      const indices = existing.data?.indices;
      if (!Array.isArray(indices) || indices.includes(attackIndex)) return;
      setIndices(existing, [...indices, attackIndex].sort((a, b) => a - b));
      return list;
    }
    const descriptor = kind === "crit" ? critDescriptor(message, attackIndex) : fumbleDescriptor(message, attackIndex);
    return [...list, { id: foundry.utils.randomID(), ...descriptor }];
  });
}

/**
 * Take this attack off the crit or fumble button when it no longer threatens or fumbles; the
 * button goes with its last attack. Also drops the attack's confirmation if it was never rolled.
 *
 * @param {ChatMessage} message
 * @param {object} opts
 * @param {"crit"|"fumble"} opts.kind
 * @param {number} [opts.attackIndex=0]
 */
export function withdrawAttackButton(message, { kind, attackIndex = 0 } = {}) {
  const type = TYPES[kind];
  if (!message || !type) return;
  dropPendingConfirmation(message, attackIndex, { fumble: kind === "fumble" });
  return updateButtons(message, (list) => {
    const button = list.find((d) => d.type === type);
    if (!button) return;

    const indices = button.data?.indices;
    if (Array.isArray(indices)) {
      if (!indices.includes(attackIndex)) return;
      const rest = indices.filter((i) => i !== attackIndex);
      if (!rest.length) return list.filter((d) => d !== button);
      setIndices(button, rest);
      return list;
    }

    // Legacy buttons: crit seeded by one attack, fumble by a count.
    if (kind === "crit") {
      if ((button.data?.attackIndex ?? 0) !== attackIndex) return;
      return list.filter((d) => d !== button);
    }
    const count = Number(button.data?.count) || 1;
    if (count > 1) {
      button.data.count = count - 1;
      return list;
    }
    return list.filter((d) => d !== button);
  });
}
