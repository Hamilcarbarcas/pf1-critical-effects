/* pf1-roll-requests helpers.
 *
 * Every die a player rolls during a resolution goes through a roll request, so the player gets
 * the card, the table, and their highlighted row for free (DESIGN.md §7.1 step 4).
 */

import { MODULE_ID } from "../const.mjs";
import { gmRequest } from "./socket.mjs";

export const available = () => !!game.pf1RollRequests;

/**
 * Post a targeted d12 draw against a fumble table and return the total once it is rolled.
 *
 * `autoRoll: true` rolls every target GM-side before `createRequest` resolves, so the returned
 * message's flags already carry the result — no callback, no awaitResult (which is single-mode
 * only anyway). Targeted results live in `flags.<rr>.actorResults`, keyed by `resultKey`.
 *
 * @param {object} opts
 * @param {TokenDocument} opts.token   the fumbling token
 * @param {object[]} opts.resultTable  threshold rows from catalog.fumbleResultTable()
 * @param {string} opts.flavor
 * @returns {Promise<{ total: number|null, messageId: string|null }>}
 */
export async function requestFumbleDraw({ token, resultTable, flavor }) {
  if (!available()) {
    ui.notifications.warn(`${MODULE_ID}: pf1-roll-requests is not active; cannot post the fumble draw.`);
    return { total: null, messageId: null };
  }

  const options = {
    type: "dice",
    key: "1d12",
    mode: "targeted",
    flavor,
    targetedActors: [{ id: token.id }],
    autoRoll: true,
    resultTable,
    showTable: true,
    showResults: true,
  };

  // createRequest is GM-gated; a player-initiated resolution routes through our own socket.
  if (!game.user.isGM) {
    const result = await gmRequest("createRollRequest", options);
    if (!result?.messageId) return { total: null, messageId: null };
    // The GM has created and rolled the card, but the create/update broadcasts reach this
    // client independently of the socket reply, so the message may not be here yet.
    const message = await awaitResult(result.messageId);
    return { total: readTotal(message), messageId: result.messageId };
  }

  const message = await game.pf1RollRequests.createRequest(options);
  if (!message) return { total: null, messageId: null };
  return { total: readTotal(message), messageId: message.id };
}

/** Pull the single rolled total off a targeted request card. */
function readTotal(message) {
  const results = message?.flags?.["pf1-roll-requests"]?.actorResults ?? {};
  const [first] = Object.values(results);
  return typeof first?.total === "number" ? first.total : null;
}

/** Wait for a broadcast message to arrive locally and carry a result. */
async function awaitResult(messageId, { timeout = 5000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const message = game.messages.get(messageId);
    if (message && readTotal(message) != null) return message;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  console.error(`${MODULE_ID} | roll-requests: timed out waiting for result on message ${messageId}`);
  return game.messages.get(messageId) ?? null;
}
