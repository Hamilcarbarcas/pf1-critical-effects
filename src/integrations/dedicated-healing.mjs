/* Dedicated healing (DESIGN.md §8) — migrated out of astora-mod.
 *
 * A house rule: some conditions (broken bones, mostly) can't simply be healed away. They must
 * first be *treated* (a Heal check), after which they absorb a threshold of healing before
 * clearing — healing that would otherwise have gone to hit points.
 *
 * It lives here because its only consumers are critical-effect buffs. After this migration a
 * broken-bone effect works with astora-mod absent, which is what moves it out of §0's
 * "content-coupled" column and into the module proper.
 *
 * ── What the migration actually changed ─────────────────────────────────────
 *   - the socket channel (`module.astora-mod` -> `module.pf1-critical-effects`), which had to
 *     move together with its listener;
 *   - the GM proxy for the Heal-check roll request, now this module's own socket;
 *   - the API surface (`game.criticalEffects.dedicatedHealing`), which the bone buffs' script
 *     calls invoke — so the buff migration and this one land in the same change;
 *   - `renderTemplate`, which is namespaced in v13.
 *
 * The mechanics are otherwise untouched.
 */

import { MODULE_ID } from "../const.mjs";
import { gmRequest } from "./socket.mjs";

const TEMPLATE = `modules/${MODULE_ID}/src/chat/dedicated-healing-dialog.hbs`;
const CHANNEL = `module.${MODULE_ID}`;

// Item flag key names (item.system.flags.dictionary / .boolean)
const F_DC       = "dhDC";           // dict: heal check DC (0 = no check needed)
const F_REQUIRED = "dhRequired";     // dict: HP needed to cure
const F_RECEIVED = "dhReceived";     // dict: HP accumulated (runtime)
const F_SUCCESS  = "dhCheckSuccess"; // bool: check passed, ready for healing

/* Whoever should be shown the allocation dialog, when the heal is applied by someone else — a GM
 * resolving a short rest on a player's behalf, for instance. astora-mod's rest manager sets this
 * on the applyDamage options; the legacy spelling is still honoured so an existing macro or an
 * un-updated caller keeps working. */
const DELEGATE_KEY = "healDelegate";
const LEGACY_DELEGATE_KEY = "astoraHealDelegate";

// ─── Module-level state ───────────────────────────────────────────────────────

let _bypassHealingIntercept = false; // Prevents recursion when re-applying HP
let _dialogOpen = false;             // Prevents stacking dialogs from rapid heals

// ─── Phase 1: Condition Treatment (use script entry point) ───────────────────

export async function requestBoneSetting(actor, item) {
  const required = item.getItemDictionaryFlag(F_REQUIRED) ?? 0;
  if (!required) return;

  if (item.hasItemBooleanFlag(F_SUCCESS)) {
    ui.notifications.warn(`${item.name}: Condition already treated — awaiting dedicated healing.`);
    return;
  }

  const dc = item.getItemDictionaryFlag(F_DC) ?? 0;

  if (!dc) {
    await item.addItemBooleanFlag(F_SUCCESS);
    if (item.getItemDictionaryFlag(F_RECEIVED) === undefined) {
      await item.setItemDictionaryFlag(F_RECEIVED, 0);
    }
    ui.notifications.info(`${item.name} is ready to receive dedicated healing.`);
    return;
  }

  // awaitResult: true blocks until the roll completes and returns the result object directly.
  // The actor/item correlation is held in this closure — no message ID Map needed.
  // createRequest is GM-gated, so players route it through this module's GM socket; the resolved
  // result object is plain data and survives the round-trip. gmRequest returns null on failure,
  // which the guard below treats the same as a deleted/failed request.
  const requestOptions = {
    type: "skill",
    key: "hea",
    dc,
    mode: "single",
    awaitResult: true,
    includeAid: true,
    flavor: `Heal check to treat ${item.name} on ${actor.name} (DC ${dc})`,
    showDC: true,
    showResults: false,
  };
  const result = game.user.isGM
    ? await game.pf1RollRequests.createRequest(requestOptions)
    : await gmRequest("createRollRequest", requestOptions);

  // null = card deleted before roll; undefined = createRequest failed internally
  if (!result || !result.passed) return;

  if (item.hasItemBooleanFlag(F_SUCCESS)) return;

  await item.addItemBooleanFlag(F_SUCCESS);
  if (item.getItemDictionaryFlag(F_RECEIVED) === undefined) {
    await item.setItemDictionaryFlag(F_RECEIVED, 0);
  }

  ChatMessage.create({
    content: `<p><strong>${item.name}</strong> on <strong>${actor.name}</strong> has been treated and is ready to receive dedicated healing.</p>`,
    speaker: { alias: "Dedicated Healing" },
  });
}

// ─── Phase 2a: Intercept healing via pf1ApplyDamage (spells, abilities) ──────
// Fires BEFORE any HP clamping — gives us the raw unclamped healing amount.
// Handles overhealing and full-HP cases correctly.

function onApplyDamage(actor, options) {
  if (_bypassHealingIntercept) return;
  if (_dialogOpen) return;
  if (options.value >= 0) return; // Positive = damage
  if (!actor.isOwner) return;

  const rawHealing = -options.value;
  const eligibleBuffs = _getEligibleBuffs(actor);
  if (!eligibleBuffs.length) return;

  // Explicit delegation (e.g. short rest applied by the GM): hand the allocation
  // dialog to the submitting player. Suppress here and let their client apply.
  if (_delegateHealing(actor, rawHealing, options)) return;

  const maxHpHealable = Math.max(0, actor.system.attributes.hp.max - actor.system.attributes.hp.value);

  options.value = 0; // Suppress — applyDamage continues with no effect
  _dialogOpen = true;

  _showAllocationDialog(actor, rawHealing, eligibleBuffs, maxHpHealable)
    .finally(() => { _dialogOpen = false; });
}

// ─── Phase 2b: Intercept healing via preUpdateActor (rest, manual HP edits) ──
// Catches direct actor.update() calls that bypass applyDamage.
// Value may be pre-clamped by PF1; we see the actual HP delta only.

function onPreUpdateActor(actor, update, options) {
  if (_bypassHealingIntercept) return;
  if (_dialogOpen) return;
  if (!actor.isOwner) return;

  const hpData = update?.system?.attributes?.hp;
  if (!hpData || hpData.offset === undefined) return;

  const max = hpData.max ?? actor.system.attributes.hp.max;
  const offeredNewHp = hpData.offset + max;
  const currentHp = actor.system.attributes.hp.value;
  const healingOffered = offeredNewHp - currentHp;
  if (healingOffered <= 0) return;

  const eligibleBuffs = _getEligibleBuffs(actor);
  if (!eligibleBuffs.length) return;

  // Suppress HP change by reverting offset to current value in-place
  hpData.offset = actor.system.attributes.hp.offset;

  const maxHpHealable = Math.max(0, actor.system.attributes.hp.max - currentHp);
  _dialogOpen = true;

  _showAllocationDialog(actor, healingOffered, eligibleBuffs, maxHpHealable)
    .finally(() => { _dialogOpen = false; });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Returns true if the heal was delegated to another (online) user, in which case
// the caller must stop and let that user's client handle allocation. Suppresses
// the HP in-place via options.value before emitting. Returns false to handle locally.
function _delegateHealing(actor, rawHealing, options) {
  const delegate = options[DELEGATE_KEY] ?? options[LEGACY_DELEGATE_KEY];
  if (!delegate || delegate === game.user.id) return false;
  if (!game.users.get(delegate)?.active) return false; // submitter offline — handle locally

  options.value = 0;
  game.socket.emit(CHANNEL, {
    type: "dhDelegate",
    userId: delegate,
    actorUuid: actor.uuid,
    rawHealing,
  });
  return true;
}

function _getEligibleBuffs(actor) {
  const sources = actor.itemFlags.boolean[F_SUCCESS]?.sources ?? [];
  return sources.filter((item) => {
    const required = item.getItemDictionaryFlag(F_REQUIRED) ?? 0;
    const received = item.getItemDictionaryFlag(F_RECEIVED) ?? 0;
    return required > 0 && received < required;
  });
}

async function _applyHp(actor, amount) {
  if (amount <= 0) return;
  _bypassHealingIntercept = true;
  try {
    await actor.applyDamage(-amount); // Negative = healing in PF1's convention
  } finally {
    _bypassHealingIntercept = false;
  }
}

// ─── Phase 2: Allocation Dialog ───────────────────────────────────────────────

async function _showAllocationDialog(actor, totalHealing, eligibleBuffs, maxHpHealable) {
  const buffData = eligibleBuffs.map((item) => {
    const required = item.getItemDictionaryFlag(F_REQUIRED) ?? 0;
    const received = item.getItemDictionaryFlag(F_RECEIVED) ?? 0;
    return { id: item.id, name: item.name, required, received, remaining: required - received };
  });

  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    totalHealing, maxHpHealable, buffs: buffData,
  });

  const allocations = await foundry.applications.api.DialogV2.wait({
    window: { title: "Healing Allocation" },
    content,
    modal: true,
    rejectClose: false,
    buttons: [
      {
        action: "confirm",
        label: "Apply",
        default: true,
        callback: (event, button, dialog) => {
          const form = dialog.element.querySelector("form");
          const result = {};
          for (const input of form.querySelectorAll(".dh-bone-input")) {
            const val = Math.max(0, Math.min(parseInt(input.value) || 0, parseInt(input.max) || 0));
            result[input.dataset.itemId] = val;
          }
          return result;
        },
      },
    ],
  });

  // null = closed via X → apply full incoming healing to HP (PF1 clamps to max)
  if (!allocations) {
    await _applyHp(actor, totalHealing);
    return;
  }

  let remaining = totalHealing;
  const conditionLines = [];

  for (const item of eligibleBuffs) {
    const requested = Math.max(0, allocations[item.id] ?? 0);
    const allocated = Math.min(requested, remaining);
    remaining -= allocated;
    if (allocated <= 0) continue;

    const received = item.getItemDictionaryFlag(F_RECEIVED) ?? 0;
    const required = item.getItemDictionaryFlag(F_REQUIRED) ?? 0;
    const newReceived = Math.min(received + allocated, required);
    await item.setItemDictionaryFlag(F_RECEIVED, newReceived);

    const fullyHealed = newReceived >= required;
    if (fullyHealed) await item.update({ "system.active": false });

    conditionLines.push(`<li>${item.name}: ${allocated} HP${fullyHealed ? " — <em>condition resolved</em>" : ""}</li>`);
  }

  const hpApplied = Math.min(remaining, maxHpHealable);
  const wasted = remaining - hpApplied;

  if (hpApplied > 0) await _applyHp(actor, hpApplied);

  if (conditionLines.length > 0) {
    const lines = [...conditionLines];
    if (hpApplied > 0) lines.push(`<li>Hit Points: ${hpApplied} HP</li>`);
    if (wasted > 0) lines.push(`<li><em>${wasted} HP wasted</em></li>`);
    ChatMessage.create({
      content: `<p><strong>${actor.name}</strong> received ${totalHealing} HP of dedicated healing:</p><ul>${lines.join("")}</ul>`,
      speaker: { alias: "Dedicated Healing" },
    });
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerDedicatedHealing() {
  Hooks.on("pf1ApplyDamage", onApplyDamage);
  Hooks.on("preUpdateActor", onPreUpdateActor);

  // Receive a heal delegated from another client (e.g. GM resolving a short rest).
  // We recompute buffs/HP locally so the dialog reflects this client's current state.
  // Shares the module channel with the GM socket; the two are told apart by `type`.
  game.socket.on(CHANNEL, async (data) => {
    if (data?.type !== "dhDelegate" || data.userId !== game.user.id) return;
    if (_dialogOpen) return;

    const actor = await fromUuid(data.actorUuid);
    if (!actor?.isOwner) return;

    const eligibleBuffs = _getEligibleBuffs(actor);
    if (!eligibleBuffs.length) {
      // Buffs changed since the heal was tagged — just apply the HP.
      await _applyHp(actor, data.rawHealing);
      return;
    }

    const maxHpHealable = Math.max(0, actor.system.attributes.hp.max - actor.system.attributes.hp.value);
    _dialogOpen = true;
    _showAllocationDialog(actor, data.rawHealing, eligibleBuffs, maxHpHealable)
      .finally(() => { _dialogOpen = false; });
  });
}
