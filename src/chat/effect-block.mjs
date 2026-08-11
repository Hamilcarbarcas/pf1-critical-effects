/* The execution block: what an entry's mechanics look like on a card (DESIGN.md §7.6).
 *
 * One renderer, used by both the critical result and the fumble result, because a fumble that
 * breaks your hand and a critical that breaks someone else's are the same three channels pointed at
 * a different person.
 *
 * ── Sync structure, async decoration ────────────────────────────────────────
 * `renderExecution` is **synchronous** and that is load-bearing, not incidental. Buttons are
 * mounted by `card-buttons.mjs` from a *later* render hook that runs in the same synchronous pass,
 * and it looks up its container by selector — so every `.ce-branch-buttons` this file emits has to
 * exist by the time it returns. Anything genuinely async (PF1's damage-type partial, the enriched
 * buff description, the embedded save) is kicked off afterwards and lands a frame later, into
 * placeholders that are already in the DOM. Nothing is positioned relative to those, so arriving
 * late costs nothing.
 *
 * ── Two things PF1 must not bind to ─────────────────────────────────────────
 * PF1's `addListeners` (utils/chat.mjs) binds *every* `a[data-action]` in a message to its own chat
 * handler, and binds `.item-name` to its description toggle. So the damage anchors here carry
 * `data-ce-action` rather than `data-action`, and the buff header names itself `.ce-buff-name`
 * rather than `.item-name` — otherwise a click would run PF1's handler as well as ours, applying
 * the damage twice and expanding the *item's* description instead of the buff's.
 */

import { MODULE_ID } from "../const.mjs";
import { conditionIcon, conditionLabel, durationLabel } from "../resolve/conditions.mjs";
import { damageTypeModel, rollOf } from "../resolve/damage.mjs";
import { renderSaveSlot } from "../flow/save-request.mjs";

/** Mount selectors, built here so the renderer and the button descriptors cannot disagree. */
export const branchMount = (scope, branch) => `.${scope} .ce-branch[data-branch="${branch}"] .ce-branch-buttons`;
export const singleMount = (scope) => `.${scope} .ce-effect-buttons`;

/** The branch a descriptor should mount into, whichever shape the entry turned out to have. */
export const mountFor = (scope, branch, branched) => (branched ? branchMount(scope, branch) : singleMount(scope));

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * Draw an entry's mechanics into a result block.
 *
 * @param {HTMLElement} block   the `.ce-crit-result` / `.ce-fumble-result` element
 * @param {object} execution    the stored execution record — see `flow/execution.mjs`
 * @param {object} opts
 * @param {string} opts.scope   the block's own class, so mounts are unambiguous on a card that
 *                              somehow carries both kinds of result
 * @param {ChatMessage} opts.message
 */
export function renderExecution(block, execution, { scope, message } = {}) {
  if (!block || !execution) return;

  const { saved, failed, save, sharedDamage } = execution;
  if (!saved && !failed) return;

  const root = el("div", "ce-execution");
  block.append(root);

  /* The save leads. It is the question the two branches are answers to, and a reader who meets
   * "On a success" before knowing what is being saved against has to read backwards. */
  if (save) {
    const saveBlock = el("div", "ce-save");
    saveBlock.append(el("div", "ce-save-slot"));
    root.append(saveBlock);
    // Async, and allowed to fail: a save widget that cannot draw must not cost the card its
    // branches, its buttons or its damage.
    renderSaveSlot(saveBlock.querySelector(".ce-save-slot"), { message, save }).catch((err) => {
      console.error(`${MODULE_ID} | could not draw the save request:`, err);
    });
  }

  const branched = !!failed;

  for (const [key, branch] of [["saved", saved], ["failed", failed]]) {
    if (!branch) continue;

    const section = el("section", "ce-branch");
    section.dataset.branch = key;

    // Headings only when there are two branches to tell apart. One outcome needs no label saying
    // which outcome it is.
    if (branched) section.append(el("div", "ce-branch-label", key === "saved" ? "On a success" : "On a failure"));

    appendBuff(section, branch.buff, branch.buffName);
    appendConditionHeaders(section, branch.conditions);

    // The mount. Emitted even when nothing will be put in it — an empty container is invisible, and
    // the alternative is card-buttons reporting a missing mount for a branch that simply had no
    // buff and no conditions to apply.
    section.append(el("div", "ce-branch-buttons"));

    // Per-branch damage, only when `onFail` actually overrode it. Shared damage is drawn once,
    // below, where it reads as what it is: something that happens either way.
    if (!sharedDamage && branch.damage) appendDamage(section, branch.damage, key);

    root.append(section);
  }

  // The single-branch case reuses the same container under its own name, so a descriptor for an
  // entry with no save has a mount that does not pretend to be a branch.
  if (!branched) root.querySelector(".ce-branch-buttons")?.classList.add("ce-effect-buttons");

  if (sharedDamage && saved?.damage) appendDamage(root, saved.damage, "saved");
}

/* --- buff header ------------------------------------------------------------
 *
 * PF1's own item-card markup, so the bar arrives in the system's buff colour with no styling of
 * ours: `header.card-header.type-color.type-buff`. What is deliberately NOT PF1's is the click
 * handling — see the file header.
 *
 * `buffName` is passed alongside the snapshot because the two can disagree in exactly one way that
 * matters: a buff the catalog names but no compendium has. Then there is no snapshot to draw and
 * the name is all we know, which is still worth saying — the GM can go and make the buff.
 */
function appendBuff(section, buff, buffName) {
  if (!buff && !buffName) return;

  const card = el("div", "ce-buff-card");

  const header = el("header", "card-header type-color type-buff flexrow");
  if (buff?.img) {
    const img = document.createElement("img");
    img.src = buff.img;
    img.width = 36;
    img.height = 36;
    header.append(img);
  }

  const name = el("div", "ce-buff-name", buff?.name ?? buffName);
  if (buff?.description) name.append(el("i", "fa-solid fa-caret-down ce-buff-caret"));
  header.append(name);

  /* A link to the real item, for anyone who wants the live version rather than the snapshot. Built
   * as PF1/Foundry's own content link so it behaves like every other one in chat — draggable onto
   * a sheet, click to open. */
  if (buff?.uuid) {
    const link = document.createElement("a");
    link.className = "content-link ce-buff-link";
    link.dataset.link = "";
    link.dataset.uuid = buff.uuid;
    link.dataset.tooltip = "Open in compendium";
    link.append(el("i", "fa-solid fa-arrow-up-right-from-square"));
    header.append(link);
  }

  card.append(header);

  if (buff?.description) {
    const body = el("div", "ce-buff-description");
    body.hidden = true; // collapsed until asked for, like the item card it is imitating
    card.append(body);

    name.classList.add("ce-expandable");
    name.addEventListener("click", () => { body.hidden = !body.hidden; });

    enrich(buff.description).then((html) => { body.innerHTML = html; });
  }

  section.append(card);
}

/* --- condition headers ------------------------------------------------------
 *
 * One line per condition: PF1's icon, its name, and the **authored** duration. Not expandable, and
 * not for want of material — the registry carries a `journal` uuid per condition and the SRD text
 * is a click away. A wound's condition is one word the table already knows; the duration is the
 * part that needs saying, and it is the part the SRD would not say.
 */
function appendConditionHeaders(section, conditions) {
  for (const condition of conditions ?? []) {
    const row = el("div", "ce-condition-header");

    const icon = conditionIcon(condition.id);
    if (icon) {
      const img = document.createElement("img");
      img.src = icon;
      img.width = 20;
      img.height = 20;
      row.append(img);
    } else {
      row.append(el("i", "fa-solid fa-triangle-exclamation"));
    }

    row.append(el("span", "ce-condition-name", conditionLabel(condition.id)));

    const duration = durationLabel(condition.duration);
    if (duration) row.append(el("span", "ce-condition-duration", duration));

    section.append(row);
  }
}

/* --- damage -----------------------------------------------------------------
 *
 * The markup PF1 emits for a damage-only attack (`chat/attack-roll.hbs`, the `hasAttack: false`
 * branch): a header carrying the flavor, the total and the two apply anchors, and one row per part
 * underneath. Reproduced rather than referenced — the template is fed a `ChatAttack`, which this is
 * not — but reproduced closely enough to inherit the system's styling wholesale.
 *
 * The flavor is "Effect Damage" rather than PF1's "Damage" for one reason: on an attack card this
 * sits below PF1's own damage table, and two tables both headed "Damage" invite applying the wrong
 * one. This damage is a separate instance that the effect deals, not part of the weapon's.
 */
function appendDamage(parent, damage, branch) {
  if (!damage?.parts?.length) return;

  const wrapper = el("div", "ce-damage");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const th = el("th", "attack-damage");
  th.colSpan = 2;
  th.append(document.createTextNode("Effect Damage "));

  const total = el("a", "attack-damage total fake-inline-roll inline-result", String(damage.total ?? 0));
  total.dataset.tooltip = "PF1.Total";
  th.append(total, applyAnchor(branch, 1), applyAnchor(branch, 0.5));

  headerRow.append(th);
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const part of damage.parts) {
    const row = document.createElement("tr");

    const rollCell = el("td", "roll damage normal");
    const roll = rollOf(part);
    // `toAnchor()` is the same call PF1's `_createInlineRoll` makes, which is what gives the
    // expandable dice breakdown. A part that will not rehydrate still shows its number.
    if (roll) rollCell.append(roll.toAnchor({ classes: ["inline-dsn-hidden"] }));
    else rollCell.textContent = String(part.total ?? 0);

    const typeCell = el("td", "damage-types");
    typeCell.dataset.ceType = part.type;

    row.append(rollCell, typeCell);
    tbody.append(row);
  }
  table.append(tbody);
  wrapper.append(table);
  parent.append(wrapper);

  // The type icons come from PF1's own partial, which is async — so they land a frame after the
  // rest of the table. Rendered once per distinct type rather than once per row.
  fillDamageTypes(wrapper).catch((err) => {
    console.error(`${MODULE_ID} | could not draw effect damage types:`, err);
  });
}

/** One of PF1's two apply anchors — full and floor-of-half, which is all PF1 offers. */
function applyAnchor(branch, ratio) {
  const anchor = el("a", "inline-action");
  anchor.dataset.ceAction = "applyDamage";
  anchor.dataset.branch = branch;
  anchor.dataset.ratio = String(ratio);
  anchor.dataset.tooltip = ratio === 1 ? "PF1.ApplyDamage" : "PF1.ApplyHalf";

  anchor.append(el("i", "fa-solid fa-hammer"));
  anchor.append(ratio === 1 ? el("i", "absolute fa-solid fa-plus") : el("i", "absolute", "½"));
  return anchor;
}

async function fillDamageTypes(wrapper) {
  const cells = [...wrapper.querySelectorAll("td.damage-types[data-ce-type]")];
  const cache = new Map();

  for (const cell of cells) {
    const type = cell.dataset.ceType;
    if (!cache.has(type)) {
      const model = damageTypeModel(type);
      cache.set(
        type,
        model ? await renderTemplate("systems/pf1/templates/internal/damage-type-visual.hbs", { damage: model }) : type
      );
    }
    cell.innerHTML = cache.get(type);
  }
}

/** v13 namespaced both of these; the bare globals are deprecation shims. */
const renderTemplate = (...args) =>
  (foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate)(...args);

async function enrich(text) {
  const editor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    return await editor.enrichHTML(text, { rollData: {} });
  } catch (err) {
    console.error(`${MODULE_ID} | could not enrich a buff description:`, err);
    return foundry.utils.escapeHTML(text);
  }
}
