/* pf1-critical-effects — entry point.
 *
 * Wiring and API surface only; the work lives in the layers below (DESIGN.md §2):
 *
 *   chat / flow   UI, buttons, roll requests, card mutation   (GM-side, async)
 *   apps          the crit resolution dialog's template
 *   resolve       pure functions: context -> grade + location   (phase 2)
 *   flow          the resolution, its trigger, and the buttons it leaves behind
 *   catalog       JSON pool: query(...) -> entries
 *   integrations  roll-requests, dedicated healing, PF1 pipeline
 */

import { MODULE_ID } from "./const.mjs";
import * as catalog from "./catalog/catalog.mjs";
import { registerSocket, gmRequest } from "./integrations/socket.mjs";
import { registerCardButtons, addButtons, removeButton, registerButtonType } from "./chat/card-buttons.mjs";
import { registerCardMutation } from "./chat/card-mutate.mjs";
import {
  registerFumbleFlow,
  registerFumbleQuickAction,
  promptFumbleDraw,
  inferAttackType,
} from "./flow/fumble-flow.mjs";
import * as power from "./resolve/power.mjs";
import * as location from "./resolve/location.mjs";
import { buildContext, weaponClassFor } from "./resolve/context.mjs";
import { startCritResolution, CritResolution } from "./flow/crit-dialog.mjs";
import { registerExplosion } from "./flow/explosion.mjs";
import * as stages from "./flow/stages.mjs";
import { registerLethal, registerLethalQuickAction, promptLethalDraw, postLethalDraw, offerLethalButton, couldBeLethal } from "./flow/lethal.mjs";
import { registerResolverQuickAction, openResolver } from "./flow/resolver-app.mjs";
import { registerEffectApply, buffDelivery } from "./flow/effect-apply.mjs";
import { registerWeaponStuck, releaseWeapon, blowDamage } from "./flow/weapon-stuck.mjs";
import { resolveExecution, attachExecution, hasMechanics } from "./flow/execution.mjs";
import {
  registerDedicatedHealing,
  requestHealCheck,
  registerProvider,
  unregisterProvider,
  getConfig as getDedicatedHealingConfig,
  setConfig as setDedicatedHealingConfig,
} from "./integrations/dedicated-healing.mjs";
import { registerDedicatedHealingConfig } from "./apps/dedicated-healing-config.mjs";
import { registerPipeline, registerPipelineSettings, suppressionEnabled, rollDeferredCritDamage } from "./integrations/pf1-pipeline.mjs";
import { registerHomebrewSetting, homebrewEnabled, registerBuffLookupSetting } from "./settings.mjs";
import { registerCritTrigger } from "./flow/crit-trigger.mjs";

export { MODULE_ID };

Hooks.once("init", () => {
  // Settings and the libWrapper registration must both exist before any action is used.
  registerHomebrewSetting();
  registerBuffLookupSetting();
  registerPipelineSettings();
  registerPipeline();

  // Hooks that must exist before any action is used. The catalog is not loaded yet — every
  // consumer below reaches it lazily, at click time.
  /* Order matters between these two, and only these two. A button descriptor may name the element
   * it belongs in (§7.6) — the Apply button for a save's failed branch belongs inside that branch,
   * not in PF1's footer — and `registerCardButtons` resolves that selector against the rendered
   * card. So the block that emits those mounts has to have drawn first, which means its hook has to
   * be registered first. */
  registerCardMutation();
  registerCardButtons();
  registerFumbleFlow();
  registerLethal();
  registerEffectApply();
  registerWeaponStuck();
  registerDedicatedHealing();
  registerDedicatedHealingConfig();
  registerCritTrigger();
  registerExplosion();

  // Integration surface, published at init rather than with the rest of the API at ready.
  // `game.criticalEffects` does not exist until ready, and ready hooks run in module load
  // order — pf1-bleed-effects sorts ahead of this module and would find nothing to register
  // its Deep Bleed provider against. Same functions, earlier.
  const mod = game.modules.get(MODULE_ID);
  mod.api ??= {};
  mod.api.dedicatedHealing = {
    requestHealCheck,
    registerProvider,
    unregisterProvider,
    getConfig: getDedicatedHealingConfig,
    setConfig: setDedicatedHealingConfig,
    // Whether the house rule is switched on for this world. Consumers must check this before
    // creating a *new* obligation — pf1-bleed-effects gates Deep Bleed on it. Registration and
    // allocation stay available regardless, so anything already in progress can still be paid off.
    enabled: homebrewEnabled,
  };
});

Hooks.once("ready", async () => {
  registerSocket();

  // loadCatalogs reports its own structural problems; the counts it returns are for callers that
  // want them, not for a banner.
  await catalog.loadCatalogs();

  if (!game.pf1RollRequests) {
    // Declared as a hard requirement, so this means it is installed but inactive.
    ui.notifications.warn(`${MODULE_ID}: pf1-roll-requests is not active — resolutions cannot post their dice.`);
  } else {
    registerResolverQuickAction();
    registerLethalQuickAction();
    registerFumbleQuickAction();
  }

  game.criticalEffects = {
    // catalog
    catalog,
    lint: catalog.lint,

    // resolve layer — pure, console-testable, no UI (§5)
    resolve: {
      buildContext,
      weaponClassFor,
      ...power,
      ...location,
    },

    // crit resolution (§7.2) — a GM-only dialog; state is in memory on the instance
    crit: {
      start: startCritResolution,
      Resolution: CritResolution,
      stages,
    },

    /* The mechanical half of an effect (§6): the PF1 conditions an entry inflicts (native, no
     * dependency), its buff (delivered through astora-mod when that module is there to deliver
     * it), its own damage instance, and the Fortitude save that splits the first three into a
     * saved and a failed branch. `resolveExecution` decides all of it; `attachExecution` puts the
     * save and the buttons on a card. */
    effects: { resolveExecution, attachExecution, hasMechanics, buffDelivery },

    /* Weapon Stuck (§8.1). `releaseWeapon` is the console door for "it came out somehow" — the
     * same path the card buttons take, so the removal damage fires from it too. */
    weaponStuck: { release: releaseWeapon, blowDamage },

    // PF1 pipeline (§9) — deferring critical damage until it is chosen
    pipeline: { suppressionEnabled, rollDeferredCritDamage },

    // dedicated healing (§8), migrated from astora-mod. The injury buffs' `use` script call
    // invokes requestHealCheck through this. Same object as `module.api.dedicatedHealing`,
    // which integrators should prefer — it exists from init.
    dedicatedHealing: game.modules.get(MODULE_ID).api.dedicatedHealing,

    // standalone manual resolver (§7.5) — the same resolve path, driven by hand
    openResolver,

    // lethal draws (§7.4) — flavour only, mechanically inert
    lethal: {
      prompt: promptLethalDraw,
      post: postLethalDraw,
      draw: catalog.drawLethal,
      forType: catalog.lethalFor,
      offerButton: offerLethalButton,
      couldBeLethal,
    },

    // chat cards
    cards: { addButtons, removeButton, registerButtonType },

    // fumbles
    fumbles: {
      table: catalog.getFumbleTable,
      entry: catalog.getFumbleEntry,
      draw: catalog.drawFumble,
      inferAttackType,
      // What the quick action does: pick a table and post a draw for the selected token (or one
      // passed in), with no attack card behind it.
      prompt: promptFumbleDraw,
    },

    // GM socket — generic primitives only (§0)
    gmRequest,
  };

  // No startup banner: a healthy load logs nothing. Real faults still surface — the catalog
  // reports structural problems from loadCatalogs(), and `game.criticalEffects.lint()` reports
  // content coverage on demand.
});
