/* Weapon Stuck (DESIGN.md §8.1) — a wound held open by the steel still in it.
 *
 * ── Three buffs, and why the shape is what it is ────────────────────────────
 *
 * Eleven catalog entries leave the weapon in the victim. What that means at the table depends on
 * one thing only: whether anybody is still holding the other end. A spear in your leg with a
 * fighter braced against it is a leash; the same spear with nobody on it is a stick in your leg,
 * and so is a crossbow bolt. **Held vs unheld** is the axis, not the weapon — which is why there is
 * no list of weapon types anywhere in this file.
 *
 *   Weapon Stuck   victim,  always   −2 attack, blocks the wound's dedicated healing, holds the
 *                                    stashed damage the wound deals again when it comes out
 *   Tethered       victim,  if held  `entangled`, and nothing else
 *   Weapon Lodged  wielder, if held  no conditions at all — see below
 *
 * **The wielder gets no condition on purpose.** §8.1's first draft entangled them, which is a
 * penalty to attack and AC for having landed a critical hit — a punishment for succeeding. It is
 * also the wrong tool: PF1's `entangled` carries no movement component (`registry/conditions.mjs`
 * is −4 Dex and −2 attack, nothing else), so it would not have modelled the one thing the wielder
 * actually suffers. What they face is a *choice* — pull it free, or let go of the weapon — and a
 * choice is two buttons, not an Active Effect.
 *
 * ── The cascade is three deletes, and PF1 does one of them ──────────────────
 *
 * Every buff in this module carries astora-mod's `buffToggle.autoDelete`, so disabling a buff
 * deletes it. That makes PF1's own `children` link do real work: Tethered is linked as a child of
 * Weapon Stuck, and PF1 deletes children with their parent (`actor-pf.mjs` `_enumChildren`). So
 * "the weapon comes out" is *one* write on the victim — disable Weapon Stuck — plus one on the
 * wielder, and Tethered leaves on its own.
 *
 * Note this only works because the buffs delete rather than deactivate: child links cascade on
 * delete and do nothing at all on a toggle-off.
 *
 * ── Why buttons on the card, not a dialog ───────────────────────────────────
 *
 * The wielder's free first attempt belongs to whoever runs the wielder, and the buff is created by
 * the GM (the apply button has to be GM-only — creating an item on someone else's actor requires
 * it). A script call on the buff would fire on the GM's client and nowhere else: both `_onCreate`
 * and `_onUpdate` in PF1 guard with `if (userId !== game.user.id) return`, so a `toggle` script
 * runs only for whoever made the change.
 *
 * A card button sidesteps the whole question rather than answering it. `canSee` filters per viewer
 * at render, from data already on the card, so an absent owner finds it waiting when they log in,
 * several owners all see it and the first click wins, and an actor with no player owner shows it
 * to the GM alone — no live-client lookup, no socket in the GM→player direction the module does
 * not have.
 */

import { MODULE_ID } from "../const.mjs";
import { registerButtonType, addButtons, removeButton } from "../chat/card-buttons.mjs";
import { damageInstances, damageTotal } from "../resolve/damage.mjs";

/* Read here rather than imported from `effect-apply.mjs`, which imports this file: three lines of
 * duplication buys a leaf module and no import cycle. */
const buffDelivery = () =>
  game.modules.get("astora-mod")?.active ? (game.astoraMod?.buffDelivery ?? null) : null;

/** The catalog names this one; the other two are this file's business, not the content's. */
export const STUCK_BUFF = "Weapon Stuck";
export const TETHER_BUFF = "Tethered";
export const WIELDER_BUFF = "Weapon Lodged";

/** The blow's damage, and who is on the other end — stashed on the victim's Weapon Stuck. */
const STUCK_FLAG = "weaponStuck";

const PULL_FREE = "weapon-stuck-pull";
const LET_GO = "weapon-stuck-letgo";

/* ── held ────────────────────────────────────────────────────────────────────
 *
 * `mwak`/`mcman` are melee — the weapon is in the attacker's hands when the attack resolves. A
 * thrown dagger is `rwak` and reads as unheld, which is correct and is the reason this asks the
 * ACTION rather than the weapon: a dagger is a `light` weapon whether it is stabbed or thrown, so
 * `weaponClass` alone would have called a thrown one held.
 *
 * A hand-driven resolution (§7.5) has no action and lands on `null`, which reads as unheld. That is
 * the conservative answer — it delivers the wound and nothing more, and a GM who meant otherwise
 * can put Weapon Lodged on the attacker themselves — rather than inventing a tether nobody rolled.
 */
export const heldFrom = (actionType) => typeof actionType === "string" && actionType.startsWith("m");

/**
 * The attack's own damage, per type, without its critical damage.
 *
 * `system.rolls.attacks[i].damage` and `.critDamage` are separate arrays — PF1 never mixes them —
 * so "the damage of the attack that lodged it, not including critical damage" needs no filtering
 * and no arithmetic. Each roll keeps its own `options.damageType`, which is what lets a flaming
 * spear come back out as 7 physical and 3 fire rather than 10 of something.
 *
 * Totals are stored, not formulas: the wound deals *the damage it dealt*, and re-rolling on the way
 * out would make a second, different attack out of the first one.
 *
 * @param {ChatMessage} message
 * @param {number} attackIndex
 * @returns {{ formula: string, types: string[], total: number }[]}
 */
export function blowDamage(message, attackIndex = 0) {
  const rolls = message?.systemRolls?.attacks?.[attackIndex]?.damage;
  if (!rolls?.length) return [];

  const parts = [];
  for (const roll of rolls) {
    const total = Number(roll?.total) || 0;
    if (!total) continue;
    const types = Array.isArray(roll?.options?.damageType) ? [...roll.options.damageType] : ["untyped"];
    parts.push({ formula: String(roll?.formula ?? total), types, total });
  }
  return parts;
}

/* --- delivery ---------------------------------------------------------------
 *
 * Called from the apply path once the catalog's own buffs are on the victim, and only when one of
 * them was Weapon Stuck. The catalog stays unaware of any of this: all eleven entries name one
 * buff, and the second and third are consequences of the situation rather than content.
 */

/**
 * @param {object} opts
 * @param {Actor} opts.victim
 * @param {Actor|null} opts.wielder
 * @param {Item|null} opts.stuck        the Weapon Stuck buff already delivered to the victim
 * @param {boolean} opts.held
 * @param {object[]} opts.damage        parts from `blowDamage`
 */
export async function deliverWeaponStuck({ victim, wielder = null, stuck = null, held = false, damage = [] } = {}) {
  if (!stuck) return;

  const api = buffDelivery();
  const delivered = [];

  /* The stash goes on first, and unconditionally. It is what the removal card is built from, and a
   * weapon that nobody is holding still comes out and still hurts on the way. */
  await stuck.setFlag(MODULE_ID, STUCK_FLAG, {
    damage,
    wielderUuid: held ? (wielder?.uuid ?? null) : null,
    victimUuid: victim?.uuid ?? null,
  });

  if (!held || !api?.applyBuffTo) return delivered;

  /* Tethered, then linked as a child so it leaves when the wound does. The link is written after
   * both exist because `children` links are actor-local and resolve by id. */
  const tether = await api.applyBuffTo(victim, { buffName: TETHER_BUFF }, { interactive: false });
  if (tether) {
    delivered.push(tether.name);
    try {
      await stuck.createItemLink("children", tether);
    } catch (err) {
      // A missing link costs the free cascade, not the feature: the buttons clear both by uuid.
      console.error(`${MODULE_ID} | could not link ${TETHER_BUFF} under ${STUCK_BUFF}:`, err);
    }
  }

  if (!wielder) return delivered;

  const lodged = await api.applyBuffTo(wielder, { buffName: WIELDER_BUFF }, { interactive: false });
  if (lodged) {
    delivered.push(lodged.name);
    // Each half knows the other. Uuids rather than ids: these are on different actors, and one of
    // them is very often an unlinked token.
    await lodged.setFlag(MODULE_ID, STUCK_FLAG, { stuckUuid: stuck.uuid, victimUuid: victim?.uuid ?? null });
    await stuck.setFlag(MODULE_ID, `${STUCK_FLAG}.lodgedUuid`, lodged.uuid);
  }

  return delivered;
}

/* --- the two buttons --------------------------------------------------------
 *
 * Both are `ownerOf` the wielder, so the player running the attacker gets them and the GM always
 * does. Neither is `gmOnly`: the writes they make are routed through `gmRequest` when the clicker
 * cannot make them, which is the same channel every other cross-actor write in this module uses.
 */

/**
 * Offer the wielder their free first attempt and the option to let go.
 *
 * On the card rather than on the buff sheet because §8.1's free attempt is *immediate* — it happens
 * in the beat after the crit resolves, while everyone is still looking at the card that caused it.
 * The equivalent actions live on the buff for every later attempt.
 *
 * @param {ChatMessage} message
 * @param {object} opts  { wielderActorId, lodgedUuid, stuckUuid, mount }
 */
export async function offerWielderButtons(message, { wielderActorId, lodgedUuid, stuckUuid, mount = null } = {}) {
  if (!message || !lodgedUuid) return;

  const shared = { ownerOf: wielderActorId ?? undefined, ...(mount ? { mount } : {}) };
  await addButtons(message, [
    {
      type: PULL_FREE,
      label: "Pull Weapon Free (free)",
      icon: "fa-solid fa-hand-fist",
      ...shared,
      data: { lodgedUuid, stuckUuid },
    },
    {
      type: LET_GO,
      label: "Let Go",
      icon: "fa-solid fa-hand-open",
      ...shared,
      data: { lodgedUuid },
    },
  ]);
}

/** Disable a buff wherever it lives — autoDelete turns this into the delete that cascades. */
async function clearBuff(uuid) {
  if (!uuid) return false;
  const doc = await fromUuid(uuid);
  if (!doc) return false;

  if (doc.isOwner) {
    await doc.update({ "system.active": false });
    return true;
  }
  const res = await game.criticalEffects.gmRequest("updateDocument", { uuid, updates: { "system.active": false } });
  return !!res?.ok;
}

/**
 * The free attempt: one DC 10 Strength check, and on a success the weapon comes out of them.
 *
 * The check is rolled by the wielder's own actor on the wielder's own client, so it animates and is
 * whispered like any other ability check they make. Only the writes hop to the GM.
 */
async function pullFree(descriptor, { message }) {
  const { lodgedUuid, stuckUuid } = descriptor?.data ?? {};
  const lodged = await fromUuid(lodgedUuid);
  const wielder = lodged?.actor;
  if (!wielder) {
    ui.notifications.warn(`${MODULE_ID}: that weapon is no longer stuck in anything.`);
    return;
  }

  const result = await wielder.rollAbilityTest("str");
  const total = result?.rolls?.[0]?.total ?? result?.total ?? null;
  if (total == null) return; // the roll dialog was dismissed — nothing has happened yet

  if (total < 10) {
    ui.notifications.info(`${MODULE_ID}: ${wielder.name} fails to pull the weapon free (${total} vs DC 10).`);
    return;
  }

  await releaseWeapon({ stuckUuid, lodgedUuid, by: wielder.name });
  // The free attempt is spent whether or not it worked — but only a success ends the situation, so
  // the buttons come off the card here rather than on a failure.
  await removeButton(message, descriptor.id);
  for (const other of message.getFlag(MODULE_ID, "cardButtons") ?? []) {
    if (other.type === LET_GO && other.data?.lodgedUuid === lodgedUuid) await removeButton(message, other.id);
  }
}

/** Letting go leaves the weapon exactly where it is. Only the tether ends. */
async function letGo(descriptor, { message }) {
  const { lodgedUuid } = descriptor?.data ?? {};
  const lodged = await fromUuid(lodgedUuid);
  if (!lodged) return;

  const stash = lodged.getFlag(MODULE_ID, STUCK_FLAG) ?? {};
  const stuck = stash.stuckUuid ? await fromUuid(stash.stuckUuid) : null;

  /* The victim's Tethered goes, and their Weapon Stuck stays — the steel has not moved. This is the
   * one exit where a blanket "my buff ended, end my partner's" would have been exactly wrong. */
  const tether = stuck ? childNamed(stuck, TETHER_BUFF) : null;
  if (tether) await clearBuff(tether.uuid);
  await clearBuff(lodgedUuid);

  if (stuck) await stuck.unsetFlag(MODULE_ID, `${STUCK_FLAG}.lodgedUuid`).catch(() => {});

  ui.notifications.info(`${MODULE_ID}: ${lodged.actor?.name ?? "the wielder"} lets go — the weapon stays in.`);
  await removeButton(message, descriptor.id);
}

/** The victim's linked Tethered, if the link survived. */
function childNamed(parent, name) {
  const wanted = name.trim().toLowerCase();
  for (const link of parent.getLinkedItemsSync?.("children") ?? []) {
    const child = parent.actor?.items?.get(link.id);
    if (child?.name?.trim().toLowerCase() === wanted) return child;
  }
  // The link is a convenience, not the record: fall back to the name on the same actor.
  return parent.actor?.items?.find((i) => i.type === "buff" && i.name?.trim().toLowerCase() === wanted) ?? null;
}

/**
 * The weapon comes out — from either side, by any route.
 *
 * Disabling the victim's Weapon Stuck is the whole of the victim's half: autoDelete deletes it and
 * PF1 takes Tethered with it. The damage card is posted by the delete hook rather than from here,
 * so a GM who removes the buff by hand gets it too.
 */
export async function releaseWeapon({ stuckUuid, lodgedUuid, by = null } = {}) {
  if (lodgedUuid) await clearBuff(lodgedUuid);
  if (stuckUuid) await clearBuff(stuckUuid);
  if (by) ui.notifications.info(`${MODULE_ID}: ${by} pulls the weapon free.`);
}

/* --- damage on the way out --------------------------------------------------
 *
 * One hook, and §8.1's four paths all land on it: the wielder pulls it out, the victim pulls it
 * out, the GM removes the buff by hand — all three disable Weapon Stuck, which deletes it. The
 * fourth, the wielder dropping the weapon, never touches Weapon Stuck and correctly posts nothing.
 */
export function registerWeaponStuck() {
  registerButtonType(PULL_FREE, pullFree);
  registerButtonType(LET_GO, letGo);

  Hooks.on("deleteItem", async (item, _options, userId) => {
    // One poster. The document is already gone everywhere; without this every client posts a card.
    if (userId !== game.user.id) return;
    if (item?.type !== "buff" || item.name?.trim().toLowerCase() !== STUCK_BUFF.toLowerCase()) return;

    const stash = item.getFlag?.(MODULE_ID, STUCK_FLAG);
    const parts = stash?.damage ?? [];
    if (!parts.length) return;

    await postRemovalDamage(item.actor, parts, item.name);
  });
}

/**
 * The blow, dealt again, as its own card.
 *
 * Built the same way the execution block builds an effect's damage — `damageInstances` fed to
 * PF1's own apply anchors — so the row reads like every other damage row on every other card and
 * DR, resistance and temp HP are handled by PF1 rather than by us. Nothing is re-rolled: the parts
 * carry the totals the attack itself produced.
 */
async function postRemovalDamage(actor, parts, label) {
  const total = damageTotal(parts);
  if (!total) return;

  const flat = parts.map((p) => ({ formula: p.formula, type: p.types?.[0] ?? "untyped", total: p.total }));
  const rows = flat
    .map((p) => `<li>${p.total} ${p.type}</li>`)
    .join("");

  const content =
    `<div class="ce-stuck-removal">` +
    `<p><strong>${label} removed</strong> — the wound is dealt again as it comes free.</p>` +
    `<ul class="ce-stuck-damage">${rows}</ul>` +
    `</div>`;

  const data = {
    content,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    flags: {
      [MODULE_ID]: { stuckRemoval: { total, parts: flat, actorUuid: actor?.uuid ?? null } },
    },
  };

  if (game.user.isGM) await ChatMessage.create(data);
  else await game.criticalEffects.gmRequest("createChatMessage", { data });

  /* Applied rather than offered. The victim is the actor the buff was on — there is no targeting
   * question here, unlike the effect's own damage, which is why this does not draw the two hammer
   * anchors and wait for someone to aim them. */
  if (actor?.isOwner) {
    try {
      await pf1.documents.actor.ActorPF.applyDamage(total, {
        instances: damageInstances(flat),
        isCritical: false,
        critMult: 0,
        interactive: false,
        targets: [actor],
      });
    } catch (err) {
      console.error(`${MODULE_ID} | could not apply the removal damage to ${actor.name}:`, err);
    }
  }
}
