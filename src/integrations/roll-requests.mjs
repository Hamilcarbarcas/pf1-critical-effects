/* pf1-roll-requests helpers.
 *
 * Every die a player rolls during a resolution goes through a roll request, so the player gets a
 * card to click and the result comes back mapped to its table row rather than as a bare number.
 *
 * Whether the table is PRINTED onto that card differs by draw, and deliberately so: the crit
 * resolution's Location and Power rolls show theirs, because the chart is what makes the number
 * mean anything to the player who rolled it (DESIGN.md §7.5). The fumble draw does not — its
 * table is a flat d20 of twenty unrelated mishaps, and showing it spoils the nineteen that didn't
 * happen.
 */

import { MODULE_ID } from "../const.mjs";
import { FUMBLE_ROWS } from "../catalog/schema.mjs";

/** Set on the REQUEST card, pointing back at the attack card the result belongs to. */
export const DRAW_FLAG = "fumbleDraw";

export const available = () => !!game.pf1RollRequests;

/**
 * Post a targeted d12 draw against a fumble table. The player clicks to roll it; this call does
 * NOT wait for that.
 *
 * The result is picked up later from the `pf1RollRequests.rollComplete` hook rather than from a
 * callback or an awaited promise. That matters because the wait is open-ended — a player may
 * take minutes to click — and roll-requests' own `onResult` / `awaitResult` are held in memory
 * on the GM's client, so a GM reload in the meantime would drop the pending draw silently. A
 * flag on the request card plus a global hook survives that.
 *
 * @param {object} opts
 * @param {TokenDocument} opts.token       the fumbling token
 * @param {object[]} opts.resultTable      threshold rows from catalog.fumbleResultTable()
 * @param {string} opts.flavor
 * @param {string|null} opts.sourceMessageId  the attack card to write the result back onto; null
 *                                            for a hand-started draw, which gets a card of its own
 * @param {string} opts.tableKey
 * @param {string|null} [opts.fumblerName]    carried for that card's header
 * @param {object|null} [opts.speaker]        carried for that card's speaker
 * @returns {Promise<ChatMessage|null>} the request card
 */
export async function postFumbleDraw({
  token,
  resultTable,
  flavor,
  sourceMessageId = null,
  tableKey,
  fumblerName = null,
  speaker = null,
}) {
  if (!available()) {
    ui.notifications.warn(`${MODULE_ID}: pf1-roll-requests is not active; cannot post the fumble draw.`);
    return null;
  }

  // createRequest is GM-gated and returns undefined for a non-GM caller. The only route here is
  // the GM-only Resolve Fumble button, so this is a guard against a future caller, not a case.
  if (!game.user.isGM) {
    console.error(`${MODULE_ID} | roll-requests: postFumbleDraw must run GM-side`);
    return null;
  }

  const message = await game.pf1RollRequests.createRequest({
    type: "dice",
    key: `1d${FUMBLE_ROWS}`,
    mode: "targeted",
    flavor,
    targetedActors: [{ id: token.id }],
    autoRoll: false, // the player clicks to roll
    resultTable,
    // No `showTable`: the draw is a d20 against a table nobody needs to read to roll it, and
    // printing all twenty outcomes onto the card spoils nineteen fumbles to save reading one.
    // `resultTable` stays, so the result still lands as its entry's name rather than a number.
    showResults: true,
  });

  if (!message) return null;

  // Stamped after creation because createRequest takes no flag passthrough. The window before
  // this lands is a render plus a human reaction, so a roll cannot realistically beat it; a roll
  // that somehow did would simply find no flag and be ignored.
  //
  // The fumbler's name and speaker are stored rather than re-derived when the roll lands: a draw
  // waits on a human, and by then the token may have been deleted or the scene changed. The ids
  // ride along for the same reason — a fumble that inflicts a condition needs something to apply
  // it to, and the token is the only thing here that knows who fumbled.
  await message.setFlag(MODULE_ID, DRAW_FLAG, {
    sourceMessageId,
    tableKey,
    fumblerName,
    speaker,
    tokenId: token.id ?? null,
    actorId: token.actor?.id ?? null,
  });

  return message;
}

/** Pull the single rolled total off a targeted request card's result payload. */
export function totalFromResult(result) {
  return typeof result?.total === "number" ? result.total : null;
}

/**
 * Post a targeted roll against a threshold table and call back when it lands.
 *
 * Used for the crit resolution's Location and Power rolls, which the ATTACKING player rolls. The
 * table is the point: `showTable` renders every row with its derived range and highlights the one
 * that came up, so the player sees the location chart or the effect table rather than a bare
 * number, and the highlight maintains itself.
 *
 * Unlike the fumble draw, this uses roll-requests' in-memory `onResult` rather than a flag plus
 * the global hook. That is a deliberate match to where the state lives: the crit resolution is a
 * dialog on the GM's client, so a GM reload loses the resolution anyway and there would be
 * nothing for a recovered result to be delivered to.
 *
 * @param {object} opts
 * @param {TokenDocument} opts.token       whose player is asked to roll
 * @param {string} opts.formula            any valid roll formula; validated by createRequest
 * @param {object[]} opts.resultTable      threshold rows ({ min?, label })
 * @param {string} opts.flavor
 * @param {boolean} [opts.clampTable]      trim open-ended ends to what the formula can reach
 * @param {(payload: object) => void} opts.onResult
 * @returns {Promise<ChatMessage|null>} the request card, for later closeRequest
 */
export async function postTableRoll({ token, formula, resultTable, flavor, clampTable = false, onResult }) {
  if (!available()) {
    ui.notifications.warn(`${MODULE_ID}: pf1-roll-requests is not active; cannot post that roll.`);
    return null;
  }
  if (!game.user.isGM) {
    console.error(`${MODULE_ID} | roll-requests: postTableRoll must run GM-side`);
    return null;
  }
  if (!token) {
    ui.notifications.warn(`${MODULE_ID}: no token to ask for that roll.`);
    return null;
  }

  return (
    (await game.pf1RollRequests.createRequest({
      type: "dice",
      key: formula,
      mode: "targeted",
      flavor,
      targetedActors: [{ id: token.id }],
      autoRoll: false, // the player clicks to roll
      resultTable,
      showTable: true,
      showResults: true,
      clampTable,
      onResult,
    })) ?? null
  );
}

/**
 * Post the same kind of card as a CHOICE rather than a roll.
 *
 * `selectFromTable` turns the die into a list button: the player picks a row and that row is
 * recorded as their result. Used for a called shot, where the point is that the location was
 * decided rather than diced.
 *
 * The payload keeps the shape of a rolled one, with one difference that matters to callers: the
 * pick arrives as `selectedIndex` / `selectedLabel`, and `total` is only the row's threshold.
 * Read the index — re-deriving the row from the total is exactly what the index exists to avoid.
 *
 * @param {object} opts
 * @param {TokenDocument} opts.token       whose player is asked to choose
 * @param {object[]} opts.resultTable      the list of choices; required by roll-requests
 * @param {string} opts.flavor
 * @param {(payload: object) => void} opts.onResult
 * @returns {Promise<ChatMessage|null>}
 */
export async function postTableSelect({ token, resultTable, flavor, onResult }) {
  if (!available()) {
    ui.notifications.warn(`${MODULE_ID}: pf1-roll-requests is not active; cannot post that choice.`);
    return null;
  }
  if (!game.user.isGM) {
    console.error(`${MODULE_ID} | roll-requests: postTableSelect must run GM-side`);
    return null;
  }
  if (!token) {
    ui.notifications.warn(`${MODULE_ID}: no token to ask for that choice.`);
    return null;
  }

  return (
    (await game.pf1RollRequests.createRequest({
      mode: "targeted",
      flavor,
      targetedActors: [{ id: token.id }],
      // The table IS the list of choices, so it is required rather than optional here. `type`,
      // `key` and `autoRoll` all drop out: nothing is rolled and nobody can choose on a player's
      // behalf.
      selectFromTable: true,
      resultTable,
      showTable: true,
      showResults: true,
      onResult,
    })) ?? null
  );
}

/** Delete a request card that has served its purpose, if the API is there to do it politely. */
export async function closeRequest(message) {
  if (!message || !available()) return;
  try {
    await game.pf1RollRequests.closeRequest(message);
  } catch (err) {
    console.error(`${MODULE_ID} | roll-requests: closing a request failed:`, err);
  }
}
