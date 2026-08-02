/* GM Socket
 *
 * Generic dispatch for operations that require GM permissions. All callers (GM or player) use
 * `game.criticalEffects.gmRequest(fn, args)`; GM clients execute the handler directly, player
 * clients do a socket round-trip and await the result.
 *
 * This socket is deliberately independent of astora-mod's `gmProxy` rather than a thin shim
 * onto it (DESIGN.md §0). Dedicated healing (§8) and the luck dispatch (§7.3) both need a GM
 * channel, and neither may stop working when astora-mod is absent.
 *
 * Handlers are GENERIC PRIMITIVES ONLY — no per-feature entry points. A new feature that needs
 * GM privileges composes the primitives below; if it genuinely cannot, that is a signal the
 * primitive set is missing something general, not that it needs its own handler.
 */

import { MODULE_ID } from "../const.mjs";

const CHANNEL = `module.${MODULE_ID}`;

const GM_HANDLERS = {
  /** Update any document by uuid. Covers setting flags on a chat card from a player click,
   *  which is the phase-1 need.
   *  args: { uuid, updates }
   *  returns: { ok: boolean } */
  updateDocument: async ({ uuid, updates }) => {
    const doc = await fromUuid(uuid);
    if (!doc) {
      console.error(`${MODULE_ID} | socket.updateDocument: no document at "${uuid}"`);
      return { ok: false };
    }
    await doc.update(updates);
    return { ok: true };
  },

  /** Create a chat message GM-side.
   *  args: { data }
   *  returns: { id } | null */
  createChatMessage: async ({ data }) => {
    const created = await ChatMessage.create(data);
    return created ? { id: created.id } : null;
  },

  /** Create a pf1 roll request on behalf of any client — `createRequest` is GM-gated and
   *  returns undefined for a non-GM caller.
   *  args: createRequest options (see pf1-roll-requests api.md)
   *  returns: { messageId } | null — the ChatMessage itself is not socket-serialisable. */
  createRollRequest: async (args) => {
    const message = await game.pf1RollRequests?.createRequest(args);
    return message ? { messageId: message.id } : null;
  },
};

/** Call a GM handler from any client. */
export async function gmRequest(fn, args) {
  if (game.user.isGM) {
    const handler = GM_HANDLERS[fn];
    if (!handler) {
      console.error(`${MODULE_ID} | socket: unknown handler "${fn}"`);
      return null;
    }
    return await handler(args);
  }

  return new Promise((resolve) => {
    const requestId = foundry.utils.randomID();
    const onResponse = (data) => {
      if (data?.type !== "gmResponse" || data.requestId !== requestId) return;
      game.socket.off(CHANNEL, onResponse);
      resolve(data.result ?? null);
    };
    game.socket.on(CHANNEL, onResponse);
    game.socket.emit(CHANNEL, { type: "gmProxy", fn, args, requestId });
  });
}

export function registerSocket() {
  game.socket.on(CHANNEL, async (data) => {
    if (!game.user.isGM) return;
    if (data?.type !== "gmProxy") return;

    const handler = GM_HANDLERS[data.fn];
    if (!handler) {
      console.error(`${MODULE_ID} | socket: unknown handler "${data.fn}"`);
      return;
    }

    let result = null;
    try {
      result = await handler(data.args);
    } catch (err) {
      console.error(`${MODULE_ID} | socket: handler "${data.fn}" threw:`, err);
    }

    if (data.requestId) {
      game.socket.emit(CHANNEL, { type: "gmResponse", requestId: data.requestId, result: result ?? null });
    }
  });
}
