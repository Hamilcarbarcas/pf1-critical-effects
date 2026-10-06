/* A fumble's specials (DESIGN.md §4, "Specials") — the outcomes that act on the attack that fumbled
 * rather than on a creature's sheet.
 *
 *   reattack      the same action, used again against a new target, with a fresh attack roll
 *   weaponDamage  the attack's damage (rolled at resolution) off the weapon's hit points, less hardness
 *   weaponBroken  the weapon down to half its hit points
 *   weaponStuck   the wielder half of Weapon Stuck (§8.1), with nobody on the other end
 *
 * selfDamage has no button here: it rides the ordinary damage table as nonlethal (execution.mjs).
 *
 * Every button is GM-only and one-shot. Each acts on the fumbler's own item or uses their action,
 * and the redirected attack has to target creatures the fumbler's player may not own.
 *
 * ── The redirected attack ───────────────────────────────────────────────────
 * A real `item.use()` with a private use option, so the attack card, the attack roll and any crit
 * are all PF1's own. The option is read back in `pf1PreActionUse` to keep it to one attack, spend
 * no ammunition or charges (the fumbled attack already paid), and to stop a natural 1 on it from
 * raising another fumble — a fumble never chains.
 */

import { MODULE_ID } from "../const.mjs";
import { registerButtonType, addButtons, removeButton } from "../chat/card-buttons.mjs";
import { buffDelivery } from "./effect-apply.mjs";
import { WIELDER_BUFF, offerWielderButtons } from "./weapon-stuck.mjs";

const REATTACK = "fumble-reattack";
const WEAPON_DAMAGE = "fumble-weapon-damage";
const WEAPON_BROKEN = "fumble-weapon-broken";
const WEAPON_STUCK = "fumble-weapon-stuck";

/** Tables whose attacks travel, where reach says nothing about who is in the line of fire. */
const RANGED_TABLES = ["thrown", "bows", "crossbows"];

/** Whether an action use is a fumble's redirected attack. */
export const isFumbleAttack = (actionUse) => !!actionUse?.shared?.useOptions?.[MODULE_ID]?.fumbleAttack;

/**
 * Cut a redirected attack down to what a fumble buys: one attack, paid for already.
 *
 * Called from `pf1PreActionUse`, which runs after the attacks and their chat rows are generated and
 * before ammunition and charges are spent — the only point where both can still be changed.
 */
export function trimFumbleAttack(actionUse) {
  const shared = actionUse.shared;
  shared.fullAttack = false;
  shared.attacks = (shared.attacks ?? []).slice(0, 1);
  if (Array.isArray(shared.chatAttacks)) shared.chatAttacks = shared.chatAttacks.slice(0, 1);
  for (const atk of shared.attacks) {
    atk.ammo = null;
    atk.chargeCost = 0;
  }
  if (shared.rollData) shared.rollData.chargeCost = 0;
}

/**
 * Put a resolved special's button on the fumble result.
 *
 * Nothing is offered when the attack that fumbled cannot be found — a hand-drawn fumble has none —
 * and the card's prose then says what should happen, for the GM to run.
 *
 * @param {ChatMessage} message
 * @param {object} opts
 * @param {object} opts.execution  the stored execution record
 * @param {object} opts.context    the draw's context — see fumble-flow's `drawContext`
 * @param {string} opts.mount      the result block's button mount
 */
export async function offerSpecialButtons(message, { execution, context, mount }) {
  const special = execution?.special;
  if (!message || !special) return;

  const { item, action } = attackOf(context);
  if (!item) return;

  const base = { gmOnly: true, mount, data: { ...context } };
  const descriptors = [];

  switch (special.kind) {
    case "reattack":
      if (!action) break;
      descriptors.push({
        ...base,
        type: REATTACK,
        label: special.targets === "ally" ? "Attack an Ally" : "Attack Another Target",
        icon: "fa-solid fa-shuffle",
        data: { ...base.data, targets: special.targets },
      });
      break;
    case "weaponDamage":
      if (!special.damage) break;
      descriptors.push({
        ...base,
        type: WEAPON_DAMAGE,
        label: `Damage ${item.name} (${special.damage.total})`,
        icon: "fa-solid fa-hammer",
        data: { ...base.data, total: special.damage.total },
      });
      break;
    case "weaponBroken":
      descriptors.push({ ...base, type: WEAPON_BROKEN, label: `Break ${item.name}`, icon: "fa-solid fa-heart-crack" });
      break;
    case "weaponStuck":
      descriptors.push({ ...base, type: WEAPON_STUCK, label: `Stick ${item.name}`, icon: "fa-solid fa-thumbtack" });
      break;
  }

  if (descriptors.length) await addButtons(message, descriptors);
}

/** The fumbler's token, actor, item and action, as they are now. */
function attackOf({ tokenUuid = null, actorId = null, itemId = null, actionId = null } = {}) {
  const tokenDoc = tokenUuid ? fromUuidSync(tokenUuid) : null;
  // The token's actor first: an unlinked token's weapon lives on its synthetic actor, not the base.
  const actor = tokenDoc?.actor ?? (actorId ? game.actors.get(actorId) : null);
  const item = itemId ? (actor?.items.get(itemId) ?? null) : null;
  const action = item ? (item.actions?.get(actionId) ?? item.defaultAction ?? null) : null;
  return { tokenDoc, actor, item, action };
}

// --- reattack ---------------------------------------------------------------

async function reattack(descriptor, { message }) {
  const data = descriptor.data ?? {};
  const { tokenDoc, item, action } = attackOf(data);
  const token = tokenDoc?.object;
  if (!token || !action) {
    ui.notifications.warn(`${MODULE_ID}: the fumbling token or its attack is no longer on the scene.`);
    return;
  }

  const defender = data.defenderTokenUuid ? fromUuidSync(data.defenderTokenUuid)?.object : null;
  const allyOnly = data.targets === "ally";
  const disposition = token.document.disposition;

  const candidates = canvas.tokens.placeables.filter(
    (t) =>
      t !== token && t !== defender && t.actor && !t.document.hidden &&
      (!allyOnly || t.document.disposition === disposition)
  );
  if (!candidates.length) {
    ui.notifications.info(`${MODULE_ID}: nobody for ${token.name}'s attack to land on — nothing comes of it.`);
    await removeButton(message, descriptor.id);
    return;
  }

  // Melee pre-checks whoever is in reach; a ranged attack's line of fire is the GM's call.
  const ranged = RANGED_TABLES.includes(data.tableKey);
  const inReach = new Set(ranged ? [] : candidates.filter((t) => withinReach(token, t, action)).map((t) => t.id));

  const chosen = await pickEligible(candidates, inReach, { allyOnly, attacker: token.name });
  if (!chosen) return; // dismissed: the button stays for another try
  if (!chosen.length) {
    ui.notifications.info(`${MODULE_ID}: nobody eligible — nothing comes of it.`);
    await removeButton(message, descriptor.id);
    return;
  }

  const victim = canvas.tokens.get(chosen[Math.floor(Math.random() * chosen.length)]);
  if (!victim) return;

  await removeButton(message, descriptor.id);
  await attackWith({ token, item, action, victim });
}

/**
 * Use the action against one token, with the GM's own targets put back afterwards.
 *
 * PF1 reads an attack's targets from the using user's target set, so the redirected attack borrows
 * the GM's for its duration.
 */
async function attackWith({ token, item, action, victim }) {
  const previous = [...game.user.targets].map((t) => t.id);
  canvas.tokens.setTargets([victim.id], { mode: "replace" });
  try {
    await item.use({
      actionId: action.id,
      skipDialog: true,
      token: token.document,
      cost: 0,
      options: { [MODULE_ID]: { fumbleAttack: true } },
    });
  } catch (err) {
    console.error(`${MODULE_ID} | the redirected attack failed:`, err);
    ui.notifications.error(`${MODULE_ID}: the redirected attack failed — see the console.`);
  } finally {
    canvas.tokens.setTargets(previous, { mode: "replace" });
  }
}

/**
 * Whether `other` is within the action's reach of `token`, measured PF1's way on a square grid:
 * between the nearest squares the two occupy, diagonals alternating 5/10, with the 10-ft. reach
 * exception that lets a 10-ft. reach strike two squares diagonally.
 *
 * Only ever a pre-check on the picker, so a gridless or hex scene simply pre-checks nobody.
 */
function withinReach(token, other, action) {
  if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return false;

  let rollData;
  try {
    rollData = action.getRollData();
  } catch {
    return false;
  }
  const toFeet = (value) => pf1.utils.convertDistanceBack(value)[0];
  const reach = toFeet(action.getRange({ type: "single", rollData }));
  const minimum = toFeet(action.getRange({ type: "min", rollData })) || 0;
  if (!(reach > 0)) return false;

  const step = canvas.scene.grid.distance;
  let best = Infinity;
  let bestSquares = Infinity;
  for (const a of squaresOf(token)) {
    for (const b of squaresOf(other)) {
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      const diagonal = Math.min(dx, dy);
      const straight = Math.max(dx, dy) - diagonal;
      best = Math.min(best, (straight + diagonal + Math.floor(diagonal / 2)) * step);
      bestSquares = Math.min(bestSquares, Math.max(dx, dy));
    }
  }

  if (minimum > 0 && best <= minimum) return false;
  if (best <= reach) return true;
  return reach === 2 * step && bestSquares <= 2; // the 10-ft. reach diagonal
}

/** The grid squares a token covers, as column/row pairs. */
function squaresOf(token) {
  const size = canvas.grid.size;
  const x0 = Math.round(token.document.x / size);
  const y0 = Math.round(token.document.y / size);
  const w = Math.max(1, Math.round(token.document.width));
  const h = Math.max(1, Math.round(token.document.height));
  const squares = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) squares.push({ x: x0 + x, y: y0 + y });
  return squares;
}

/**
 * The GM marks who could be hit; one of them is chosen at random.
 *
 * @returns {Promise<string[]|null>} token ids, or null if dismissed
 */
async function pickEligible(candidates, preChecked, { allyOnly, attacker }) {
  const esc = foundry.utils.escapeHTML;
  const rows = candidates
    .map(
      (t) =>
        `<label class="checkbox"><input type="checkbox" name="eligible" value="${t.id}"${preChecked.has(t.id) ? " checked" : ""}> ${esc(t.name)}</label>`
    )
    .join("");

  const content = `
    <div class="ce-dialog">
      <p>Mark every ${allyOnly ? "ally" : "creature"} ${esc(attacker)}'s attack could land on. One is chosen at random.</p>
      <div class="ce-eligible-list">${rows}</div>
    </div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: allyOnly ? "Ally Struck" : "Wrong Target" },
    content,
    ok: {
      label: "Roll the Attack",
      callback: (_event, button) => [...button.form.querySelectorAll('input[name="eligible"]:checked')].map((i) => i.value),
    },
    rejectClose: false,
  }).catch(() => null);
}

// --- the weapon -------------------------------------------------------------

async function weaponDamage(descriptor, { message }) {
  const { item } = attackOf(descriptor.data);
  if (!item) return missingWeapon();

  const damage = Number(descriptor.data?.total) || 0;
  const hardness = Number(item.system.hardness?.total ?? item.system.hardness) || 0;
  const loss = Math.max(0, damage - hardness);

  if (!loss) {
    ui.notifications.info(`${MODULE_ID}: ${item.name}'s hardness ${hardness} absorbs all ${damage}.`);
  } else if (!(item.system.hp?.max > 0)) {
    // No hit points to take it from (an NPC attack, say): it simply breaks.
    await item.update({ "system.broken": true });
    ui.notifications.info(`${MODULE_ID}: ${item.name} has no hit points to lose, and is broken.`);
  } else {
    const value = Math.max(0, item.system.hp.value - loss);
    await item.update({ "system.hp.value": value });
    ui.notifications.info(`${MODULE_ID}: ${item.name} takes ${loss} (${damage} less hardness ${hardness}) — ${value}/${item.system.hp.max} hp.`);
  }
  await removeButton(message, descriptor.id);
}

/**
 * Half its hit points, rounded down. PF1 treats an item at or below half as broken by itself, with
 * the penalties that come with it; an item with no hit points at all gets PF1's explicit broken flag.
 */
async function weaponBroken(descriptor, { message }) {
  const { item } = attackOf(descriptor.data);
  if (!item) return missingWeapon();

  const max = item.system.hp?.max ?? 0;
  if (!(max > 0)) {
    await item.update({ "system.broken": true });
  } else {
    const half = Math.floor(max / 2);
    if (item.system.hp.value > half) await item.update({ "system.hp.value": half });
  }
  ui.notifications.info(`${MODULE_ID}: ${item.name} is broken.`);
  await removeButton(message, descriptor.id);
}

/** §8.1's wielder half: Weapon Lodged on the fumbler, and the free pull / let go buttons. */
async function weaponStuck(descriptor, { message }) {
  const { actor, item } = attackOf(descriptor.data);
  if (!actor || !item) return missingWeapon();

  const api = buffDelivery();
  if (!api?.applyBuffTo) {
    ui.notifications.warn(`${MODULE_ID}: astora-mod's buff delivery is not available — ${item.name} is stuck; run it by hand.`);
    return;
  }

  const lodged = await api.applyBuffTo(actor, { buffName: WIELDER_BUFF }, { interactive: false });
  if (!lodged) return;

  await offerWielderButtons(message, {
    wielderActorId: actor.id,
    lodgedUuid: lodged.uuid,
    stuckUuid: null,
    mount: descriptor.mount,
  });
  await removeButton(message, descriptor.id);
}

function missingWeapon() {
  ui.notifications.warn(`${MODULE_ID}: the weapon that fumbled is no longer on that actor.`);
}

export function registerFumbleSpecials() {
  registerButtonType(REATTACK, reattack);
  registerButtonType(WEAPON_DAMAGE, weaponDamage);
  registerButtonType(WEAPON_BROKEN, weaponBroken);
  registerButtonType(WEAPON_STUCK, weaponStuck);
}
