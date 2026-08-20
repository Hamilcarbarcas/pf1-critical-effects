/* The resolution context (DESIGN.md §5.1).
 *
 * One function that reads the world ONCE and freezes the result. Everything downstream — power,
 * severity, location, the card, the outcome handlers — reads from this object and never goes
 * back to `game.*`. That is what lets a resolution be replayed, inspected, or driven by hand
 * from the manual resolver with the same code path as the automated flow.
 *
 * Reading is allowed here; mutating is not.
 */

import { MODULE_ID } from "../const.mjs";
import { anatomyFor, limbConfigFor } from "./location.mjs";
import { isCritImmune, critImmunitySources } from "../integrations/defense-manager.mjs";

/**
 * Build a frozen resolution context.
 *
 * Every field is optional-safe: the manual resolver supplies a partial world (often just a
 * target and a damage type) and must get a usable context back rather than an exception.
 *
 * @param {object} opts
 * @param {ActionUse} [opts.actionUse]      the live action use, when there is one
 * @param {object} [opts.chatAttack]        the specific attack within it that crit
 * @param {TokenDocument|Actor} [opts.target]
 * @param {object} [opts.manual]            explicit overrides; wins over anything derived
 * @returns {Readonly<object>}
 */
export function buildContext({ actionUse = null, chatAttack = null, target = null, manual = {} } = {}) {
  const item = manual.item ?? actionUse?.shared?.item ?? actionUse?.item ?? null;
  const action = manual.action ?? actionUse?.shared?.action ?? actionUse?.action ?? null;
  const attackerActor = manual.attackerActor ?? actionUse?.actor ?? item?.actor ?? null;

  const targetActor = resolveActor(target ?? manual.target);
  const targetToken = resolveToken(target ?? manual.target);

  const context = {
    attacker: {
      actor: attackerActor,
      // Whose player is asked to roll during the resolution, so `manual` has to be able to name it.
      token: manual.attackerToken ?? actionUse?.shared?.token ?? actionUse?.token ?? null,
      item,
      action,
      size: manual.attackerSize ?? sizeOf(attackerActor),
      weaponClass: manual.weaponClass ?? weaponClassFor(item, action, attackerActor),
      ...critProfile(action, item, manual),
      confirmRoll: manual.confirmRoll ?? chatAttack?.critConfirm ?? null,
    },

    target: {
      actor: targetActor,
      token: targetToken,
      size: manual.targetSize ?? sizeOf(targetActor),
      anatomy: manual.anatomy ?? anatomyFor(targetActor),

      // Which beast categories this creature has, and what its appendages are called (§5.3). The
      // beast and aberrant location tables are generated from it, so it travels with the anatomy.
      limbConfig: manual.limbConfig ?? limbConfigFor(targetActor),
      hp: hpOf(targetActor),
      conditions: conditionsOf(targetActor),

      // Numeric severity reduction, not a boolean (§5.1). PF1 v11 models no such thing, so this
      // is ours: set flags.<module>.critImmunity to the number of bands a target shrugs off.
      critImmunity: Number(manual.critImmunity ?? targetActor?.getFlag?.(MODULE_ID, "critImmunity") ?? 0) || 0,

      /* The DESIGNATION, which is a different thing from the dial above and does not feed it:
       * "this creature is immune to critical hits", as declared in pf1-defense-manager's Granted
       * Defenses. Purely an indicator — nothing branches on it and no resolution is blocked by it
       * (integrations/defense-manager.mjs). False when that module is absent. */
      critImmune: manual.critImmune ?? isCritImmune(targetActor),
      critImmuneSources: manual.critImmuneSources ?? critImmunitySources(targetActor),

      // v11 stores DR as free text (`system.traits.dr` is split on a regex for display), so it
      // cannot be reduced to a number here. Surfaced raw for a GM to read; nothing branches on it.
      dr: targetActor?.system?.traits?.dr ?? null,

      // PF1 does not model armour per body slot, so there is nothing to read (§10). The field
      // exists so the armour-sacrifice mechanic has a defined home when it is built.
      armorBySlot: null,
    },

    damageType: manual.damageType ?? null,
    calledShot: manual.calledShot ? { chosen: manual.calledShot } : { chosen: null },
  };

  // Shallow-freeze each branch: enough to catch a downstream write, without freezing the live
  // Foundry documents hanging off it.
  Object.freeze(context.attacker);
  Object.freeze(context.target);
  return Object.freeze(context);
}

// --- field derivations ------------------------------------------------------

const resolveActor = (t) => t?.actor ?? (t?.documentName === "Actor" ? t : null) ?? null;
const resolveToken = (t) => (t?.documentName === "Token" ? t : t?.document ?? null);

/** v11 stores size as a numeric index into pf1.config.sizeChart, so deltas are subtractions. */
const sizeOf = (actor) => {
  const value = actor?.system?.traits?.size?.value;
  return Number.isFinite(value) ? value : null;
};

const hpOf = (actor) => {
  const hp = actor?.system?.attributes?.hp;
  return hp ? { value: hp.value ?? null, max: hp.max ?? null, temp: hp.temp ?? 0 } : null;
};

const conditionsOf = (actor) => {
  const conditions = actor?.system?.conditions ?? {};
  return new Set(Object.entries(conditions).filter(([, on]) => on).map(([id]) => id));
};

/**
 * Crit multiplier and threat range, after the broken-condition clamp.
 *
 * A broken weapon crits only on a natural 20 and only for ×2 (PF1 applies this itself when
 * building the attack). We reproduce the clamp here because the context may be built without a
 * live action — the manual resolver has no ChatAttack to read it off.
 */
function critProfile(action, item, manual = {}) {
  const data = action?.data ?? action ?? {};
  let critMult = manual.critMult ?? data.ability?.critMult ?? 2;
  let critRange = manual.critRange ?? data.ability?.critRange ?? 20;

  if (item?.system?.broken) {
    critMult = Math.min(critMult, 2);
    critRange = 20;
  }

  return { critMult: Number(critMult) || 2, critRange: Number(critRange) || 20 };
}

/**
 * How the weapon is held — the input to the ±1 flat modifier (concept §4 step 5).
 *
 * The fiddly one is `naturalSole`. The concept defines it as the sole natural attack, which in
 * PF1 terms means all three of:
 *
 *   1. the attack is a natural attack (item type `attack`, subType `natural`),
 *   2. it is a PRIMARY natural attack (secondaries take the −1 branch instead), and
 *   3. the actor has no OTHER natural attack — which is what earns it 1.5× the ability
 *      modifier to damage, the concept's own test for the category.
 *
 * Condition 3 is the one that makes this actor-scoped rather than item-scoped, and it is why
 * this cannot be derived from the action alone.
 *
 * @returns {"light"|"oneHanded"|"twoHanded"|"naturalPrimary"|"naturalSecondary"|"naturalSole"|null}
 */
export function weaponClassFor(item, action, actor = null) {
  if (!item) return null;

  if (item.type === "attack" && item.system?.subType === "natural") {
    const primary = item.system?.primaryAttack !== false;
    if (!primary) return "naturalSecondary";

    const others = (actor?.items ?? []).filter(
      (i) => i.id !== item.id && i.type === "attack" && i.system?.subType === "natural"
    );
    return others.length === 0 ? "naturalSole" : "naturalPrimary";
  }

  // Held weapons: PF1 v11 uses `weaponSubtype` of light | 1h | 2h | ranged. A two-handed melee
  // weapon earns the +1; ranged weapons fall through with no modifier of their own.
  switch (item.system?.weaponSubtype) {
    case "light": return "light";
    case "1h": return "oneHanded";
    case "2h": return "twoHanded";
    default: return null;
  }
}
