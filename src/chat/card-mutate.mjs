/* Writing resolution results onto a chat card — the originating attack card when there is one,
 * and a card created here when there is not (`createCritResultCard`).
 *
 * The result lives in a message flag and is rendered from it on every draw, for the same reason
 * the buttons do: stored HTML would not survive a re-render and would not match across clients.
 * That is also what makes the standalone card cheap — it is a container, and every renderer in
 * this file already works on any message that carries the flag.
 */

import { MODULE_ID } from "../const.mjs";
import { gmRequest } from "../integrations/socket.mjs";
import { criticalTotal } from "../integrations/pf1-pipeline.mjs";
import { describeConditions } from "../resolve/conditions.mjs";

const RESULT_FLAG = "fumbleResult";

/**
 * Record a fumble result on the attack card.
 * @param {ChatMessage} message
 * @param {object} result  { tableKey, total, entryId, name, text, note, conditions }
 */
export async function setFumbleResult(message, result) {
  const key = `flags.${MODULE_ID}.${RESULT_FLAG}`;
  if (game.user.isGM) await message.update({ [key]: result });
  else await gmRequest("updateDocument", { uuid: message.uuid, updates: { [key]: result } });
}

export const getFumbleResult = (message) => message.getFlag(MODULE_ID, RESULT_FLAG) ?? null;

/**
 * A card of its own, for a fumble with no attack behind it.
 *
 * The quick-action draw (§7.1) is started by hand, so there is no attack card to write the result
 * onto — exactly the position the standalone crit resolver is in, and answered the same way:
 * a container carrying only who fumbled, into which the render hook below draws the result from
 * the flag. One renderer, one appearance.
 *
 * @param {object} opts
 * @param {string} opts.fumblerName  already routed through the name-obfuscation API by the caller
 * @param {object|null} [opts.speaker]
 * @returns {Promise<ChatMessage|undefined>}
 */
export async function createFumbleResultCard({ fumblerName = null, speaker = null } = {}) {
  // Coalesced rather than defaulted: the name is read off a stored flag, where "nobody recorded
  // one" arrives as an explicit null and a parameter default would not fire.
  const who = foundry.utils.escapeHTML(fumblerName ?? "—");

  const content = `
    <div class="ce-fumble-card chat-card">
      <header class="ce-fumble-card-header">
        <span class="ce-fumble-card-parties">${who}</span>
      </header>
    </div>
    <div class="card-buttons"></div>`;

  return ChatMessage.create({ content, ...(speaker ? { speaker } : {}) });
}

const CRIT_RESULT_FLAG = "critResult";

/**
 * Record a finished critical resolution on the attack card.
 *
 * The resolution itself runs in a GM-only dialog, so this is the part of it that becomes public
 * and permanent — the same role the fumble result block plays on the fumble path (§7.1).
 *
 * @param {ChatMessage} message
 * @param {object} result  { choice, location, grade, row, total, deadly, save, entryId, name,
 *                           text, note, conditions }
 */
export async function setCritResult(message, result) {
  const key = `flags.${MODULE_ID}.${CRIT_RESULT_FLAG}`;
  if (game.user.isGM) await message.update({ [key]: result });
  else await gmRequest("updateDocument", { uuid: message.uuid, updates: { [key]: result } });
}

export const getCritResult = (message) => message.getFlag(MODULE_ID, CRIT_RESULT_FLAG) ?? null;

/**
 * A card of its own, for a resolution with no attack behind it.
 *
 * A hand-driven resolution (§7.5) has no attack card to write onto, and without one its result
 * would exist nowhere but the GM's dialog — which closes on Confirm. So it gets a card, and
 * `record()` then treats it exactly like an attack card.
 *
 * The HTML here carries **only** what the attack card would have supplied: who hit whom, and what
 * the Critical Power roll came to. The effect itself is deliberately *not* written into it — that
 * goes into the same `critResult` flag, and the same render hook below draws it, appending inside
 * this card's `.chat-card`. One renderer, one appearance, and the buff button attaches by the same
 * route because `.card-buttons` is here for it to find.
 *
 * @param {object} opts
 * @param {string|null} opts.attackerName  omitted from the header when there is no source
 * @param {string} opts.targetName
 * @param {string|null} opts.grade
 * @param {string|null} opts.formula
 * @param {number|null} opts.total
 * @param {object|null} opts.speaker
 * @returns {Promise<ChatMessage|undefined>}
 */
export async function createCritResultCard({
  attackerName = null,
  targetName = "—",
  grade = null,
  formula = null,
  total = null,
  speaker = null,
} = {}) {
  const escape = foundry.utils.escapeHTML;

  // Each name is escaped on its own, because the arrow between them is markup and must not be.
  const parties = attackerName
    ? `${escape(attackerName)} <i class="fa-solid fa-arrow-right"></i> ${escape(targetName)}`
    : escape(targetName);

  const roll = formula && total != null ? `${formula} = ${total}` : formula;
  const power = [grade, roll].filter(Boolean).map((part) => escape(String(part))).join(" · ");

  const content = `
    <div class="ce-crit-card chat-card">
      <header class="ce-crit-card-header">
        <span class="ce-crit-card-parties">${parties}</span>
        ${power ? `<span class="ce-crit-card-power">${power}</span>` : ""}
      </header>
    </div>
    <div class="card-buttons"></div>`;

  return ChatMessage.create({ content, ...(speaker ? { speaker } : {}) });
}

const EXPLOSION_FLAG = "explosions";

/**
 * Record how many times each attack's confirmation came up a threat.
 *
 * Keyed by attack index, because a full attack can explode on more than one of its swings and the
 * resolution needs to know which one it is resolving.
 *
 * @param {ChatMessage} message
 * @param {Record<number, number>} counts  attack index -> explosion count
 */
export async function setExplosions(message, counts) {
  const key = `flags.${MODULE_ID}.${EXPLOSION_FLAG}`;
  if (game.user.isGM) await message.update({ [key]: counts });
  else await gmRequest("updateDocument", { uuid: message.uuid, updates: { [key]: counts } });
}

export const getExplosions = (message) => message?.getFlag(MODULE_ID, EXPLOSION_FLAG) ?? null;

/** How many times THIS attack's confirmation threatened. */
export const explosionCount = (message, attackIndex = 0) =>
  Number(getExplosions(message)?.[attackIndex] ?? 0) || 0;

/**
 * An entry's prose, enriched.
 *
 * Since v5 the catalog owns its own text, so this is the whole of what used to be a journal link —
 * the prose is on the card rather than one click away in a compendium. It goes through PF1's
 * enricher, which is what makes `@Bleed[2d6;deep=20]`, `@Condition[stunned]` and `@Damage[…]`
 * render as the clickable buttons those modules already provide.
 *
 * `enrichHTML` is async and render hooks are not, so the block is appended when it resolves. That
 * is a frame later than the rest of the card and it does not matter: nothing is laid out relative
 * to it, and the alternative is blocking every chat render on an enrich.
 *
 * @param {HTMLElement} block  the result block to append to
 * @param {string} text
 */
function appendProse(block, text) {
  if (!text) return;

  const prose = document.createElement("div");
  prose.className = "ce-effect-text";
  block.append(prose);

  const editor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  Promise.resolve(editor.enrichHTML(text, { rollData: {} }))
    .then((html) => { prose.innerHTML = html; })
    .catch((err) => {
      console.error(`${MODULE_ID} | could not enrich effect prose:`, err);
      prose.textContent = text;
    });
}

/**
 * The conditions a result inflicted, as a line on the card.
 *
 * Shown whether or not anyone pressed the apply button, because "stunned 1 round" is part of what
 * happened even when the GM sets it by hand. Durations are the AUTHORED values — `1d4 minutes`,
 * not the number the button rolled — since this line is a statement of the entry, and the applied
 * roll lives on the condition itself where a GM can read and change it.
 *
 * @param {HTMLElement} block
 * @param {object[]} conditions
 */
function appendConditions(block, conditions) {
  if (!conditions?.length) return;

  const line = document.createElement("div");
  line.className = "ce-effect-conditions";

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-triangle-exclamation";
  line.append(icon, document.createTextNode(` ${describeConditions(conditions)}`));
  block.append(line);
}

/* --- deferred critical damage, in PF1's own critical column ------------------
 *
 * With crit damage deferred (§9), PF1 still renders the critical column — `hasCritConfirm` is
 * true, so `<th data-damage-type="critical">` is in the card with two apply anchors whose
 * `data-value` is empty. So there is nothing to add: the cell to fill is already there, and
 * filling it is what puts the damage back where players expect to find it.
 *
 * The card's HTML is stored, not regenerated, which is why this is a render-time injection rather
 * than a content rewrite. The DATA, though, goes into `system.rolls` (see pf1-pipeline.mjs) —
 * that is what PF1's apply handler reads to build per-type damage instances for DR and energy
 * resistance. This function only paints what that data says.
 *
 * ── Telling a suppressed cell from a filled one ─────────────────────────────
 * NOT by whether the cell looks blank. `AttackDamage#total` initialises to **0**, not to nothing
 * (chat-attack.mjs:364), so a suppressed column renders the literal text `0` — and a guard that
 * skipped any non-blank anchor skipped every card it was supposed to fill.
 *
 * The reliable test is the stored data: if the anchor already reads the total that
 * `system.rolls` says, PF1 rendered this card with the damage in hand and it is not ours to
 * touch. Anything else — `0`, or a stale total from before the damage was rolled — is ours.
 */
function decorateCriticalColumn(message, root) {
  const attacks = message.systemRolls?.attacks;
  if (!attacks?.length) return;

  for (const index of attacks.keys()) {
    const cell = root.querySelector(`.chat-attack[data-index="${index}"] th[data-damage-type="critical"]`);
    if (!cell) continue;

    if (cell.dataset.ceFilled) continue; // already ours, on an earlier render of the same card

    const anchor = cell.querySelector("a.fake-inline-roll");
    if (!anchor) continue;

    const total = criticalTotal(message, index);
    if (total == null) {
      // No critical damage has been rolled: the apply anchors carry the same placeholder zero, so
      // a click applies nothing while looking like it did something. Take them away, and replace
      // the zero so the column doesn't read as "the critical did no damage".
      for (const dead of cell.querySelectorAll('a[data-action="applyDamage"]')) dead.remove();
      if (anchor.textContent.trim() === "0") anchor.textContent = "—";
      continue;
    }

    if (Number(anchor.textContent.trim()) === total) continue; // PF1 filled it itself

    cell.dataset.ceFilled = "1";
    anchor.textContent = String(total);

    // The label PF1 would have written, taken from PF1's own string rather than a copy of it.
    // Only when it isn't already there — an unsuppressed card renders its own flavor.
    const label = game.i18n.localize("PF1.DamageCritical");
    if (!cell.textContent.includes(label)) cell.prepend(document.createTextNode(`${label} `));

    // Revive the apply buttons. Full and half are the only two PF1 offers, and `half` is a plain
    // floor of the total (chat-attack.mjs AttackDamage#half).
    for (const button of cell.querySelectorAll('a[data-action="applyDamage"]')) {
      const ratio = Number(button.dataset.ratio);
      button.dataset.value = String(ratio === 0.5 ? Math.floor(total / 2) : total);
    }
  }
}

/* --- the per-part breakdown, in PF1's own damage rows ------------------------
 *
 * The column total is not the whole picture: under it PF1 lists one row per damage part, with the
 * roll and its damage type, for the normal side and the critical side together. Suppression takes
 * the critical half of that away — `finalize()` (chat-attack.mjs ~340) pairs `damageRows[a].crit`
 * with `critDamage.rolls[a]`, and there are none — so every row renders `<td></td><td></td>` on
 * the critical side. Those empty cells are what this fills.
 *
 * Three details are PF1's, not ours, and are reproduced rather than approximated:
 *
 *   pairing    Positional, exactly as `finalize()` does it: crit roll `a` goes in row `a`. It does
 *              NOT group by critical pass, so a ×3 weapon with two damage parts fills rows 0-3
 *              from one flat list.
 *   overflow   The critical pass rolls `critMult - 1` times AND adds the action's `critParts`
 *              (action.mjs ~1669), so it can produce more rolls than there are normal rows. PF1
 *              handles that by sizing the row list to the longer of the two; with the crit side
 *              deferred, the card was built to the shorter one, so the extra rows are appended
 *              here with an empty normal side — the same shape PF1 would have rendered.
 *   the anchor `roll.toAnchor()`, the same call `_createInlineRoll` makes, so the expandable dice
 *              breakdown behaves identically. The rolls are live `Roll` instances by this point
 *              because PF1 rehydrates `system.rolls` at prepare time.
 *
 * The damage type is rendered through PF1's own partial rather than rebuilt, because a critical
 * part is not guaranteed to share the normal parts' types — `critParts` can introduce its own.
 * That makes this async; the hook does not await, so the rows land a frame after the total.
 */
async function decorateCriticalRows(message, root) {
  const attacks = message.systemRolls?.attacks;
  if (!attacks?.length) return;

  for (const index of attacks.keys()) {
    const critRolls = attacks[index]?.critDamage ?? [];
    if (!critRolls.length) continue;

    const container = root.querySelector(`.chat-attack[data-index="${index}"]`);
    if (!container || container.dataset.ceRows) continue;

    const rows = damageRowsOf(container);
    // A crit cell already present means PF1 built this card with the damage in hand.
    if (!rows.length || rows.some((row) => halvesOf(row).critical[0]?.classList.contains("critical"))) continue;

    container.dataset.ceRows = "1";

    // `last` tracks the row to append after, and has to advance as rows are added — inserting
    // every overflow row after the same original last row would reverse their order.
    let last = rows.at(-1);

    for (const [position, roll] of critRolls.entries()) {
      const row = rows[position] ?? appendDamageRow(last);
      if (!row) break;
      last = row;
      await fillCritCells(row, roll);
    }
  }
}

/**
 * The per-part rows under an attack's damage header, in order.
 *
 * Anchored on the header rather than found by shape. "Every `<tr>` made of `<td>`s" also catches
 * `<tr class="attack">` — the attack roll and its confirmation, two `colspan="2"` cells sitting
 * *above* the damage header (attack-roll.hbs ~86) — and taking that as row 0 means the real first
 * damage row is never reached. The rows that matter are exactly the contiguous run following the
 * `<th data-damage-type="critical">` header, which is also proof the critical column exists.
 */
function damageRowsOf(container) {
  const header = container.querySelector('th[data-damage-type="critical"]')?.parentElement;
  if (!header) return [];

  const rows = [];
  for (let row = header.nextElementSibling; row; row = row.nextElementSibling) {
    if (row.tagName !== "TR" || !cellsOf(row).length) break;
    rows.push(row);
  }
  return rows;
}

const cellsOf = (row) => [...(row?.children ?? [])].filter((cell) => cell.tagName === "TD");

/**
 * A damage row's normal and critical halves.
 *
 * By halves rather than by index, because the cell COUNT is not ours to assume. PF1 renders four
 * cells — roll, type, crit roll, crit type — but Little Helper's "Meld Damage & Type" merges each
 * pair into one `colspan="2"` cell and deletes the second (meld-damage-rolls.mjs ~21), leaving
 * two. Indexing at 2 and 3 finds nothing on a melded card, which is exactly what it did.
 *
 * The split holds either way: the template emits the critical cells only under
 * `{{#if atk.hasCritConfirm}}` and emits the same number it emitted for the normal side, so the
 * row is symmetric by construction and anything that transforms it pairwise keeps it that way.
 * It is also order-independent — melded before we run, we fill one cell; melded after, we fill two
 * and the meld collapses them like any other pair.
 */
function halvesOf(row) {
  const cells = cellsOf(row);
  const half = Math.ceil(cells.length / 2);
  return { normal: cells.slice(0, half), critical: cells.slice(half) };
}

/**
 * A row PF1 would have rendered had it known about this roll: empty normal side, crit side ours.
 *
 * Cloned from the row above rather than built from scratch, so it inherits whatever shape that row
 * actually has — cell count, colspans, and any melding — instead of a guess at what it should be.
 */
function appendDamageRow(after) {
  if (!after) return null;

  const row = after.cloneNode(true);
  const { normal, critical } = halvesOf(row);
  for (const cell of [...normal, ...critical]) cell.replaceChildren();
  for (const cell of normal) cell.className = ""; // an absent normal part, not a copy of one

  after.after(row);
  return row;
}

async function fillCritCells(row, roll) {
  const { normal, critical } = halvesOf(row);
  const [rollCell, typeCell] = critical;
  if (!rollCell) return;

  const anchor = roll.toAnchor({ classes: ["inline-dsn-hidden"] });

  /* Mirror the normal side rather than hardcoding what the cell should look like. Whatever
   * decorated that anchor — Little Helper's `lil-melded-roll`, or anything else — applies just as
   * much to the critical roll beside it, and mirroring keeps the two halves matching without this
   * module knowing which module did it. */
  for (const cls of normal[0]?.querySelector("a.inline-roll")?.classList ?? []) anchor.classList.add(cls);

  rollCell.className = criticalTwin(normal[0]);
  rollCell.replaceChildren(anchor);

  const typeHTML = await renderTemplate("systems/pf1/templates/internal/damage-type-visual.hbs", {
    damage: roll.damageType,
  });

  if (typeCell) {
    typeCell.className = "damage-type";
    typeCell.innerHTML = typeHTML;
    return;
  }

  // One cell for the whole half: the pair was merged, so the type goes beside the roll — the same
  // place, and the same way, the merge put the normal side's type beside its roll.
  const holder = document.createElement("div");
  holder.innerHTML = typeHTML;
  rollCell.append(" ", ...holder.childNodes);
}

/** The normal cell's own classes, as they would read on the critical side. */
function criticalTwin(normalCell) {
  const classes = [...(normalCell?.classList ?? [])];
  if (!classes.includes("normal")) return "roll damage critical";
  return classes.map((cls) => (cls === "normal" ? "critical" : cls)).join(" ");
}

/** v13 namespaced the helper; the bare global is a deprecation shim. */
const renderTemplate = (...args) =>
  (foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate)(...args);

/* The explosion count, on the attack it belongs to.
 *
 * Placed inside `.chat-attack[data-index]` rather than at the foot of the card, because a full
 * attack can explode on one swing and not another and a single line at the bottom could not say
 * which. */
function decorateExplosions(message, root) {
  const counts = getExplosions(message);
  if (!counts) return;

  for (const [index, count] of Object.entries(counts)) {
    if (!count) continue;
    const attack = root.querySelector(`.chat-attack[data-index="${index}"]`);
    if (!attack || attack.querySelector(".ce-explosion-count")) continue;

    const block = document.createElement("div");
    block.className = "ce-explosion-count";
    block.append(
      Object.assign(document.createElement("i"), { className: "fa-solid fa-burst" }),
      document.createTextNode(` Critical Explosion ×${count}`)
    );

    // After the attack's own table, before its buttons and notes.
    attack.querySelector("table")?.after(block) ?? attack.prepend(block);
  }
}

export function registerCardMutation() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    try {
      decorateCriticalColumn(message, root);
    } catch (err) {
      console.error(`${MODULE_ID} | decorating the critical damage column failed:`, err);
    }
    // Async because it renders PF1's damage-type partial; the hook does not await, so this
    // finishes a frame later. Kept separate from the total so a failure here cannot cost the
    // card its damage figure.
    decorateCriticalRows(message, root).catch((err) => {
      console.error(`${MODULE_ID} | decorating the critical damage rows failed:`, err);
    });
    try {
      decorateExplosions(message, root);
    } catch (err) {
      console.error(`${MODULE_ID} | decorating the explosion count failed:`, err);
    }
  });

  // The finished resolution, rendered from the flag so it reads the same for everyone.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const result = getCritResult(message);
    if (!result) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".ce-crit-result")) return;

    const block = document.createElement("div");
    block.className = "ce-crit-result";

    const header = document.createElement("div");
    header.className = "ce-fumble-result-header";
    const label = document.createElement("span");
    label.className = "ce-fumble-label";
    label.textContent = "Critical Effect";

    const detail = document.createElement("span");
    detail.className = "ce-fumble-total";
    // Location and the row it landed on: the two facts that say where the effect came from. The
    // severity band this used to show no longer exists — the table's twelve rows are the ladder.
    detail.textContent =
      [result.location, result.row ? `row ${result.row}` : null].filter(Boolean).join(" · ") || "—";
    header.append(label, detail);

    block.append(header);

    if (result.name) {
      const name = document.createElement("div");
      name.className = "ce-fumble-name";
      name.textContent = result.name;
      block.append(name);
    }

    if (result.save?.dc) {
      const save = document.createElement("div");
      save.className = "ce-deadly";
      save.textContent = `Fort DC ${result.save.dc} or die`;
      block.append(save);
    }

    appendConditions(block, result.conditions);
    appendProse(block, result.text);

    /* An entry's note, when it has one — a line for the GM to adjudicate rather than anything
     * automated. `textContent`, so an author's apostrophe or angle bracket is text and not markup.
     * `text` above is the field that is allowed to carry formatting; this one is not. */
    if (result.note) {
      const note = document.createElement("div");
      note.className = "ce-effect-note";
      note.textContent = result.note;
      block.append(note);
    }

    (root.querySelector(".chat-card") ?? root.querySelector(".message-content") ?? root).appendChild(block);
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const result = getFumbleResult(message);
    if (!result) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".ce-fumble-result")) return;

    const block = document.createElement("div");
    block.className = "ce-fumble-result";

    const header = document.createElement("div");
    header.className = "ce-fumble-result-header";
    const label = document.createElement("span");
    label.className = "ce-fumble-label";
    label.textContent = game.i18n.localize("CRITICAL_EFFECTS.Fumble.ResultLabel");
    const total = document.createElement("span");
    total.className = "ce-fumble-total";
    total.textContent = `${result.tableKey} d12: ${result.total}`;
    header.append(label, total);

    const name = document.createElement("div");
    name.className = "ce-fumble-name";
    name.textContent = result.name;

    block.append(header, name);
    appendConditions(block, result.conditions);
    appendProse(block, result.text);

    if (result.note) {
      const note = document.createElement("div");
      note.className = "ce-effect-note";
      note.textContent = result.note;
      block.append(note);
    }

    const container = root.querySelector(".chat-card") ?? root.querySelector(".message-content") ?? root;
    container.appendChild(block);
  });
}
