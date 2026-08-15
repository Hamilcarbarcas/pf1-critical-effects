/**
 * pf1-critical-effects — the Dedicated Healing section on a buff's Advanced tab.
 *
 * Replaces the PF1 dictionary flags this feature used to be configured through (`dhDC`,
 * `dhRequired`, `dhReceived`, `dhCheckSuccess`). Those were fine while the only way to set the
 * numbers was to type them into the Advanced tab's flag table by hand; now that the feature has
 * its own UI, the config lives in this module's own flag and the built-in flags are free again.
 *
 * Buffs only. The cure step deactivates the item (`system.active = false`), which is a buff-only
 * field — an injury modelled as a feat would need a different answer for what "cured" does.
 */

import { MODULE_ID } from "../const.mjs";
import { getConfig, setConfig } from "../integrations/dedicated-healing.mjs";
import { homebrewEnabled } from "../settings.mjs";
import { makeCollapsible } from "./sheet-section-collapse.mjs";

const TEMPLATE = `modules/${MODULE_ID}/src/apps/dedicated-healing-section.hbs`;

/** De-dup marker. Per-feature, never a shared class: another module reusing a generic name
 *  would be removed along with ours on the next render. */
const SECTION_CLASS = "ce-dh-section";

/**
 * Read a value out of one of the section's inputs.
 *
 * @param {HTMLElement} el
 * @returns {number|boolean}
 */
function readInput(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "text") return el.value.trim();
  return Math.max(0, parseInt(el.value) || 0);
}

/**
 * Build and inject the section, then wire it up.
 *
 * @param {Application} app
 * @param {JQuery|HTMLElement} html
 */
async function injectSection(app, html) {
  const item = app.item ?? app.document;
  if (item?.type !== "buff") return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  const tab = root?.querySelector('.tab[data-tab="advanced"]');
  if (!tab) return;
  if (tab.querySelector(`.${SECTION_CLASS}`)) return; // already injected this render

  const cfg = getConfig(item);
  const configured = cfg.required > 0;

  // With the house rule off, this is where new obligations would be created, so it goes away.
  // An item that is *already* configured keeps its section, because the numbers on it are still
  // live — the allocation dialog goes on honouring them — and a GM turning the rule off mid-
  // campaign needs to see, and be able to reset, what is still outstanding.
  if (!homebrewEnabled() && !configured) return;

  const rendered = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    ...cfg,
    configured,
  });

  const container = tab.querySelector(".flexcol") ?? tab;
  const section = document.createElement("div");
  section.innerHTML = rendered;
  const el = section.firstElementChild;

  // Sit with the other injected sections rather than above them: after astora-mod's Buff
  // Delivery and pf1-defense-manager's Granted Defenses when either is present (both are
  // appended by their own async render hooks), else straight after Script Calls.
  const anchor =
    container.querySelector(".defense-manager-section") ??
    container.querySelector(".buff-delivery") ??
    container.querySelector(".script-calls");
  if (anchor) anchor.after(el);
  else container.append(el);

  wire(app, item, el, configured);
}

/**
 * Attach change handlers. Each field writes straight to the flag rather than riding the sheet's
 * own form submission — the section is injected asynchronously, so a submit can land before it
 * exists.
 *
 * @param {Application} app
 * @param {Item} item
 * @param {HTMLElement} el
 * @param {boolean} configured
 */
function wire(app, item, el, configured) {
  for (const input of el.querySelectorAll(".ce-dh-input")) {
    input.addEventListener("change", async (event) => {
      const field = event.currentTarget.dataset.field;
      if (!field) return;
      const patch = { [field]: readInput(event.currentTarget) };

      // Turning the feature off clears the runtime state with it, so re-enabling later doesn't
      // resume from a stale total.
      if (field === "required" && !patch.required) {
        patch.received = 0;
        patch.treated = false;
      }
      await setConfig(item, patch);
    });
  }

  el.querySelector(".ce-dh-reset")?.addEventListener("click", async (event) => {
    event.preventDefault();
    await setConfig(item, { received: 0, treated: false });
  });

  makeCollapsible(app, el, {
    key: "dedicated-healing",
    header: ".ce-dh-header",
    body: ".ce-dh-body",
    configured,
    badge: configured ? `${getConfig(item).received}/${getConfig(item).required}` : null,
  });
}

export function registerDedicatedHealingConfig() {
  Hooks.on("renderItemSheetPF", injectSection);
}
