/* GM-run critical resolution, as a dialog (DESIGN.md §7.2, §7.3).
 *
 * One ApplicationV2 per resolution, advancing through the stage sequence in `stages.mjs`. This
 * replaces the persistent chat card the resolution used to run on, and the difference is more than
 * cosmetic — it changes where state lives and what survives:
 *
 *   state       in memory on the GM's client, not in message flags. A reload or a closed window
 *               abandons the resolution; re-open it from the attack card's button and start again.
 *               Deliberate: the machinery is the GM's business, and the alternative (persisting
 *               every intermediate step to the world) buys recovery for a workflow that is over in
 *               a few clicks.
 *   dice        Location and Power go out as pf1-roll-requests cards targeted at the ATTACKER, so
 *               the player rolls them, with the location chart or the effect table rendered on the
 *               card and their row highlighted. Those are the only public moments.
 *   record      the finished resolution is written back onto the originating attack card, the same
 *               way a fumble result is (§7.1), so chat still ends up telling the whole story.
 *
 *   explosion   NOT here. The confirmation explosion happens with the attack roll
 *               (flow/explosion.mjs); the dialog reads its count off the card and turns it into
 *               grade shifts, because it is a property of dice already thrown.
 *
 * ── Two rules about timing that the whole shape follows from ─────────────────
 *
 * Dice are thrown as late as they can be. Critical damage is not rolled when it is CHOSEN, it is
 * rolled when the resolution is committed — so an abandoned resolution leaves no orphaned damage
 * on the card. The one exception is choosing damage alone, because that choice *is* the commit.
 *
 * Roll-request cards are deleted as late as they can be. They stay in the log for the whole
 * resolution rather than vanishing the moment their number arrives, so the players can still see
 * what was rolled and against what while the GM is still working. They go at the very end —
 * on Confirm, or on cancel, because an abandoned resolution must not leave cards inviting clicks.
 */

import { MODULE_ID } from "../const.mjs";
import * as catalog from "../catalog/catalog.mjs";
import { damageTypeOptions } from "../catalog/schema.mjs";
import * as power from "../resolve/power.mjs";
import * as location from "../resolve/location.mjs";
import { stagesFor, nextStage } from "./stages.mjs";
import { setCritResult, explosionCount } from "../chat/card-mutate.mjs";
import { offerBuffButton } from "./effect-buff.mjs";
import { rollDeferredCritDamage, suppressionEnabled } from "../integrations/pf1-pipeline.mjs";
import { postTableRoll, postTableSelect, closeRequest } from "../integrations/roll-requests.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Which stage a Back button returns to, and what going there invalidates. */
const BACK = {
  power: { to: "location", clear: { powerRoll: null, rowOverride: null } },
  result: { to: "power", clear: { powerRoll: null, rowOverride: null } },
};


export class CritResolution extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    // No `pf1` class: this is a module window, not a system sheet, and it carries its own
    // dark/orange styling rather than the system's parchment.
    classes: ["ce-crit-dialog"],
    window: { title: "Critical Effect", icon: "fa-solid fa-burst", resizable: true },
    position: { width: 440, height: "auto" },
    actions: {
      choose: CritResolution.#act("onChoose"),
      requestLocation: CritResolution.#act("onRequestLocation"),
      chooseLocation: CritResolution.#act("onChooseLocation"),
      requestPower: CritResolution.#act("onRequestPower"),
      cancelRequest: CritResolution.#act("onCancelRequest"),
      confirm: CritResolution.#act("onConfirm"),
      back: CritResolution.#act("onBack"),
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/apps/crit-dialog.hbs` },
  };

  /* ApplicationV2 action handlers are static and receive the instance as `this`; routing them
   * through one wrapper keeps the error handling in a single place rather than in seven. */
  static #act(method) {
    return async function (event, target) {
      try {
        await this[method](event, target);
      } catch (err) {
        console.error(`${MODULE_ID} | crit-dialog: ${method} failed:`, err);
        ui.notifications.error(`${MODULE_ID}: that step failed — see the console.`);
      }
    };
  }

  /**
   * @param {object} opts
   * @param {object} opts.context           a frozen context from resolve/context.mjs
   * @param {string} [opts.sourceMessageId] the attack card this came from
   * @param {number} [opts.attackIndex]     which attack on that card threatened
   */
  constructor({ context, sourceMessageId = null, attackIndex = 0 } = {}, options = {}) {
    super(options);

    /* The resolution's own state. NOT `this.state` — ApplicationV2 owns that name, along with
     * `classList`, `element`, `form`, `hasFrame`, `id`, `minimized`, `rendered`, `title` and
     * `window`. All ten are getter-only, so assigning to any of them throws. (`title` is the one
     * exception worth knowing: overriding it with your own getter, as below, is supported.)
     *
     * It is still handed to the template as `state`, which is a context key and collides with
     * nothing. */
    this.crit = {
      stage: "trigger",
      sourceMessageId,
      attackIndex,
      choice: null,

      /* How many times this attack's confirmation came up a threat, read off the card rather
       * than rolled here — the dice were already thrown with the attack (flow/explosion.mjs).
       * Each one shifts the grade up a tier. */
      explosionTiers: explosionCount(
        sourceMessageId ? game.messages.get(sourceMessageId) : null,
        attackIndex
      ),

      /* The GM's thumb on the scale, set at the Power stage. `extraTiers` is solved for from the
       * grade dropdown (power.tiersToReach); `extraFlat` is the free-text modifier. */
      extraTiers: 0,
      extraFlat: 0,

      /* Both of these start from the context and are editable at the Location stage, because both
       * are things the automation infers and can infer wrongly — and neither has any recourse
       * once the resolution is under way. A missing damage type in particular would otherwise
       * dead-end the Power stage, since the effect tables are keyed by it. */
      anatomy: context?.target?.anatomy ?? "humanoid",
      damageType: context?.damageType ?? null,

      grade: null,
      location: null,
      powerRoll: null,

      /** The row the GM picked instead of the one that was rolled. Null means "as rolled". */
      rowOverride: null,

      critDamage: null,

      // A display snapshot, so nothing downstream has to reach back into the world.
      display: {
        attackerName: context?.attacker?.actor?.name ?? "—",
        targetName: targetDisplayName(context),
        critMult: context?.attacker?.critMult ?? 2,
        critRange: context?.attacker?.critRange ?? 20,
        weaponClass: context?.attacker?.weaponClass ?? null,
        limbs: [...(context?.target?.limbs ?? [])],
        attackerSize: context?.attacker?.size ?? null,
        targetSize: context?.target?.size ?? null,
        critImmunity: context?.target?.critImmunity ?? 0,
        targetActorId: context?.target?.actor?.id ?? null,
        targetTokenId: context?.target?.token?.id ?? null,
        attackerTokenId: context?.attacker?.token?.id ?? null,
        attackerActorId: context?.attacker?.actor?.id ?? null,
      },
    };

    // Seed the grade before the first render, so Trigger already shows what is at stake.
    this.crit.grade = this.#computeGrade();

    /**
     * Roll-request cards this resolution has posted, keyed by kind. They stay in the log until
     * the resolution ends — see the file header.
     * @type {Map<string, ChatMessage>}
     */
    this.requests = new Map();

    /** The one request currently awaiting an answer, if any. @type {{kind, label}|null} */
    this.pending = null;
  }

  get title() {
    return `Critical Effect — ${this.crit.display.attackerName} → ${this.crit.display.targetName}`;
  }

  // --- rendering ------------------------------------------------------------

  async _prepareContext() {
    const state = this.crit;
    const applicable = stagesFor({ state });
    const grade = state.grade ?? this.#computeGrade();
    const currentIndex = applicable.findIndex((s) => s.key === state.stage);

    const options = state.location
      ? (catalog.effectResultTable(state.damageType, state.anatomy, state.location.slot) ?? [])
      : [];
    const outcome = this.outcome;

    return {
      state,
      display: state.display,
      grade,
      gradeFormula: this.powerFormula,

      // Location stage
      anatomies: location.ANATOMIES.map((key) => ({ key, selected: key === state.anatomy })),
      damageTypes: damageTypeOptions().map((t) => ({ ...t, selected: t.key === state.damageType })),
      locationLabel: state.location ? location.locationLabel(state.location) : null,

      // Power stage
      gradeOptions: power.GRADES.map((key) => ({ key, selected: key === grade.grade })),

      /* Result stage. The dropdown is the same fourteen rows the player rolled against, so the
       * GM adjusts the result by naming a row rather than by nudging a number. */
      effectOptions: options.map((row, index) => ({
        index,
        label: row.label,
        selected: index === (outcome?.index ?? -1),
      })),
      hasEffectTable: options.length > 0,
      outcome,
      entry: outcome?.entry ?? null,
      overridden: Number.isInteger(state.rowOverride) && state.rowOverride !== catalog.optionIndexFor(state.powerRoll?.total),

      pending: this.pending,
      canGoBack: !!BACK[state.stage],
      stages: applicable.map((stage, index) => ({
        key: stage.key,
        label: stage.label,
        hint: stage.hint,
        current: stage.key === state.stage,
        done: index < currentIndex,
      })),
    };
  }

  /* Field changes — the three selects and the modifier input. Bound once on the frame, which
   * survives re-renders, rather than on the content, which does not. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this._ceBoundTo === this.element) return;
    this._ceBoundTo = this.element;
    this.element.addEventListener("change", (event) => {
      this.#onFieldChange(event).catch((err) => {
        console.error(`${MODULE_ID} | crit-dialog: field change failed:`, err);
      });
    });
  }

  async #onFieldChange(event) {
    const field = event.target;
    const value = field?.value;

    switch (field?.name) {
      case "anatomy":
        // A different creature type is a different location chart, so anything already rolled
        // against the old one is no longer meaningful.
        return this.patch({ anatomy: value, location: null });

      case "damageType":
        return this.patch({ damageType: value || null, rowOverride: null });

      case "gradeOverride": {
        /* Solved for rather than nudged: see power.tiersToReach. `priorSteps` is every shift the
         * GM did not make, which is exactly what computeGrade already reports in its breakdown. */
        const grade = this.crit.grade ?? this.#computeGrade();
        const extraTiers = power.tiersToReach(value, {
          base: grade.base,
          priorSteps: grade.breakdown.weaponTiers + grade.breakdown.explosionTiers,
        });
        return this.patch({ extraTiers, grade: this.#computeGrade({ extraTiers }) });
      }

      case "extraFlat": {
        // "+1", "-2", "3" and "" all have to mean something sensible.
        const extraFlat = Number.parseInt(value, 10) || 0;
        return this.patch({ extraFlat, grade: this.#computeGrade({ extraFlat }) });
      }

      case "rowOverride":
        return this.patch({ rowOverride: Number.parseInt(value, 10) });
    }
  }

  /** Recompute the grade from everything currently known. Cheap, so it is redone, not patched. */
  #computeGrade(overrides = {}) {
    const state = { ...this.crit, ...overrides };
    const d = state.display ?? {};

    /* Critical immunity is a reduction in rows. The severity BANDS it used to be expressed in are
     * gone — the effect table's twelve rows are the severity ladder now — so the honest
     * translation of "this target shrugs off some of it" is a penalty to the total that indexes
     * into them. Folded into the flat modifier so it shows up in the breakdown rather than
     * silently moving the answer. */
    const immunity = Number(d.critImmunity) || 0;

    return power.computeGrade({
      critMult: d.critMult,
      attackerSize: d.attackerSize,
      targetSize: d.targetSize,
      weaponClass: d.weaponClass,
      explosionTiers: state.explosionTiers ?? 0,
      extraTiers: state.extraTiers ?? 0,
      extraFlat: (state.extraFlat ?? 0) - immunity,
    });
  }

  /** Merge a patch into state and re-render. */
  async patch(patch = {}) {
    Object.assign(this.crit, patch);
    await this.render();
    return this.crit;
  }

  /** Move to the next applicable stage, skipping ones that don't apply. */
  async advance(patch = {}) {
    Object.assign(this.crit, patch);
    const next = nextStage(this.crit.stage, { state: this.crit });
    return this.patch({ stage: next?.key ?? "result" });
  }

  /** The Critical Power formula as it will be rolled — pool plus flat, in one expression. */
  get powerFormula() {
    const grade = this.crit.grade ?? this.#computeGrade();
    const flat = grade.flat ?? 0;
    return flat === 0 ? grade.formula : `${grade.formula}${flat > 0 ? "+" : ""}${flat}`;
  }

  /**
   * What the resolution currently says happened: the rolled row, or the GM's override of it.
   *
   * Derived rather than stored, so the override and the roll can never disagree — changing either
   * one recomputes this and nothing has to be kept in step.
   */
  get outcome() {
    const state = this.crit;
    if (!state.location) return null;

    const total = state.powerRoll?.total;
    if (total == null && !Number.isInteger(state.rowOverride)) return null;

    const index = Number.isInteger(state.rowOverride) ? state.rowOverride : catalog.optionIndexFor(total);
    return catalog.effectAt(state.damageType, state.anatomy, state.location.slot, index, total ?? index);
  }

  // --- stage actions --------------------------------------------------------

  /* Trigger: effect / damage / both.
   *
   * Damage alone is the only choice that ends the resolution here, and it is therefore the only
   * one that rolls the deferred critical damage now (§9). "Both" waits for Confirm, along with
   * everything else. */
  async onChoose(event, target) {
    const choice = target.dataset.value;

    if (choice === "damage") {
      await this.patch({ choice });
      await this.#rollCritDamage();
      await this.record();
      return this.close();
    }

    return this.advance({ choice });
  }

  /** Location: a d12 the attacking player rolls, against this creature's own location chart. */
  async onRequestLocation() {
    const options = this.#locationOptions();
    if (!options) return;

    return this.request({
      kind: "location",
      label: "the hit location",
      formula: "1d12",
      resultTable: options.map(({ min, label }) => (min === undefined ? { label } : { min, label })),
      flavor: `Hit Location — ${this.crit.display.targetName}`,
      onDone: ({ total }) =>
        this.advance({
          location: location.locationFor({
            anatomy: this.crit.anatomy,
            limbs: this.crit.display.limbs,
            total,
          }),
        }),
    });
  }

  /**
   * The same chart, as a called shot the player picks from.
   *
   * A picked row comes back as an INDEX, not a total, so the location is taken from the option
   * list rather than looked up — which is the whole reason `locationOptions` carries the resolved
   * location alongside the label.
   */
  async onChooseLocation() {
    const options = this.#locationOptions();
    if (!options) return;

    return this.request({
      kind: "location",
      label: "a hit location",
      select: true,
      resultTable: options.map(({ min, label }) => (min === undefined ? { label } : { min, label })),
      flavor: `Called Shot — ${this.crit.display.targetName}`,
      onDone: ({ selectedIndex }) => {
        const picked = options[selectedIndex]?.location;
        if (!picked) {
          ui.notifications.warn(`${MODULE_ID}: that location could not be resolved.`);
          return;
        }
        return this.advance({ location: location.chooseLocation(picked.slot, picked.side) });
      },
    });
  }

  /** The resolved location chart for this creature, or null with a notification. */
  #locationOptions() {
    const options = location.locationOptions({
      anatomy: this.crit.anatomy,
      limbs: this.crit.display.limbs,
    });

    if (!options.length) {
      ui.notifications.error(`${MODULE_ID}: no "${this.crit.anatomy}" location table is loaded.`);
      return null;
    }
    return options;
  }

  /* Power: the grade's die pool, rolled by the attacking player against the effect table for the
   * location that was just settled.
   *
   * The flat modifier goes into the FORMULA rather than being added afterwards, so the number the
   * player rolls is the number the table reads — otherwise the highlighted row would disagree
   * with the result. */
  async onRequestPower() {
    const state = this.crit;
    const resultTable = catalog.effectResultTable(state.damageType, state.anatomy, state.location?.slot);

    if (!resultTable) {
      ui.notifications.error(
        `${MODULE_ID}: no effect table for ${state.damageType ?? "?"} / ${state.anatomy ?? "?"} / ${state.location?.slot ?? "?"}.`
      );
      return;
    }

    const formula = this.powerFormula;
    const grade = state.grade ?? this.#computeGrade();

    return this.request({
      kind: "power",
      label: `Critical Power (${grade.grade})`,
      formula,
      resultTable,
      clampTable: true, // the pool's reachable range is meaningful here, unlike a flat d12
      flavor: `Critical Power — ${grade.grade}`,
      onDone: ({ total }) => this.advance({ powerRoll: { formula, total }, rowOverride: null }),
    });
  }

  /**
   * Send a roll — or a choice — out to the attacking player and wait.
   *
   * The dialog stays open showing what it is waiting for. The card it posts is kept in
   * `this.requests` and NOT closed when the answer arrives; see the file header.
   */
  async request({ kind, label, formula, resultTable, flavor, clampTable = false, select = false, onDone }) {
    if (this.pending) {
      ui.notifications.warn(`${MODULE_ID}: already waiting on a roll for this resolution.`);
      return;
    }

    // Asking again replaces the earlier card of the same kind: two live location requests would
    // be two answers to one question.
    await this.closeRequestOfKind(kind);

    const token = this.attackerToken;
    if (!token) return this.#resolveLocally({ label, formula, resultTable, select, onDone });

    let settled = false;
    const message = await (select ? postTableSelect : postTableRoll)({
      token,
      formula,
      resultTable,
      flavor,
      clampTable,
      onResult: async (payload) => {
        // The terminal payload from a deleted card is empty-shaped — branch before reading.
        if (payload?.rollType === "cancelled") {
          if (settled) return;
          settled = true;
          this.pending = null;
          this.requests.delete(kind);
          await this.render();
          return;
        }

        const entry = payload?.result;
        const usable = select ? Number.isInteger(entry?.selectedIndex) : typeof entry?.total === "number";
        if (!usable || settled) return;
        settled = true;

        this.pending = null;
        await onDone(entry);
      },
    });

    if (!message) return;

    this.requests.set(kind, message);
    this.pending = { kind, label };
    await this.render();
  }

  /**
   * No attacker token means nobody to ask — a resolution driven from the standalone resolver,
   * typically. Settle it GM-side rather than dead-ending: the request card is a way to show the
   * player what their die bought, not a precondition for resolving at all.
   */
  async #resolveLocally({ label, formula, resultTable, select, onDone }) {
    if (!select) {
      const roll = new Roll(formula);
      await roll.evaluate();
      if (game.dice3d) await game.dice3d.showForRoll(roll);
      return onDone({ total: roll.total });
    }

    const content = `<select name="pick" style="width:100%">${resultTable
      .map((row, index) => `<option value="${index}">${foundry.utils.escapeHTML(row.label)}</option>`)
      .join("")}</select>`;

    const selectedIndex = await foundry.applications.api.DialogV2.prompt({
      window: { title: label },
      content,
      ok: { label: "Choose", callback: (event, button) => Number(button.form.pick.value) },
      rejectClose: false,
    });

    if (!Number.isInteger(selectedIndex)) return;
    return onDone({ selectedIndex });
  }

  /** Give up on a roll nobody is going to click. Takes its card with it — it asks nothing now. */
  async onCancelRequest() {
    const kind = this.pending?.kind;
    this.pending = null;
    if (kind) await this.closeRequestOfKind(kind);
    await this.render();
  }

  /** Step back to the stage before this one, discarding what that stage's answer produced. */
  async onBack() {
    const step = BACK[this.crit.stage];
    if (!step) return;
    return this.patch({ ...step.clear, stage: step.to });
  }

  /**
   * Commit. This is the end of the resolution and the only place the late work happens:
   * the deferred critical damage is rolled, the result is written onto the attack card, the
   * roll-request cards are taken down, and the dialog closes.
   */
  async onConfirm() {
    if (this.pending) {
      ui.notifications.warn(`${MODULE_ID}: still waiting on a roll — cancel it first.`);
      return;
    }

    if (this.crit.choice === "both") await this.#rollCritDamage();
    await this.record();
    return this.close();
  }

  /** Release the critical damage PF1 was stopped from rolling (§9). */
  async #rollCritDamage() {
    const source = this.sourceMessage;
    if (!source || !suppressionEnabled()) return;

    // The roll writes itself into the card's own `system.rolls`; there is no second copy to keep
    // in step, and the card's critical column picks it up on its next render.
    const rolled = await rollDeferredCritDamage(source, { attackIndex: this.crit.attackIndex });
    if (rolled) {
      this.crit.critDamage = { total: rolled.total, extra: rolled.extra, formula: rolled.formula };
    }
  }

  /** The record of what happened, on the card the attack was made from (§7.1's pattern). */
  async record() {
    const source = this.sourceMessage;
    if (!source) return; // a manual resolution has no attack card to write to

    const state = this.crit;
    const outcome = this.outcome;

    // Damage alone leaves no block: the damage itself is the record, and it is already in PF1's
    // own critical column. An empty "Critical Effect —" header would be noise.
    if (!outcome?.entry && !outcome?.deadly) return;

    await setCritResult(source, {
      choice: state.choice,
      location: state.location ? location.locationLabel(state.location) : null,
      grade: state.grade?.grade ?? null,
      row: outcome.row,
      total: state.powerRoll?.total ?? null,
      deadly: outcome.deadly,
      save: outcome.save,
      entryId: outcome.entry?.id ?? null,
      name: outcome.entry?.name ?? null,
      journal: outcome.entry?.journal ?? null,
      // Prose the GM adjudicates, carried on the card rather than left in the journal, because a
      // note is the whole mechanical content of the entries that have one.
      note: outcome.entry?.note ?? null,
    });

    // The mechanical half, if this entry has one (§6). Separate from the record because it is a
    // button rather than a fact: the record is what happened, this is what can still be done.
    await offerBuffButton(source, {
      entry: outcome.entry,
      target: { actorId: state.display?.targetActorId, tokenId: state.display?.targetTokenId },
      sourceActorId: state.display?.attackerActorId ?? null,
    });
  }

  // --- lookups --------------------------------------------------------------

  get sourceMessage() {
    return this.crit.sourceMessageId ? (game.messages.get(this.crit.sourceMessageId) ?? null) : null;
  }

  /** Whose player is asked to roll. Falls back to any token of the attacking actor. */
  get attackerToken() {
    const d = this.crit.display ?? {};
    const onScene = d.attackerTokenId ? canvas.scene?.tokens?.get(d.attackerTokenId) : null;
    if (onScene) return onScene;

    const actor = d.attackerActorId ? game.actors.get(d.attackerActorId) : null;
    return actor?.getActiveTokens(false, true)?.[0] ?? null;
  }

  /** Take down one kind of request card. */
  async closeRequestOfKind(kind) {
    const message = this.requests.get(kind);
    if (!message) return;
    this.requests.delete(kind);
    await closeRequest(message);
  }

  /**
   * Take down every card this resolution posted.
   *
   * Called from `close()`, so it covers the whole end of the resolution: a confirmed one, an
   * abandoned one, and a GM who simply closed the window. A cancelled resolution kills the
   * process, so its cards must not survive it.
   */
  async closeRequests() {
    const messages = [...this.requests.values()];
    this.requests.clear();
    this.pending = null;
    for (const message of messages) await closeRequest(message);
  }

  async close(options) {
    await this.closeRequests();
    return super.close(options);
  }
}

// --- helpers ----------------------------------------------------------------

/** Route a target's name through pf1-token-randomizer so an obscured NPC name cannot leak (§10). */
function targetDisplayName(context) {
  const token = context?.target?.token;
  const fallback = context?.target?.actor?.name ?? "—";
  const api = game.modules.get("pf1-token-randomizer")?.api;
  if (!token || !api?.getDisplayName) return fallback;
  try {
    return api.getDisplayName(token) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Open a resolution.
 *
 * Kept as a function with the original name and shape so every caller — the attack-card trigger
 * and the standalone resolver — is unaffected by the card-to-dialog move.
 */
export function startCritResolution({ context, sourceMessageId = null, attackIndex = 0 } = {}) {
  if (!game.user.isGM) {
    console.error(`${MODULE_ID} | crit-dialog: resolutions are opened GM-side`);
    return null;
  }
  return new CritResolution({ context, sourceMessageId, attackIndex }).render(true);
}
