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
import { registerEffectBuff, offerBuffButton, buffDelivery } from "./flow/effect-buff.mjs";
import { registerDedicatedHealing, requestBoneSetting } from "./integrations/dedicated-healing.mjs";
import { registerPipeline, registerPipelineSettings, suppressionEnabled, rollDeferredCritDamage } from "./integrations/pf1-pipeline.mjs";
import { registerCritTrigger } from "./flow/crit-trigger.mjs";

export { MODULE_ID };

Hooks.once("init", () => {
  // Settings and the libWrapper registration must both exist before any action is used.
  registerPipelineSettings();
  registerPipeline();

  // Hooks that must exist before any action is used. The catalog is not loaded yet — every
  // consumer below reaches it lazily, at click time.
  registerCardButtons();
  registerCardMutation();
  registerFumbleFlow();
  registerLethal();
  registerEffectBuff();
  registerDedicatedHealing();
  registerCritTrigger();
  registerExplosion();
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

    // the mechanical half of an effect (§6) — an apply-buff button on the card, delivered
    // through astora-mod. Offered only when that module is there to deliver it.
    effects: { offerBuffButton, buffDelivery },

    // PF1 pipeline (§9) — deferring critical damage until it is chosen
    pipeline: { suppressionEnabled, rollDeferredCritDamage },

    // dedicated healing (§8), migrated from astora-mod. The bone buffs' `use` script call
    // invokes requestBoneSetting through this.
    dedicatedHealing: { requestBoneSetting },

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
