/* Dedicated healing (DESIGN.md §8) — migrated out of astora-mod.
 *
 * A house rule: some conditions (broken bones, mostly) can't simply be healed away. They must
 * first be *treated* (a Heal check), after which they absorb a threshold of healing before
 * clearing — healing that would otherwise have gone to hit points.
 *
 * ── Participants, not buffs ──────────────────────────────────────────────────
 * Anything that can absorb dedicated healing is a **participant**: a plain descriptor with a
 * name, a threshold, a running total, and an `allocate` callback. Participants come from
 * registered *providers*, and this module ships one — the item provider, which yields every buff
 * on the actor configured through the sheet's Dedicated Healing section.
 *
 * Other modules register their own. pf1-bleed-effects' Deep Bleed does exactly that, so a bleed
 * that lives in an actor flag rather than an item can sit in the same allocation dialog as a
 * broken arm without either module knowing anything about the other's storage.
 *
 * ⚠ Providers must be **synchronous**. `onApplyDamage` runs on a sync hook and has to zero
 * `options.value` in the same tick to suppress the heal; there is no opportunity to await.
 *
 * ── Clears on any healing ────────────────────────────────────────────────────
 * The second mode, and *not* a participant: a wound with no threshold at all, which simply ends
 * the moment its bearer's hit points go up. It absorbs nothing, so it never appears in the
 * allocation arithmetic and an actor carrying only these heals exactly as it would with none —
 * the buff just switches itself off afterwards. It is listed in the allocation dialog when one
 * opens for something else, so the healer can see what their spell is about to take with it.
 *
 * The line for what counts as healing is pf1-bleed-effects' — `pf1ApplyDamage` and nothing else,
 * so a cure spell, a potion, channelled energy and the Apply Healing button all clear it, while
 * a GM typing into the hit point box does not. See `restoresHitPoints` below.
 *
 * ── Configuration ────────────────────────────────────────────────────────────
 * Item config lives in this module's own flag (`flags.pf1-critical-effects.dedicatedHealing`),
 * written by the Dedicated Healing section on the buff sheet's Advanced tab. The PF1 dictionary
 * flags this used to read (`dhDC` / `dhRequired` / `dhReceived` / `dhCheckSuccess`) are gone —
 * a buff carrying only those is inert, and needs re-applying from the compendium.
 */

import { MODULE_ID } from "../const.mjs";
import { gmRequest } from "./socket.mjs";

const TEMPLATE = `modules/${MODULE_ID}/src/chat/dedicated-healing-dialog.hbs`;
const CHANNEL = `module.${MODULE_ID}`;

/** Item flag key holding the whole config object. */
export const FLAG_KEY = "dedicatedHealing";

/** Shape of a freshly-configured item, and the defaults every read falls back to. */
const DEFAULTS = Object.freeze({
  dc: 0,        // Heal check DC to treat the condition; 0 = no check needed
  required: 0,  // HP of dedicated healing to clear it; 0 = feature off for this item
  received: 0,  // HP accumulated so far (runtime)
  treated: false, // Heal check passed (or waived) — only then does it absorb healing
  /* The other mode: no threshold, ends on the first hit-point healing its bearer receives.
   * Takes precedence over `required`, which is hidden on the sheet while this is set — the two
   * are contradictory, and a stale threshold left behind by unticking the box must not turn the
   * wound back into a participant behind the author's back. `dc` still applies when one is
   * authored: a DC means treat it first, no DC means the next cure spell is enough. */
  clearOnHeal: false,
  /* The NAME of another item on the same actor that must be gone (or switched off) before this
   * wound will accept healing at all — the arrow still in it (DESIGN.md §8.1). A name rather than
   * an id for the same reason every buff reference in this module is one: it survives a pack
   * recompile and lets a GM keep their own copy. Empty = nothing blocks it. */
  blockedBy: "",
});

/* Whoever should be shown the allocation dialog, when the heal is applied by someone else — a GM
 * resolving a short rest on a player's behalf, for instance. astora-mod's rest manager sets this
 * on the applyDamage options; the legacy spelling is still honoured so an existing macro or an
 * un-updated caller keeps working. */
const DELEGATE_KEY = "healDelegate";
const LEGACY_DELEGATE_KEY = "astoraHealDelegate";

// ─── Module-level state ───────────────────────────────────────────────────────

let _bypassHealingIntercept = false; // Prevents recursion when re-applying HP
let _dialogOpen = false;             // Prevents stacking dialogs from rapid heals

/** @type {Map<string, (actor: Actor) => DHParticipant[]>} provider id → enumerator */
const _providers = new Map();

/**
 * @typedef {object} DHParticipant
 * @property {string} id        Unique among all participants on this actor.
 * @property {string} name      Shown in the allocation dialog.
 * @property {number} required  HP of dedicated healing needed in total.
 * @property {number} received  HP accumulated so far.
 * @property {(amount: number) => Promise<boolean>} allocate  Applies `amount`; resolves true
 *                                                            when that cleared the condition.
 * @property {boolean} [blocked] Something is stopping this wound from absorbing healing *yet* —
 *                               an arrow still in it, a parasite still burrowing. It is listed in
 *                               the dialog but cannot be allocated to. Omit for the normal case.
 * @property {string} [blockedReason] Why, in a few words ("Impaled"). Shown in place of the input,
 *                               so the healer isn't left wondering where the wound went.
 */

// ─── Item configuration ───────────────────────────────────────────────────────

/**
 * Read an item's dedicated-healing config, filled out with defaults.
 *
 * @param {Item} item
 * @returns {typeof DEFAULTS}
 */
export function getConfig(item) {
  const raw = item?.getFlag(MODULE_ID, FLAG_KEY) ?? {};
  return {
    dc: Number(raw.dc) || 0,
    required: Number(raw.required) || 0,
    received: Number(raw.received) || 0,
    treated: !!raw.treated,
    clearOnHeal: !!raw.clearOnHeal,
    blockedBy: typeof raw.blockedBy === "string" ? raw.blockedBy : "",
  };
}

/**
 * Patch an item's dedicated-healing config.
 *
 * @param {Item} item
 * @param {Partial<typeof DEFAULTS>} patch
 */
export async function setConfig(item, patch) {
  return item.setFlag(MODULE_ID, FLAG_KEY, { ...getConfig(item), ...patch });
}

/**
 * Whether an item is configured to use dedicated healing at all, in either mode.
 *
 * @param {Item} item
 * @returns {boolean}
 */
export function isConfigured(item) {
  const cfg = getConfig(item);
  return cfg.clearOnHeal || cfg.required > 0;
}

// ─── Provider registry ────────────────────────────────────────────────────────

/**
 * Register a source of dedicated-healing participants.
 *
 * The enumerator is called every time healing lands on an actor, and **must be synchronous**
 * (see the note at the top of this file). Return an empty array when the actor has nothing to
 * contribute; throwing is contained but logged.
 *
 * @param {string} id - Unique provider id; re-registering the same id replaces it.
 * @param {(actor: Actor) => DHParticipant[]} enumerate
 */
export function registerProvider(id, enumerate) {
  if (typeof enumerate !== "function") throw new Error(`${MODULE_ID} | provider "${id}" is not a function`);
  _providers.set(id, enumerate);
}

/**
 * Drop a previously-registered provider.
 *
 * @param {string} id
 * @returns {boolean} Whether one was removed.
 */
export function unregisterProvider(id) {
  return _providers.delete(id);
}

/**
 * Every participant on an actor with healing still outstanding, blocked ones included.
 *
 * @param {Actor} actor
 * @returns {DHParticipant[]}
 */
function _getParticipants(actor) {
  const out = [];
  for (const [id, enumerate] of _providers) {
    let batch;
    try {
      batch = enumerate(actor) ?? [];
    } catch (err) {
      console.error(`${MODULE_ID} | dedicated healing: provider "${id}" failed`, err);
      continue;
    }
    for (const p of batch) {
      if (!p?.id || !(p.required > 0) || p.received >= p.required) continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * Whether any of these participants can actually take healing right now.
 *
 * A wound that is present but blocked absorbs nothing, so an actor carrying only blocked wounds
 * must heal exactly as if it had none — intercepting to show a dialog with nothing to allocate
 * would be worse than not intercepting at all.
 *
 * @param {DHParticipant[]} participants
 * @returns {boolean}
 */
function _anyAllocatable(participants) {
  return participants.some((p) => !p.blocked);
}

/**
 * The item holding a wound open, if there is one (DESIGN.md §8.1).
 *
 * Deliberately **fails open**, matching `blockerOf` in pf1-bleed-effects: a blocker that cannot be
 * confirmed — renamed, deleted, switched off, never applied — resolves to "not blocked" and lets
 * the healing through. A wound left unclosable by a bookkeeping slip is a far worse outcome than
 * one that closes a round early, and the GM can always switch the blocker back on.
 *
 * Matched by name, case-insensitively, because the blocker is authored as a name and a GM may keep
 * their own copy of the buff under slightly different capitalisation.
 *
 * @param {Actor} actor
 * @param {{blockedBy?: string}} cfg
 * @returns {Item|null}
 */
function blockerFor(actor, cfg) {
  const name = cfg.blockedBy?.trim().toLowerCase();
  if (!name) return null;
  return actor.items.find((i) => i.name.trim().toLowerCase() === name && i.isActive !== false) ?? null;
}

/**
 * The built-in provider: buffs on the actor that have been treated and still owe healing.
 *
 * @param {Actor} actor
 * @returns {DHParticipant[]}
 */
function _itemParticipants(actor) {
  const out = [];
  for (const item of actor.items) {
    const cfg = getConfig(item);
    // Clear-on-heal takes precedence over any threshold still stored on the item: a wound that
    // ends on the first cure spell has nothing to absorb, and must never open a dialog.
    if (cfg.clearOnHeal) continue;
    if (!cfg.required || !cfg.treated) continue;
    const blocker = blockerFor(actor, cfg);
    out.push({
      id: item.id,
      name: item.name,
      required: cfg.required,
      received: cfg.received,
      ...(blocker ? { blocked: true, blockedReason: blocker.name } : {}),
      allocate: async (amount) => {
        // Re-read: the dialog may have been open a while.
        const now = getConfig(item);
        const received = Math.min(now.received + amount, now.required);
        await setConfig(item, { received });
        const cured = received >= now.required;
        if (cured) await item.update({ "system.active": false });
        return cured;
      },
    });
  }
  return out;
}

// ─── Clears-on-any-healing wounds ─────────────────────────────────────────────

/**
 * The hit point pool `applyDamage` will actually adjust, mirroring how it picks one itself.
 *
 * Lifted from pf1-bleed-effects' `bleed-healing.mjs`, because this feature is deliberately the
 * same rule and the two should not drift.
 *
 * @param {Actor} actor
 * @returns {{value:number, max:number}|null}
 */
function healthPool(actor) {
  try {
    const config = game.settings.get("pf1", "healthConfig");
    const useWoundsAndVigor = config?.getActorConfig?.(actor)?.rules?.useWoundsAndVigor ?? false;
    return (useWoundsAndVigor ? actor.system?.attributes?.vigor : actor.system?.attributes?.hp) ?? null;
  } catch {
    return actor?.system?.attributes?.hp ?? null;
  }
}

/**
 * Whether an application of `applyDamage` will actually restore hit points.
 *
 * Decided from the options up front rather than by watching for the update that follows, which
 * keeps the decision synchronous and free of any race with the write. Three cases move no hit
 * points at all:
 *
 *  - `asNonlethal` healing reduces the nonlethal pool and leaves `hp.value` untouched.
 *  - `asWounds` healing goes to wounds under the Wounds & Vigor rules, not to the pool.
 *  - A creature already at full has nothing to regain.
 *
 * Must be evaluated **before** the healing lands — it reads the live pool.
 *
 * @param {Actor} actor
 * @param {object} options - The options `applyDamage` was called with.
 * @returns {boolean}
 */
function restoresHitPoints(actor, options) {
  if (!(Number(options?.value) < 0)) return false; // damage, or nothing
  if (options?.asNonlethal || options?.asWounds) return false;

  const pool = healthPool(actor);
  if (!pool) return false;
  return Number(pool.value) < Number(pool.max);
}

/**
 * @typedef {object} DHClearOnHeal
 * @property {Item} item
 * @property {Item|null} blocker Held open by this, and so not clearable yet.
 */

/**
 * Every active wound on an actor set to end on the next hit-point healing, blocked ones included.
 *
 * The Heal check gates this only when a DC is authored: `dc: 0` means the next cure spell is
 * enough on its own, `dc: 15` means somebody has to set it first and healing then finishes the
 * job. That keeps one checkbox covering both "a scald that any healing soothes" and "a broken
 * nose that must be straightened before it will knit".
 *
 * @param {Actor} actor
 * @returns {DHClearOnHeal[]}
 */
function _clearOnHealWounds(actor) {
  const out = [];
  for (const item of actor.items) {
    if (item.isActive === false) continue;
    const cfg = getConfig(item);
    if (!cfg.clearOnHeal) continue;
    if (cfg.dc && !cfg.treated) continue; // authored gate, not yet passed
    out.push({ item, blocker: blockerFor(actor, cfg) });
  }
  return out;
}

/**
 * Switch off every clear-on-heal wound that isn't being held open, and say so.
 *
 * Called only once hit points have genuinely moved — see the call sites in `onApplyDamage` and
 * `_applyHp`, which between them cover healing that passes straight through and healing that
 * comes out the far side of the allocation dialog. Healing entirely absorbed by a threshold
 * wound reaches neither, and correctly leaves these alone: it never became hit points.
 *
 * @param {Actor} actor
 */
async function _clearOnHeal(actor) {
  const clearable = _clearOnHealWounds(actor).filter((w) => !w.blocker);
  if (!clearable.length) return;

  const cleared = [];
  for (const { item } of clearable) {
    try {
      await item.update({ "system.active": false });
      cleared.push(item.name);
    } catch (err) {
      console.error(`${MODULE_ID} | dedicated healing: could not clear "${item.name}" on heal`, err);
    }
  }
  if (!cleared.length) return;

  await ChatMessage.create({
    content: `<p>Healing closes <strong>${cleared.join("</strong>, <strong>")}</strong> on <strong>${actor.name}</strong>.</p>`,
    speaker: { alias: "Dedicated Healing" },
  });
}

/**
 * Fire-and-forget wrapper for the synchronous hook path, which cannot await.
 *
 * @param {Actor} actor
 */
function _clearOnHealDetached(actor) {
  _clearOnHeal(actor).catch((err) =>
    console.error(`${MODULE_ID} | dedicated healing: clear-on-heal failed`, err));
}

// ─── Phase 1: Condition Treatment (use script entry point) ───────────────────

/**
 * Run the Heal check that makes a condition ready to be closed by healing.
 *
 * Called from the buff's `use` script call. Serves both modes: for a threshold wound it is the
 * gate on absorbing anything, for a clear-on-heal wound it is the gate on being cleared — and in
 * that mode a DC of 0 means there is no gate at all, so there is nothing to run.
 *
 * @param {Actor} actor
 * @param {Item} item
 */
export async function requestHealCheck(actor, item) {
  const cfg = getConfig(item);
  if (!cfg.clearOnHeal && !cfg.required) return;

  // The wording follows the mode, because "awaiting dedicated healing" is a lie about a wound
  // that absorbs none.
  const awaiting = cfg.clearOnHeal ? "will close with any healing" : "awaiting dedicated healing";

  if (cfg.clearOnHeal && !cfg.dc) {
    ui.notifications.info(`${item.name} needs no treatment — any healing closes it.`);
    return;
  }

  if (cfg.treated) {
    ui.notifications.warn(`${item.name}: Condition already treated — ${awaiting}.`);
    return;
  }

  if (!cfg.dc) {
    await setConfig(item, { treated: true });
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
    dc: cfg.dc,
    mode: "single",
    awaitResult: true,
    includeAid: true,
    flavor: `Heal check to treat ${item.name} on ${actor.name} (DC ${cfg.dc})`,
    showDC: true,
    showResults: false,
  };
  const result = game.user.isGM
    ? await game.pf1RollRequests.createRequest(requestOptions)
    : await gmRequest("createRollRequest", requestOptions);

  // null = card deleted before roll; undefined = createRequest failed internally
  if (!result || !result.passed) return;

  if (getConfig(item).treated) return;
  await setConfig(item, { treated: true });

  const ready = cfg.clearOnHeal
    ? "has been treated, and will close with any healing"
    : "has been treated and is ready to receive dedicated healing";
  ChatMessage.create({
    content: `<p><strong>${item.name}</strong> on <strong>${actor.name}</strong> ${ready}.</p>`,
    speaker: { alias: "Dedicated Healing" },
  });
}

// ─── Phase 2a: Intercept healing via pf1ApplyDamage (spells, abilities) ──────
// Fires BEFORE any HP clamping — gives us the raw unclamped healing amount.
// Handles overhealing and full-HP cases correctly.

function onApplyDamage(actor, options) {
  // `_applyHp` re-enters this hook with the amount that truly landed, and does its own clearing.
  if (_bypassHealingIntercept) return;
  if (options.value >= 0) return; // Positive = damage
  if (!actor.isOwner) return;

  const rawHealing = -options.value;

  // A dialog already up means this heal is not ours to intercept — it goes straight to hit
  // points, so it is exactly the kind that ends a clear-on-heal wound.
  const participants = _dialogOpen ? [] : _getParticipants(actor);

  if (!_anyAllocatable(participants)) {
    // Nothing can absorb it: PF1 applies the healing untouched. This is the only place the raw
    // options are still intact, so the hit-point test has to happen here.
    if (restoresHitPoints(actor, options)) _clearOnHealDetached(actor);
    return;
  }

  // Explicit delegation (e.g. short rest applied by the GM): hand the allocation
  // dialog to the submitting player. Suppress here and let their client apply.
  // Clearing goes with it — the delegate's `_applyHp` does it on the other client.
  if (_delegateHealing(actor, rawHealing, options)) return;

  const maxHpHealable = Math.max(0, actor.system.attributes.hp.max - actor.system.attributes.hp.value);

  options.value = 0; // Suppress — applyDamage continues with no effect
  _dialogOpen = true;

  _showAllocationDialog(actor, rawHealing, participants, maxHpHealable)
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

  const participants = _getParticipants(actor);
  if (!_anyAllocatable(participants)) return;

  // Suppress HP change by reverting offset to current value in-place
  hpData.offset = actor.system.attributes.hp.offset;

  const maxHpHealable = Math.max(0, actor.system.attributes.hp.max - currentHp);
  _dialogOpen = true;

  _showAllocationDialog(actor, healingOffered, participants, maxHpHealable)
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

async function _applyHp(actor, amount) {
  if (amount <= 0) return;
  // Read the pool before the write, not after — afterwards it may be at full precisely because
  // this healing landed.
  const landed = restoresHitPoints(actor, { value: -amount });
  _bypassHealingIntercept = true;
  try {
    await actor.applyDamage(-amount); // Negative = healing in PF1's convention
  } finally {
    _bypassHealingIntercept = false;
  }
  if (landed) await _clearOnHeal(actor);
}

// ─── Phase 2: Allocation Dialog ───────────────────────────────────────────────

async function _showAllocationDialog(actor, totalHealing, participants, maxHpHealable) {
  // Three kinds of row, in this order, so the ones the healer is typing into stay at the top:
  //   0  allocatable — a threshold wound taking input
  //   1  clears on healing — takes no input, but will go when hit points land, and the healer
  //      deserves to know that before deciding to pour everything into a broken arm instead
  //   2  blocked — held open, either kind, listed so it doesn't silently vanish
  const rows = [
    ...participants.map((p) => ({
      id: p.id,
      name: p.name,
      required: p.required,
      received: p.received,
      remaining: p.required - p.received,
      blocked: !!p.blocked,
      blockedReason: p.blockedReason || "blocked",
      rank: p.blocked ? 2 : 0,
    })),
    ..._clearOnHealWounds(actor).map(({ item, blocker }) => ({
      id: item.id,
      name: item.name,
      clearOnHeal: true,
      blocked: !!blocker,
      blockedReason: blocker?.name || "blocked",
      rank: blocker ? 2 : 1,
    })),
  ].sort((a, b) => a.rank - b.rank);

  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    totalHealing, maxHpHealable, participants: rows,
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
          for (const input of form.querySelectorAll(".dh-alloc-input")) {
            const val = Math.max(0, Math.min(parseInt(input.value) || 0, parseInt(input.max) || 0));
            result[input.dataset.participantId] = val;
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

  for (const p of participants) {
    if (p.blocked) continue; // no input was rendered for it; belt and braces
    const requested = Math.max(0, allocations[p.id] ?? 0);
    const allocated = Math.min(requested, remaining);
    remaining -= allocated;
    if (allocated <= 0) continue;

    let cured = false;
    try {
      cured = await p.allocate(allocated);
    } catch (err) {
      console.error(`${MODULE_ID} | dedicated healing: allocation to "${p.name}" failed`, err);
      remaining += allocated; // Give it back rather than losing it silently.
      continue;
    }

    conditionLines.push(`<li>${p.name}: ${allocated} HP${cured ? " — <em>condition resolved</em>" : ""}</li>`);
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
  registerProvider("items", _itemParticipants);

  Hooks.on("pf1ApplyDamage", onApplyDamage);
  Hooks.on("preUpdateActor", onPreUpdateActor);

  // Receive a heal delegated from another client (e.g. GM resolving a short rest).
  // We recompute participants/HP locally so the dialog reflects this client's current state.
  // Shares the module channel with the GM socket; the two are told apart by `type`.
  game.socket.on(CHANNEL, async (data) => {
    if (data?.type !== "dhDelegate" || data.userId !== game.user.id) return;
    if (_dialogOpen) return;

    const actor = await fromUuid(data.actorUuid);
    if (!actor?.isOwner) return;

    const participants = _getParticipants(actor);
    if (!_anyAllocatable(participants)) {
      // State changed since the heal was tagged, or everything left is blocked — apply the HP.
      await _applyHp(actor, data.rawHealing);
      return;
    }

    const maxHpHealable = Math.max(0, actor.system.attributes.hp.max - actor.system.attributes.hp.value);
    _dialogOpen = true;
    _showAllocationDialog(actor, data.rawHealing, participants, maxHpHealable)
      .finally(() => { _dialogOpen = false; });
  });
}
