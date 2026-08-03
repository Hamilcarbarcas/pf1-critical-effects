/* Standalone manual resolver (DESIGN.md §7.5).
 *
 * The fallback for every case the automation can't see: an off-card kill, a GM ruling, an attack
 * resolved before the module was installed, a creature the pipeline doesn't understand.
 *
 * The important property is that it runs the SAME `resolve/` path as the automated flow and
 * hands off to the SAME prompt card. It is a different way in, not a second implementation —
 * which is what makes it usable as the primary tool today, on journal-only content, with none
 * of phase 7's pipeline risk.
 */

import { MODULE_ID } from "../const.mjs";
import * as power from "../resolve/power.mjs";
import { ANATOMIES } from "../resolve/location.mjs";
import { damageTypeOptions } from "../catalog/schema.mjs";
import { buildContext } from "../resolve/context.mjs";
import { startCritResolution } from "./crit-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const WEAPON_CLASSES = [
  { key: "", label: "— none —" },
  { key: "light", label: "Light weapon (−1)" },
  { key: "oneHanded", label: "One-handed" },
  { key: "twoHanded", label: "Two-handed (+1)" },
  { key: "naturalPrimary", label: "Natural, primary" },
  { key: "naturalSecondary", label: "Natural, secondary (−1)" },
  { key: "naturalSole", label: "Natural, sole attack (+1)" },
];

export class CriticalResolver extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "critical-effects-resolver",
    classes: ["pf1", "ce-resolver"],
    tag: "form",
    window: { title: "Critical Effect", icon: "fa-solid fa-burst", resizable: false },
    position: { width: 420 },
    form: { handler: CriticalResolver.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/src/chat/resolver.hbs` },
  };

  /** @param {object} [seed] pre-filled values, e.g. from a selected token */
  constructor(seed = {}, options = {}) {
    super(options);
    this.seed = seed;
  }

  async _prepareContext() {
    const targets = candidateTargets();
    const seed = this.seed ?? {};

    return {
      targets,
      hasTargets: targets.length > 0,
      damageTypes: damageTypeOptions(),
      weaponClasses: WEAPON_CLASSES,
      anatomies: ANATOMIES,
      critMults: [2, 3, 4],
      seed: {
        targetId: seed.targetId ?? targets[0]?.id ?? "",
        critMult: seed.critMult ?? 2,
        damageType: seed.damageType ?? "slashing",
        weaponClass: seed.weaponClass ?? "",
        attackerSize: seed.attackerSize ?? 4,
        targetSize: seed.targetSize ?? 4,
        anatomy: seed.anatomy ?? "",
      },
      // Shown live so the GM can see what the inputs buy before committing.
      preview: power.computeGrade({
        critMult: seed.critMult ?? 2,
        attackerSize: seed.attackerSize ?? 4,
        targetSize: seed.targetSize ?? 4,
        weaponClass: seed.weaponClass || null,
      }),
    };
  }

  /** Re-render on every change, so the grade preview tracks the inputs. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.addEventListener("change", () => {
      // Namespaced rather than the bare global, which is only a deprecation shim in v13.
      const data = new foundry.applications.ux.FormDataExtended(this.element).object;
      this.seed = { ...this.seed, ...data, critMult: Number(data.critMult), attackerSize: Number(data.attackerSize), targetSize: Number(data.targetSize) };
      this.render();
    });
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;

    const token = data.targetId ? canvas.scene?.tokens?.get(data.targetId) : null;
    if (!token && data.targetId) {
      ui.notifications.warn(`${MODULE_ID}: that token is no longer on the scene.`);
      return;
    }

    // The same context builder the automated flow uses; `manual` fills in what there is no
    // action to derive.
    const context = buildContext({
      target: token,
      manual: {
        critMult: Number(data.critMult) || 2,
        damageType: data.damageType || null,
        weaponClass: data.weaponClass || null,
        attackerSize: Number(data.attackerSize),
        targetSize: Number(data.targetSize),
        ...(data.anatomy ? { anatomy: data.anatomy } : {}),
      },
    });

    await startCritResolution({ context });
  }
}

/** Tokens worth offering as a target: controlled first, then targeted, then the rest of the scene. */
function candidateTargets() {
  const seen = new Set();
  const out = [];

  const add = (token) => {
    if (!token || seen.has(token.id)) return;
    seen.add(token.id);
    out.push({ id: token.id, name: displayName(token) });
  };

  for (const t of game.user.targets ?? []) add(t.document);
  for (const t of canvas.tokens?.controlled ?? []) add(t.document);
  for (const t of canvas.scene?.tokens ?? []) add(t);

  return out;
}

/** Obscured NPC names must not leak into a GM-facing list that a player might see quoted (§10). */
function displayName(token) {
  const api = game.modules.get("pf1-token-randomizer")?.api;
  try {
    return api?.getDisplayName?.(token) ?? token.name;
  } catch {
    return token.name;
  }
}

export function openResolver(seed = {}) {
  return new CriticalResolver(seed).render(true);
}

/** Registered against pf1-roll-requests at `ready` (§7.5). */
export function registerResolverQuickAction() {
  if (!game.pf1RollRequests) return;

  game.pf1RollRequests.registerQuickAction({
    key: "critical-effects-resolver",
    label: "Critical Effect",
    icon: "fa-burst",
    promptActors: true,
    callback: ({ actors }) => {
      // The picker returns actors; map the first back onto a token so the resolver can read
      // anatomy and size from something concrete.
      const actor = actors?.[0] ? game.actors.get(actors[0].id) : null;
      const token = actor?.getActiveTokens(false, true)?.[0] ?? null;
      openResolver(token ? { targetId: token.id } : {});
    },
  });
}
