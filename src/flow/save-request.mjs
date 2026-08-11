/* The Fortitude save an entry can carry (DESIGN.md §6, "The save, and the two branches").
 *
 * ── One save, one DC, one integer ───────────────────────────────────────────
 * Every save here is a Fortitude save, and every DC is the attack's pre-reduction non-critical
 * damage. So an entry authors neither a type nor a DC — it authors `save`, a **multiplier**: 1 for
 * that DC, 2 for the doubled DC most of the 13+ rows call for. The content was reworked to fit
 * that rather than the schema widened to fit the content, and the payoff is this file being short.
 *
 * ── Why the roll is embedded rather than its own card ───────────────────────
 * A card of its own would put the save somewhere other than the two branches it decides between,
 * and the result would have to be carried back. pf1-roll-requests' embed API (its `api.md`
 * § Embedded requests) exists for exactly this: state under a slot on OUR message, drawn into an
 * element WE own, never touching `message.content`. That last part is why the auto-save-request
 * mechanism could not be reused — it works by rewriting the content, and this module's cards are
 * drawn from flags on every render.
 *
 * ── The roll does not gate anything ─────────────────────────────────────────
 * Nothing in this file enables, disables or relabels a button. Both branches are always offered
 * (§6, "Both branches, always") because a luck point, a GM's call on an NPC, or a save rolled by
 * the wrong person are all things that outrank the die. The widget records; the GM decides.
 */

import { MODULE_ID } from "../const.mjs";
import { normalDamageTotal } from "../integrations/pf1-pipeline.mjs";

/** The slot this module owns on a host card. Namespaced by convention — slots may not contain dots. */
export const SAVE_SLOT = "ce-crit-save";

/** Whether the installed pf1-roll-requests is new enough to embed. */
export const embedAvailable = () => typeof game.pf1RollRequests?.embed === "function";

/**
 * The DC an entry's save is rolled against.
 *
 * `null` means "there is nothing to derive it from" — a hand-driven resolution with no attack
 * behind it — and the caller asks the GM instead (`promptForDC`). It does not mean zero, and it
 * must not become zero: a save at DC 0 is a save that always passes, which is worse than no save.
 *
 * @param {ChatMessage|null} message  the attack card, when there is one
 * @param {number} attackIndex
 * @param {number} multiplier         the entry's `save`
 * @returns {number|null}
 */
export function saveDC(message, attackIndex, multiplier) {
  const damage = message ? normalDamageTotal(message, attackIndex) : null;
  if (damage == null) return null;
  return damage * (Number(multiplier) || 1);
}

/**
 * Ask the GM for a DC, for a resolution with no attack to derive one from (§7.5).
 *
 * Deliberately a prompt rather than a fallback formula. A DC invented from the Critical Power total
 * would look derived and be wrong, and the GM is the only one who knows what the blow that caused
 * this actually did.
 *
 * @returns {Promise<number|null>} null if the GM dismissed it — the save then degrades to no save,
 *   which is exactly what a text-only entry gives you
 */
export async function promptForDC({ multiplier = 1, entryName = null } = {}) {
  const { DialogV2 } = foundry.applications.api;

  const doubled = multiplier > 1;
  const content =
    `<p>${entryName ? `<strong>${foundry.utils.escapeHTML(entryName)}</strong> calls for a` : "This effect calls for a"}` +
    ` Fortitude save${doubled ? " at <strong>double</strong> the usual DC" : ""}.</p>` +
    `<p>Its DC is normally the attack's damage, and this resolution has no attack behind it.` +
    ` Enter the damage that caused it${doubled ? " — it will be doubled" : ""}:</p>` +
    `<p><input type="number" name="damage" min="1" step="1" autofocus></p>`;

  const damage = await DialogV2.prompt({
    window: { title: "Critical Effect — Save DC" },
    content,
    ok: {
      label: "Set DC",
      callback: (_event, button) => Number(button.form.elements.damage?.value) || null,
    },
    rejectClose: false,
  }).catch(() => null);

  if (!damage || damage < 1) return null;
  return damage * (Number(multiplier) || 1);
}

/**
 * Put the save on the card, GM-side, at resolution time.
 *
 * `autoRoll` is the whole of the NPC case: a victim with no player to click the row has it rolled
 * immediately, GM-side and dialog-free, which is what `embed()` does with `bulkRollTargeted`. A
 * player-owned victim gets a row to click, because it is their save to make.
 *
 * Failure is never fatal here. An install predating the embed API, or an embed that will not
 * create, leaves the printed DC that `renderSaveSlot` falls back to — the branches, the buttons and
 * the recorded result never depended on the widget.
 *
 * @param {ChatMessage} message
 * @param {object} opts
 * @param {number} opts.dc
 * @param {TokenDocument|null} opts.token  the victim
 */
export async function postSave(message, { dc, token = null } = {}) {
  if (!message || !dc) return;
  if (!embedAvailable()) return; // printed DC only; renderSaveSlot says so on the card
  if (!token) return; // nobody to ask — same outcome

  try {
    await game.pf1RollRequests.embed(message, {
      slot: SAVE_SLOT,
      type: "save",
      key: "fort",
      dc,
      mode: "targeted",
      targetedActors: [{ id: token.id }],
      showDC: true,
      showResults: true,
      // Single target: Roll All, Roll NPCs and the select-* buttons would each do what the one row
      // already does, and the title and GM footer are a second card's chrome inside our card.
      controls: false,
      autoRoll: !token.actor?.hasPlayerOwner,
    });
  } catch (err) {
    console.error(`${MODULE_ID} | could not embed the save request:`, err);
  }
}

/**
 * Draw the save into the slot the execution block emitted.
 *
 * Called on every render, from our own hook, once the container exists — which is the whole reason
 * the embed API splits state from placement. `renderEmbed` throws on a bad container rather than
 * warning, so the caller wraps this; an absent or closed slot empties the container and returns
 * null, which is why "no embed on this card" needs no special case beyond the fallback line.
 *
 * @param {HTMLElement} into
 * @param {object} opts
 * @param {ChatMessage} opts.message
 * @param {{ dc: number|null, multiplier: number }} opts.save
 */
export async function renderSaveSlot(into, { message, save } = {}) {
  if (!into) return;

  if (embedAvailable() && game.pf1RollRequests.getEmbed(message, SAVE_SLOT)) {
    const card = await game.pf1RollRequests.renderEmbed(message, { slot: SAVE_SLOT, into });
    if (card) return;
  }

  // Fallback: the save as a statement. Everything else on the card still works.
  into.replaceChildren();
  const line = document.createElement("div");
  line.className = "ce-save-line";
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-shield-halved";
  line.append(icon, document.createTextNode(` Fortitude DC ${save?.dc ?? "—"}`));
  into.append(line);
}

/**
 * Close the save on a card that is being retired.
 *
 * Locked rather than removed: the result stays on the card as the record of what was rolled, which
 * is the half of the widget that outlives the decision. Only ever called deliberately — a resolved
 * critical keeps its save open, because the save is not what closes it.
 */
export async function closeSave(message) {
  if (!embedAvailable() || !message) return;
  try {
    await game.pf1RollRequests.closeEmbed(message, SAVE_SLOT, { lock: true });
  } catch (err) {
    console.error(`${MODULE_ID} | could not close the save request:`, err);
  }
}
