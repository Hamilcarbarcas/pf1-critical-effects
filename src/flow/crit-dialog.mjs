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
import { damageTypeOptions, isLocalized, slotFor } from "../catalog/schema.mjs";
import * as power from "../resolve/power.mjs";
import * as location from "../resolve/location.mjs";
import { stagesFor, nextStage } from "./stages.mjs";
import { setCritResult, explosionCount, createCritResultCard } from "../chat/card-mutate.mjs";
import { offerApplyButton } from "./effect-apply.mjs";
import { describeConditions } from "../resolve/conditions.mjs";
import { rollDeferredCritDamage, suppressionEnabled } from "../integrations/pf1-pipeline.mjs";
import { postTableRoll, postTableSelect, closeRequest } from "../integrations/roll-requests.mjs";
import { displayName } from "../integrations/token-randomizer.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Which stage a Back button returns to, and what going there invalidates. */
const BACK = {
  power: { to: "location", clear: { powerRoll: null, rowOverride: null } },
  result: { to: "power", clear: { powerRoll: null, rowOverride: null } },
};


export class CritResolution extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    // No `pf1` class: this is a module window, not a system sheet, and it carries its own
    // dark/orange styling rather than the system's parchment. `ce-window` is where that styling
    // lives; the standalone resolver wears it too.
    classes: ["ce-window", "ce-crit-dialog"],
    window: { title: "Critical Effect", icon: "fa-solid fa-burst", resizable: true },
    position: { width: 440, height: "auto" },
    actions: {
      choose: CritResolution.#act("onChoose"),
      requestLocation: CritResolution.#act("onRequestLocation"),
      chooseLocation: CritResolution.#act("onChooseLocation"),
      proceed: CritResolution.#act("onProceed"),
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
   * @param {"effect"|"damage"|"both"} [opts.choice]  settle the Trigger question up front and
   *                                        skip that stage; used by the standalone resolver
   */
  constructor({ context, sourceMessageId = null, attackIndex = 0, choice = null } = {}, options = {}) {
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
      choice,

      /* Whether the Trigger stage is a question at all. Read by stages.mjs, which drops the stage
       * outright rather than marking it done — it was never asked. */
      choiceLocked: !!choice,

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

      /* All of these start from the context and are editable at the Location stage, because they
       * are things the automation infers and can infer wrongly — and none has any recourse once
       * the resolution is under way. A missing damage type in particular would otherwise
       * dead-end the Power stage, since the effect tables are keyed by it. */
      anatomy: context?.target?.anatomy ?? "humanoid",
      damageType: context?.damageType ?? null,

      /* The creature's limb layout, which the beast and aberrant location tables are generated
       * from (§5.3). Unlike the rest of the state these edits are SAVED back to the target actor
       * as they are made — they describe the creature, not this resolution.
       *
       * Appendages are held as a fixed-length list of slots rather than the compact array the flag
       * stores, so unchecking the second of three doesn't shuffle the third one's name up into it,
       * and a name typed into an unchecked row survives being checked. */
      beastLimbs: [...(context?.target?.limbConfig?.beastLimbs ?? [])],
      appendageSlots: appendageSlotsFrom(context?.target?.limbConfig?.appendages),

      grade: null,
      location: null,
      powerRoll: null,

      /** The row the GM picked instead of the one that was rolled. Null means "as rolled". */
      rowOverride: null,

      critDamage: null,

      // A display snapshot, so nothing downstream has to reach back into the world.
      display: {
        /* Null rather than a dash when there is genuinely no attacker — a resolution opened from
         * the console with no source — so the header and title omit the whole "X →" clause rather
         * than naming a placeholder. The standalone resolver normally does name one. */
        attackerName: partyDisplayName(context?.attacker),
        targetName: partyDisplayName(context?.target, "—"),
        critMult: context?.attacker?.critMult ?? 2,
        critRange: context?.attacker?.critRange ?? 20,
        weaponClass: context?.attacker?.weaponClass ?? null,
        attackerSize: context?.attacker?.size ?? null,
        targetSize: context?.target?.size ?? null,
        critImmunity: context?.target?.critImmunity ?? 0,
        targetActorId: context?.target?.actor?.id ?? null,
        targetTokenId: context?.target?.token?.id ?? null,
        attackerTokenId: context?.attacker?.token?.id ?? null,
        attackerActorId: context?.attacker?.actor?.id ?? null,
      },
    };

    // Seed the grade before the first render, so the first stage already shows what is at stake.
    this.crit.grade = this.#computeGrade();

    // Start at the first stage that still has something to ask, which is Location when the
    // Trigger answer came in with the constructor.
    this.crit.stage = stagesFor({ state: this.crit })[0]?.key ?? "trigger";

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
    const { attackerName, targetName } = this.crit.display;
    return attackerName ? `Critical Effect — ${attackerName} → ${targetName}` : `Critical Effect — ${targetName}`;
  }

  // --- rendering ------------------------------------------------------------

  async _prepareContext() {
    const state = this.crit;
    const applicable = stagesFor({ state });
    const grade = state.grade ?? this.#computeGrade();
    const currentIndex = applicable.findIndex((s) => s.key === state.stage);

    const slot = this.slot;
    const options = slot ? (catalog.effectResultTable(state.damageType, state.anatomy, slot) ?? []) : [];
    const outcome = this.outcome;

    /* Whether this damage type lands somewhere. The three weapon types roll a hit location; the
     * rest wash over the whole creature and read one `general` table per anatomy, so this stage
     * asks its two questions and then simply continues. A damage type that has not been picked yet
     * is neither: it must not silently take the non-localized path, so both sets of controls wait
     * on it. */
    const localized = isLocalized(state.damageType);

    return {
      state,
      display: state.display,
      grade,
      gradeFormula: this.powerFormula,

      // Location stage
      anatomies: location.ANATOMIES.map((key) => ({ key, selected: key === state.anatomy })),
      damageTypes: damageTypeOptions().map((t) => ({ ...t, selected: t.key === state.damageType })),
      locationLabel: state.location ? location.locationLabel(state.location) : null,
      /* Named in the readout, not just in the select on the stage that set it: for a non-localized
       * type it is the only thing that says which of the seven tables the result came from, and
       * the Location line that used to carry that weight is gone. */
      damageTypeLabel: damageTypeOptions().find((t) => t.key === state.damageType)?.label ?? null,
      localized,
      needsDamageType: !state.damageType,

      /* The layout controls, shown only for the anatomy they describe — humanoid's two categories
       * are not a choice, so it has none — and only when a location is going to be rolled at all.
       * The layout divides the d20's limb band; with no d20 there is nothing for it to divide. */
      showBeastLimbs: localized && state.anatomy === "beast",
      showAppendages: localized && state.anatomy === "aberrant",
      beastLimbOptions: location.beastOrder().map((slot) => ({
        slot,
        label: location.beastLimbLabel(slot),
        checked: state.beastLimbs.includes(slot),
      })),
      appendageSlots: state.appendageSlots.map((slot, index) => ({ index, ...slot })),

      /* What the layout above just bought, as bands. Shown because the checkboxes move the odds
       * and there is otherwise no way to see how before something is rolled against them. */
      locationBands: localized
        ? location.locationBands({ anatomy: state.anatomy, limbConfig: this.limbConfig })
        : [],

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
      // Formulas are shown unrolled here (see describeConditions): this is a preview of a row the
      // GM has not confirmed, and rolling `1d4 minutes` to display it would either mislead or
      // commit.
      conditionSummary: describeConditions(outcome?.entry?.conditions),
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
        await this.saveLayout({ anatomy: value });
        return this.patch({ anatomy: value, location: null });

      case "beastLimb": {
        // Kept in table order rather than click order, so the bands never depend on which box the
        // GM happened to tick first.
        const checked = new Set(this.crit.beastLimbs);
        if (field.checked) checked.add(field.value);
        else checked.delete(field.value);
        const beastLimbs = location.beastOrder().filter((slot) => checked.has(slot));

        await this.saveLayout({ beastLimbs });
        return this.patch({ beastLimbs, location: null });
      }

      case "appendageOn": {
        const appendageSlots = this.#withAppendage(Number(field.value), { on: field.checked });
        await this.saveLayout({ appendages: compactAppendages(appendageSlots) });
        return this.patch({ appendageSlots, location: null });
      }

      case "appendageName": {
        /* Saved but deliberately NOT re-rendered. `change` fires on blur, so a GM tabbing from one
         * name to the next would have the field they just landed in destroyed underneath them. The
         * name is a label, not a band boundary — nothing on screen is stale without it. */
        const appendageSlots = this.#withAppendage(Number(field.dataset.index), { name: value });
        this.crit.appendageSlots = appendageSlots;
        return this.saveLayout({ appendages: compactAppendages(appendageSlots) });
      }

      case "damageType": {
        /* Crossing between a localized damage type and one that isn't invalidates any location
         * that was settled — a fire critical has nowhere to have landed, and a slashing one that
         * inherits "general" from the type before it would read the wrong table. Within a kind it
         * is left alone: correcting slashing to piercing should not throw away a rolled location. */
        const damageType = value || null;
        const crossed = isLocalized(this.crit.damageType) !== isLocalized(damageType);
        return this.patch({ damageType, rowOverride: null, ...(crossed ? { location: null } : {}) });
      }

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

  /** One appendage slot changed; the rest are carried through untouched. */
  #withAppendage(index, patch) {
    return this.crit.appendageSlots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
  }

  /**
   * The effect table this resolution reads — the settled body part, or `general`.
   *
   * The one thing the rest of the dialog asks instead of `state.location.slot`, because a
   * non-localized damage type never settles a location and would otherwise read as unfinished
   * forever. Null means the resolution genuinely cannot look a table up yet: no damage type, or a
   * localized one whose location has not been rolled.
   */
  get slot() {
    const { damageType, location: hit } = this.crit;
    return damageType ? slotFor(damageType, hit?.slot ?? null) : null;
  }

  /** The creature's layout in the shape resolve/location.mjs generates tables from. */
  get limbConfig() {
    return {
      beastLimbs: this.crit.beastLimbs,
      appendages: compactAppendages(this.crit.appendageSlots),
    };
  }

  /**
   * The target as the layout should be saved against — the TokenDocument when there is one, so
   * `saveLimbConfig` can find the world actor behind an unlinked token rather than writing to the
   * one token's own synthetic copy.
   */
  get layoutTarget() {
    const d = this.crit.display ?? {};
    const token = d.targetTokenId ? canvas.scene?.tokens?.get(d.targetTokenId) : null;
    return token ?? (d.targetActorId ? game.actors.get(d.targetActorId) : null);
  }

  /**
   * Write the layout back to the target creature (§5.3).
   *
   * The WHOLE layout every time, not just the field that changed: a creature still carrying the v1
   * `limbs` flag has its layout read out of it, and saving only the edited half would leave the
   * other half derived-but-unwritten while the flag it came from is retired underneath it.
   *
   * Non-fatal by design: a layout that fails to save still applies to THIS resolution, which is
   * what the GM was in the middle of. A target that is gone, or one the GM somehow can't update,
   * shouldn't take the resolution down with it.
   *
   * @param {object} [pending]  the change being made, which state does not carry yet
   */
  async saveLayout(pending = {}) {
    try {
      await location.saveLimbConfig(this.layoutTarget, {
        anatomy: this.crit.anatomy,
        ...this.limbConfig,
        ...pending,
      });
    } catch (err) {
      console.error(`${MODULE_ID} | crit-dialog: could not save the target's limb layout:`, err);
      ui.notifications.warn(`${MODULE_ID}: that layout applies to this crit but could not be saved to the target.`);
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
    const slot = this.slot;
    if (!slot) return null;

    const total = state.powerRoll?.total;
    if (total == null && !Number.isInteger(state.rowOverride)) return null;

    const index = Number.isInteger(state.rowOverride) ? state.rowOverride : catalog.optionIndexFor(total);
    return catalog.effectAt(state.damageType, state.anatomy, slot, index, total ?? index);
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

  /** Location: a d20 the attacking player rolls, against this creature's own location chart. */
  async onRequestLocation() {
    const options = this.#locationOptions();
    if (!options) return;

    return this.request({
      kind: "location",
      label: "the hit location",
      formula: location.locationFormula(),
      resultTable: options.map(({ min, label }) => (min === undefined ? { label } : { min, label })),
      flavor: `Hit Location — ${this.crit.display.targetName}`,
      onDone: ({ total }) =>
        this.advance({
          location: location.locationFor({
            anatomy: this.crit.anatomy,
            limbConfig: this.limbConfig,
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
        return this.advance({ location: location.chooseLocation(picked.slot, picked.label) });
      },
    });
  }

  /**
   * Leave the Location stage without settling one — the non-localized path.
   *
   * Nothing to record: `location` stays null all the way through, so the card's result block omits
   * the location line and `slot` answers `general` from the damage type alone.
   */
  async onProceed() {
    if (!this.crit.damageType) {
      ui.notifications.warn(`${MODULE_ID}: pick a damage type first — the effect tables are keyed by it.`);
      return;
    }
    return this.advance();
  }

  /** The resolved location chart for this creature, or null with a notification. */
  #locationOptions() {
    const options = location.locationOptions({
      anatomy: this.crit.anatomy,
      limbConfig: this.limbConfig,
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
    const slot = this.slot;
    const resultTable = slot ? catalog.effectResultTable(state.damageType, state.anatomy, slot) : null;

    if (!resultTable) {
      ui.notifications.error(
        `${MODULE_ID}: no effect table for ${state.damageType ?? "?"} / ${state.anatomy ?? "?"} / ${slot ?? "?"}.`
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
    const state = this.crit;
    const outcome = this.outcome;

    // Damage alone leaves no block: the damage itself is the record, and it is already in PF1's
    // own critical column. An empty "Critical Effect —" header would be noise. Checked before the
    // card is fetched, so a resolution with nothing to say never creates one.
    if (!outcome?.entry && !outcome?.deadly) return;

    /* Where the record goes. The attack card when there is one; otherwise a card created for it.
     * A hand-driven resolution has nothing to write onto, and this dialog closes on Confirm — so
     * without a card of its own the whole result would vanish with the window. */
    const source =
      this.sourceMessage ??
      (await createCritResultCard({
        attackerName: state.display.attackerName,
        targetName: state.display.targetName,
        grade: state.grade?.grade ?? null,
        formula: state.powerRoll?.formula ?? null,
        total: state.powerRoll?.total ?? null,
        speaker: this.#speaker(),
      }));

    if (!source) return;

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
      // Prose and the GM's adjudication line, both carried on the card. Since v5 the catalog owns
      // its own text, so there is no journal to send anyone off to — what the card shows IS the
      // entry.
      text: outcome.entry?.text ?? null,
      note: outcome.entry?.note ?? null,
      // Named on the card whether or not anyone presses the button, because "stunned 1 round" is
      // part of the result even when the GM applies it by hand.
      conditions: outcome.entry?.conditions ?? null,
    });

    // The mechanical half, if this entry has one (§6) — conditions and/or a buff. Separate from
    // the record because it is a button rather than a fact: the record is what happened, this is
    // what can still be done.
    await offerApplyButton(source, {
      entry: outcome.entry,
      target: { actorId: state.display?.targetActorId, tokenId: state.display?.targetTokenId },
      sourceActorId: state.display?.attackerActorId ?? null,
    });
  }

  // --- lookups --------------------------------------------------------------

  get sourceMessage() {
    return this.crit.sourceMessageId ? (game.messages.get(this.crit.sourceMessageId) ?? null) : null;
  }

  /**
   * Who a created result card is attributed to: the source, when the resolution has one.
   *
   * The alias is overridden with the name this dialog already computed, because `getSpeaker` uses
   * the token's REAL name — which for an obscured NPC is exactly the leak §10 is about.
   */
  #speaker() {
    const d = this.crit.display;
    const token = this.attackerToken;
    const actor = token?.actor ?? (d.attackerActorId ? game.actors.get(d.attackerActorId) : null);
    if (!token && !actor) return { alias: "Critical Effect" };
    return { ...ChatMessage.getSpeaker({ actor, token }), alias: d.attackerName ?? "Critical Effect" };
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

/**
 * The compact appendage list a creature's flag stores, as the fixed-length slots the dialog edits.
 *
 * Always `maxAppendages` long: the checkboxes are positional, so an absent appendage has to be a
 * present-but-unchecked row rather than a missing one.
 */
function appendageSlotsFrom(appendages = []) {
  const names = appendages ?? [];
  return Array.from({ length: location.maxAppendages() }, (_, index) => ({
    on: index < names.length,
    name: names[index] ?? "",
  }));
}

/** The reverse: the checked slots, in order, as the flag's compact array of names. */
function compactAppendages(slots = []) {
  return slots.filter((slot) => slot.on).map((slot) => slot.name ?? "");
}

/**
 * One side's name for display, routed through pf1-token-randomizer so an obscured NPC name cannot
 * leak (§10) — which now matters for the attacker too, since the standalone resolver lets the GM
 * name any token on the scene as the source.
 *
 * @param {object} party        a context branch: `context.attacker` or `context.target`
 * @param {string|null} empty   what a side with nothing on it reads as
 */
function partyDisplayName(party, empty = null) {
  return displayName(party?.token, party?.actor?.name ?? empty);
}

/**
 * Open a resolution.
 *
 * Kept as a function with the original name and shape so every caller — the attack-card trigger
 * and the standalone resolver — is unaffected by the card-to-dialog move.
 */
export function startCritResolution({ context, sourceMessageId = null, attackIndex = 0, choice = null } = {}) {
  if (!game.user.isGM) {
    console.error(`${MODULE_ID} | crit-dialog: resolutions are opened GM-side`);
    return null;
  }
  return new CritResolution({ context, sourceMessageId, attackIndex, choice }).render(true);
}
