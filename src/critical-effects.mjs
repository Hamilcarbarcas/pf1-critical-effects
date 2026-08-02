/* pf1-critical-effects — entry point.
 *
 * Wiring and API surface only; the work lives in the layers below (DESIGN.md §2):
 *
 *   chat / flow   UI, buttons, roll requests, card mutation   (GM-side, async)
 *   resolve       pure functions: context -> grade -> severity + location   (phase 2)
 *   outcomes      typed descriptors -> registered handlers    (phase 5)
 *   catalog       JSON pool: query(...) -> entries
 *   integrations  luck, roll-requests, dedicated healing, PF1 pipeline
 */

import { MODULE_ID } from "./const.mjs";
import * as catalog from "./catalog/catalog.mjs";
import { registerSocket, gmRequest } from "./integrations/socket.mjs";
import { registerCardButtons, addButtons, removeButton, registerButtonType } from "./chat/card-buttons.mjs";
import { registerCardMutation } from "./chat/card-mutate.mjs";
import { registerFumbleFlow, inferAttackType } from "./flow/fumble-flow.mjs";

export { MODULE_ID };

Hooks.once("init", () => {
  // Hooks that must exist before any action is used. The catalog is not loaded yet — every
  // consumer below reaches it lazily, at click time.
  registerCardButtons();
  registerCardMutation();
  registerFumbleFlow();
});

Hooks.once("ready", async () => {
  registerSocket();

  const { effects, fumbles, problems } = await catalog.loadCatalogs();

  if (!game.pf1RollRequests) {
    // Declared as a hard requirement, so this means it is installed but inactive.
    ui.notifications.warn(`${MODULE_ID}: pf1-roll-requests is not active — resolutions cannot post their dice.`);
  }

  game.criticalEffects = {
    // catalog
    catalog,
    lint: catalog.lint,

    // chat cards
    cards: { addButtons, removeButton, registerButtonType },

    // fumbles
    fumbles: {
      table: catalog.getFumbleTable,
      entry: catalog.getFumbleEntry,
      draw: catalog.drawFumble,
      inferAttackType,
    },

    // GM socket — generic primitives only (§0)
    gmRequest,
  };

  console.error(
    `${MODULE_ID} | ready: ${effects} effect entr${effects === 1 ? "y" : "ies"}, ` +
    `${fumbles} fumble entries` + (problems.length ? `, ${problems.length} catalog issue(s)` : "")
  );
});
