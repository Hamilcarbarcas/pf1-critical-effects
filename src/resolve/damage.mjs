/* An entry's own damage: rolling it, storing it, and turning it back into something PF1 can apply
 * (DESIGN.md §6, "Damage — an independent instance").
 *
 * ── What this is not ────────────────────────────────────────────────────────
 * It is **not** PF1's critical damage. That is the weapon's own multiplied damage, which §9 defers
 * and reinjects into the card's critical column, and it lives in `message.system.rolls`. This is a
 * separate instance — frequently of a different damage type — that the effect deals in its own
 * right. Nothing in this file writes to `system.rolls`, and nothing in it reads the attack's.
 *
 * ── Rolled once, stored, replayed ───────────────────────────────────────────
 * The roll happens on Confirm (§7.2's "dice are thrown as late as they can be") and is serialised
 * into the result flag. Every later render rebuilds the same `Roll` from that data, so the card
 * shows one set of numbers to everyone and survives a reload. `Roll.fromData` also gives back a
 * live roll with its terms intact, which is what makes `toAnchor()`'s expandable dice breakdown
 * work — a stored total could not do that.
 */

import { MODULE_ID } from "../const.mjs";

/**
 * Roll every part of an entry's `damage`, in order.
 *
 * A part whose formula will not evaluate is dropped with a console error rather than throwing:
 * losing one part of a critical's damage is bad, losing the whole resolution to a typo in the
 * catalog is worse, and the validator has already reported anything structurally wrong.
 *
 * @param {{ formula: string, type: string }[]} parts
 * @param {object} [rollData]  the ATTACKER's roll data — see §6. `@` references in a formula are
 *                             the attacker's, because the effect is something they did.
 * @returns {Promise<{ parts: object[], total: number, rolls: Roll[] }|null>} null when nothing rolled
 */
export async function rollDamage(parts, rollData = {}) {
  if (!parts?.length) return null;

  const rolled = [];
  const rolls = [];

  for (const part of parts) {
    try {
      const roll = await new Roll(String(part.formula), rollData).evaluate();
      rolls.push(roll);
      rolled.push({ formula: part.formula, type: part.type, total: roll.total, roll: roll.toJSON() });
    } catch (err) {
      console.error(`${MODULE_ID} | effect damage "${part.formula}" would not roll:`, err);
    }
  }

  if (!rolled.length) return null;

  return { parts: rolled, total: rolled.reduce((sum, p) => sum + (p.total ?? 0), 0), rolls };
}

/**
 * The fumbling attack's own damage, rolled now, in the same stored shape as an entry's damage.
 *
 * A fumble that hurts the fumbler or their weapon deals *the attack's* damage (§4, "Specials"), so
 * this asks PF1 for it — `ItemAction#rollDamage` is the normal, non-critical roll with every bonus
 * the action would have had — rather than re-deriving a formula. `minimize` re-evaluates the same
 * rolls at their lowest, floored at PF1's minimum of 1 for the whole instance.
 *
 * @param {ItemAction} action
 * @param {object} [opts]
 * @param {boolean} [opts.minimize]
 * @returns {Promise<{ parts: object[], total: number, rolls: Roll[] }|null>} null when there is
 *   nothing to roll
 */
export async function rollActionDamage(action, { minimize = false } = {}) {
  if (!action?.hasDamage) return null;

  let rolled;
  try {
    rolled = await action.rollDamage({ data: action.getRollData() });
  } catch (err) {
    console.error(`${MODULE_ID} | could not roll ${action.item?.name ?? "the attack"}'s damage:`, err);
    return null;
  }

  const parts = [];
  const rolls = [];
  for (const roll of rolled ?? []) {
    const used = minimize ? await roll.clone().evaluate({ minimize: true }) : roll;
    rolls.push(used);
    parts.push({ formula: roll.formula, type: firstType(roll.options?.damageType), total: used.total, roll: used.toJSON() });
  }
  if (!parts.length) return null;

  const total = parts.reduce((sum, p) => sum + (p.total ?? 0), 0);
  return { parts, total: Math.max(1, total), rolls };
}

/** The first damage type id on a PF1 damage roll; its `damageType` may be a Set or an array. */
function firstType(types) {
  const list = types instanceof Set ? [...types] : Array.isArray(types) ? types : [];
  return list.find((t) => typeof t === "string" && t) ?? "untyped";
}

/** A stored part's `Roll`, rebuilt. Null when the data will not rehydrate. */
export function rollOf(part) {
  if (!part?.roll) return null;
  try {
    return Roll.fromData(part.roll);
  } catch (err) {
    console.error(`${MODULE_ID} | stored effect damage would not rehydrate:`, err);
    return null;
  }
}

/**
 * The stored parts as PF1 damage **instances**.
 *
 * This is the difference between applying 8 damage and applying 8 *piercing* damage: PF1's
 * `applyDamage` reads `options.instances` to work out damage reduction and energy resistance per
 * type (`applications/apply-damage.mjs`), and a bare value is reduced as one untyped lump. The
 * model is built the same way PF1's own chat handler builds it — a `DamagePartModel` per instance,
 * with `value` set to the rolled total.
 *
 * A type PF1 does not recognise is left as authored: the model accepts it and PF1 treats it as
 * untyped, which is the documented degradation and better than dropping the instance.
 *
 * @param {object[]} parts  stored parts from the result flag
 * @returns {object[]} DamagePartModel instances; empty when none could be built
 */
export function damageInstances(parts = []) {
  const instances = [];

  for (const part of parts) {
    try {
      const instance = new pf1.models.action.DamagePartModel({ formula: String(part.formula ?? ""), types: [part.type] });
      instance.value = part.total ?? 0;
      instances.push(instance);
    } catch (err) {
      console.error(`${MODULE_ID} | could not build a damage instance for "${part.type}":`, err);
    }
  }

  return instances;
}

/**
 * A bare `DamagePartModel` carrying one type and nothing else.
 *
 * What PF1's `damage-type-visual.hbs` partial actually wants: it reads `.types`, `.standard` and
 * `.custom`, which are the model's own parsing of an id against `pf1.registry.damageTypes` — a
 * plain `{ type }` object renders as "Undefined". Splitting a type PF1 knows from one it does not
 * is the model's job, and doing it here would be reimplementing it.
 */
export function damageTypeModel(type) {
  try {
    return new pf1.models.action.DamagePartModel({ formula: "0", types: [type] });
  } catch (err) {
    console.error(`${MODULE_ID} | could not read damage type "${type}":`, err);
    return null;
  }
}

/** What a set of stored parts adds up to. `null` when there is nothing to add. */
export const damageTotal = (parts) =>
  parts?.length ? parts.reduce((sum, p) => sum + (Number(p.total) || 0), 0) : null;

/**
 * PF1's minimum-damage floor, applied where PF1 applies it — to the whole instance, not per part.
 *
 * `half` is a plain floor, matching `AttackDamage#half` (chat-attack.mjs), because the two apply
 * anchors on a PF1 damage header are full and floor-of-half and nothing else.
 */
export const halfOf = (total) => Math.floor((Number(total) || 0) / 2);
