/* Standalone manual resolver (DESIGN.md §7.5).
 *
 * The fallback for every case the automation can't see: an off-card kill, a GM ruling, an attack
 * resolved before the module was installed, a creature the pipeline doesn't understand.
 *
 * The important property is that it runs the SAME `resolve/` path as the automated flow and
 * hands off to the SAME prompt card. It is a different way in, not a second implementation —
 * which is what makes it usable as the primary tool today, on text-only content, with none of
 * phase 7's pipeline risk.
 */

import { MODULE_ID } from "../const.mjs";
import * as power from "../resolve/power.mjs";
import { buildContext } from "../resolve/context.mjs";
import { displayName } from "../integrations/token-randomizer.mjs";
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
    // No `pf1` class, and `ce-window` for the shared dark/amber theme: this window hands straight
    // off to the resolution dialog, and the two should not look like different tools.
    classes: ["ce-window", "ce-resolver"],
    tag: "form",
    window: { title: "Critical Effect", icon: "fa-solid fa-burst", resizable: false },
    position: { width: 420 },
    form: { handler: CriticalResolver.#onSubmit, closeOnSubmit: true },
  };

  /* One part, one root element. The submit button is inside the body rather than in core's generic
   * footer part: the footer's button is core-styled and would read as a different window. */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/chat/resolver.hbs` },
  };

  /** @param {object} [seed] pre-filled values, e.g. from a selected token */
  constructor(seed = {}, options = {}) {
    super(options);
    this.seed = seed;
  }

  async _prepareContext() {
    const tokens = candidateTokens();
    const seed = this.seed ?? {};

    const sourceId = seed.sourceId ?? "";
    const targetId = seed.targetId ?? tokens[0]?.id ?? "";
    const resolved = {
      sourceId,
      targetId,
      critMult: seed.critMult ?? 2,
      weaponClass: seed.weaponClass ?? "",
      // Both sides are real creatures on the canvas, so their own sizes beat a Medium default.
      // Re-derived whenever the token they came from changes — see `_onFirstRender`.
      attackerSize: seed.attackerSize ?? sizeOfToken(sourceId) ?? 4,
      targetSize: seed.targetSize ?? sizeOfToken(targetId) ?? 4,
    };

    // Shown live so the GM can see what the inputs buy before committing.
    const preview = power.computeGrade({
      critMult: resolved.critMult,
      attackerSize: resolved.attackerSize,
      targetSize: resolved.targetSize,
      weaponClass: resolved.weaponClass || null,
    });

    return {
      tokens,
      hasTokens: tokens.length > 0,
      weaponClasses: WEAPON_CLASSES,
      critMults: [2, 3, 4],
      sizes: sizeOptions(),
      seed: resolved,
      preview,
      // Pool plus flat as one expression, the same way the resolution dialog states it.
      previewFormula: preview.flat ? `${preview.formula}${preview.flat > 0 ? "+" : ""}${preview.flat}` : preview.formula,
    };
  }

  /* Re-render on every change, so the grade preview tracks the inputs.
   *
   * Bound in `_onFirstRender`, not `_onRender`: `this.element` is the persistent frame — only the
   * parts inside it are replaced — so binding per-render would stack one listener per re-render,
   * and the handler re-renders. One delegated listener on the form covers every input. */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", (event) => {
      // Namespaced rather than the bare global, which is only a deprecation shim in v13.
      const data = new foundry.applications.ux.FormDataExtended(this.element).object;
      const seed = { ...this.seed, ...data, critMult: Number(data.critMult), attackerSize: Number(data.attackerSize), targetSize: Number(data.targetSize) };

      // A new token on either side is a different creature, so the size on screen described the
      // old one. Drop it and let `_prepareContext` read the new one's own size.
      if (event.target?.name === "sourceId") delete seed.attackerSize;
      if (event.target?.name === "targetId") delete seed.targetSize;

      this.seed = seed;
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

    /* The source is whose player is asked to roll the hit location and the Critical Power — the
     * standalone equivalent of the attacking player in the automated flow. It is optional: with
     * none, the resolution rolls both GM-side rather than dead-ending. */
    const source = data.sourceId ? canvas.scene?.tokens?.get(data.sourceId) : null;
    if (!source && data.sourceId) {
      ui.notifications.warn(`${MODULE_ID}: the source token is no longer on the scene.`);
      return;
    }

    /* The same context builder the automated flow uses; `manual` fills in what there is no action
     * to derive.
     *
     * Anatomy and damage type have no field here on purpose — the resolution dialog asks for both
     * at its Location stage, and asking twice invites the two answers to disagree. They are still
     * honoured from a seed, so an API caller that already knows them doesn't have them dropped. */
    const seed = this.seed ?? {};
    const context = buildContext({
      target: token,
      manual: {
        critMult: Number(data.critMult) || 2,
        weaponClass: data.weaponClass || null,
        attackerSize: Number(data.attackerSize),
        targetSize: Number(data.targetSize),
        // `attackerToken` is what the resolution asks to roll; naming it is exactly what the
        // `manual` branch of context.mjs exists for.
        ...(source ? { attackerToken: source, attackerActor: source.actor } : {}),
        ...(seed.damageType ? { damageType: seed.damageType } : {}),
        ...(seed.anatomy ? { anatomy: seed.anatomy } : {}),
      },
    });

    /* Straight to the effect. The Trigger stage exists to choose between critical damage and a
     * critical effect, and a hand-driven resolution has no attack card behind it — there is no
     * suppressed critical damage to release, so two of its three answers mean nothing. */
    await startCritResolution({ context, choice: "effect" });
  }
}

/** PF1 v11 stores size as an index into `pf1.config.sizeChart`; the names come from `actorSizes`. */
function sizeOptions() {
  return Object.keys(pf1.config.sizeChart).map((key, index) => ({
    index,
    label: game.i18n.localize(pf1.config.actorSizes[key] ?? key),
  }));
}

/** A token's own size index, or null when there is no token or it carries no readable size. */
function sizeOfToken(tokenId) {
  const size = tokenId ? canvas.scene?.tokens?.get(tokenId)?.actor?.system?.traits?.size?.value : null;
  return Number.isFinite(size) ? size : null;
}

/** Tokens worth offering on either side: targeted first, then controlled, then the rest of the scene. */
function candidateTokens() {
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
    callback: () => {
      /* The selected token is the SOURCE of the crit — whose player is asked to roll the hit
       * location and the Critical Power, the same way the attacking player does in the automated
       * flow. A resolution has one source, so the first controlled token is it.
       *
       * The canvas selection rather than roll-requests' `promptActors` picker, which this used to
       * use: that picker lists assigned PCs and player-owned linked NPCs only — so a monster
       * landing a crit was never in it — and it hands back an ACTOR id, which then has to be
       * guessed back into one of that actor's tokens. A roll request is addressed to a token, and
       * a controlled one is exactly the token meant.
       *
       * Still optional. With nothing selected the source is simply blank, and the resolver's own
       * dropdown offers every token on the scene; §7.5 works with no source at all. The target
       * needs no seeding either way — the dropdown already opens on the GM's targeted token. */
      const token = canvas.tokens?.controlled?.[0]?.document ?? null;
      openResolver(token ? { sourceId: token.id } : {});
    },
  });
}
