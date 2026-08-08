/**
 * pf1-critical-effects — collapsible item-sheet sections.
 *
 * A section appended to the Advanced tab is dead space on the majority of items that don't
 * configure it. This turns a section's existing `h3.form-header` into the toggle: the section's
 * own topical icon doubles as the disclosure control — full strength when open, dimmed when
 * closed — so an expanded header looks exactly as it did before. An optional badge on the right
 * keeps a summary visible while collapsed.
 *
 * Expanded state lives in memory for as long as the sheet is open, keyed by `appId`. Reopening
 * the item re-applies the default, which is "open only if this section is actually configured".
 * Nothing is written to the document.
 *
 * Ported from astora-mod's `buff-automation/sheet-section-collapse.mjs` rather than imported:
 * dedicated healing was moved here precisely so it works with astora-mod absent, and a shared
 * helper would put that back. The class names are namespaced to this module so the two copies
 * can't fight over styling when both are installed.
 */

/** @type {Map<string, boolean>} `${appId}:${key}` → expanded */
const memo = new Map();

/**
 * Make a section collapsible by its header.
 *
 * @param {Application} app                  The sheet the section was injected into.
 * @param {JQuery|HTMLElement} section        Section root.
 * @param {object} opts
 * @param {string} opts.key                   Distinguishes sections sharing one sheet.
 * @param {string} opts.header                Selector for the header inside `section`.
 * @param {string} opts.body                  Selector for the collapsible body inside `section`.
 * @param {boolean} [opts.configured]         Default-open when true.
 * @param {number|string|null} [opts.badge]   Shown at the header's right edge. `null` omits the
 *                                            element entirely; a falsy value keeps it in the DOM
 *                                            but hidden, so the section's own code can update it
 *                                            in place.
 * @param {string} [opts.title]               Header tooltip.
 */
export function makeCollapsible(app, section, { key, header, body, configured = false, badge = null, title = "Click to expand / collapse" } = {}) {
  const root = section instanceof jQuery ? section[0] : section;
  const headerEl = root?.querySelector(header);
  const bodyEl = root?.querySelector(body);
  if (!headerEl || !bodyEl) return;

  root.classList.add("ce-collapsible");
  headerEl.classList.add("ce-collapse-header");
  headerEl.setAttribute("title", title);

  if (badge !== null) {
    const el = document.createElement("span");
    el.className = "ce-collapse-badge";
    el.textContent = String(badge);
    if (!badge) el.style.display = "none";
    headerEl.append(el);
  }

  const memoKey = `${app.appId}:${key}`;
  let expanded = memo.get(memoKey) ?? !!configured;

  const apply = () => {
    root.classList.toggle("ce-collapsed", !expanded);
    bodyEl.style.display = expanded ? "" : "none";
  };
  apply();

  headerEl.addEventListener("click", (event) => {
    // Headers can carry their own controls; let those win.
    if (event.target.closest("a, button, input, select")) return;
    event.preventDefault();
    expanded = !expanded;
    memo.set(memoKey, expanded);
    apply();
  });
}

/** Drop a sheet's remembered state when it closes. */
function forget(app) {
  const prefix = `${app.appId}:`;
  for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k);
}

Hooks.on("closeItemSheetPF", forget);
