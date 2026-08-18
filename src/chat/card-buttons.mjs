/* Descriptor-driven buttons on chat cards.
 *
 * Same shape as astora-mod's action-buttons: buttons live in message FLAGS, not in stored HTML,
 * so they survive a reload and render identically for every client. Nothing evaluates a stored
 * string — a descriptor names a registered type and the handler for that type does the work.
 */

import { MODULE_ID } from "../const.mjs";

const BUTTONS_FLAG = "cardButtons";
const DEFAULT_ICON = "fa-solid fa-burst";

/** type -> handler(descriptor, { message, event }) */
const HANDLERS = new Map();

/* message id -> tail of that message's pending flag writes.
 *
 * Both addButtons and removeButton are read-modify-write on one array, and independent features
 * attach to the SAME card from the SAME hook: `pf1PostActionUse` invokes its callbacks
 * synchronously without awaiting them, so two features' getFlag reads both complete before either
 * setFlag lands and the later write silently discards the earlier button. Serialising per message
 * makes each mutation read what the previous one wrote. */
const QUEUES = new Map();

function enqueue(message, mutate) {
  const key = message.id;
  const prev = QUEUES.get(key) ?? Promise.resolve();
  // Errors are contained so one failed write can't poison every later write to the same card.
  const next = prev.then(mutate, mutate).catch((err) => {
    console.error(`${MODULE_ID} | card-buttons: updating ${key} failed:`, err);
  });
  QUEUES.set(key, next);
  next.finally(() => {
    if (QUEUES.get(key) === next) QUEUES.delete(key);
  });
  return next;
}

export function registerButtonType(type, handler) {
  if (HANDLERS.has(type)) console.error(`${MODULE_ID} | card-buttons: type "${type}" re-registered`);
  HANDLERS.set(type, handler);
}

/**
 * Attach buttons to a message.
 * @param {ChatMessage} message
 * @param {object[]} descriptors  { id?, type, label, icon?, gmOnly?, ownerOf?, mount?, data? }
 *   `mount` is a CSS selector for the element the button belongs in — see the render hook.
 *   `gmOnly` and `ownerOf` are the audience; see {@link canSee}.
 */
export async function addButtons(message, descriptors) {
  if (!message || !descriptors?.length) return;
  const stamped = descriptors.map((d) => ({ id: d.id ?? foundry.utils.randomID(), ...d }));
  // Read inside the queued turn, so it sees any button another feature just added to this card.
  return enqueue(message, async () => {
    const existing = message.getFlag(MODULE_ID, BUTTONS_FLAG) ?? [];
    await message.setFlag(MODULE_ID, BUTTONS_FLAG, [...existing, ...stamped]);
  });
}

export async function removeButton(message, id) {
  if (!message) return;
  return enqueue(message, async () => {
    const existing = message.getFlag(MODULE_ID, BUTTONS_FLAG);
    if (!Array.isArray(existing)) return;
    await message.setFlag(MODULE_ID, BUTTONS_FLAG, existing.filter((d) => d.id !== id));
  });
}

/**
 * Whether this client draws a given button.
 *
 * Two audiences, and a button may name either:
 *
 * - `gmOnly` — the GM, and only the GM. What creating an item on someone else's actor requires.
 * - `ownerOf: <actorId>` — whoever owns that actor, **plus the GM always**. This is how an option
 *   that belongs to a player reaches them without a dialog having to find a live client at one
 *   instant: the button is drawn per viewer, at render, from data already on the card. An absent
 *   owner finds it waiting when they log in; several owners all see it and the first click wins; an
 *   actor with no player owner is a monster, and only the GM was ever going to act for it.
 *
 * The GM is included unconditionally rather than by permission test, because `testUserPermission`
 * answers true for a GM on every document — asking it would make "owner" mean "everyone".
 *
 * @param {object} descriptor
 * @returns {boolean}
 */
export function canSee(descriptor) {
  if (descriptor?.gmOnly && !game.user.isGM) return false;

  const ownerOf = descriptor?.ownerOf;
  if (ownerOf && !game.user.isGM) {
    const actor = game.actors.get(ownerOf) ?? fromUuidSync(ownerOf);
    if (!actor?.testUserPermission?.(game.user, "OWNER")) return false;
  }
  return true;
}

async function dispatch(descriptor, ctx) {
  const handler = HANDLERS.get(descriptor?.type);
  if (!handler) {
    console.error(`${MODULE_ID} | card-buttons: no handler for type "${descriptor?.type}"`);
    ui.notifications.warn(`${MODULE_ID}: nothing registered to handle "${descriptor?.type}".`);
    return;
  }
  try {
    await handler(descriptor, ctx);
  } catch (err) {
    console.error(`${MODULE_ID} | card-buttons: handler "${descriptor.type}" threw:`, err);
    ui.notifications.error(`${MODULE_ID}: that button failed — see the console.`);
  }
}

export function registerCardButtons() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const flag = message.getFlag(MODULE_ID, BUTTONS_FLAG);
    if (!Array.isArray(flag) || !flag.length) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    // Ride along in the card's own button area when there is one.
    const fallback = root.querySelector(".card-buttons") ?? root.querySelector(".chat-card") ?? root;

    for (const descriptor of flag) {
      if (!canSee(descriptor)) continue;

      const id = descriptor?.id ?? "";
      if (id && root.querySelector(`.ce-card-btn[data-ce-id="${id}"]`)) continue; // already injected

      /* Where the button goes. A descriptor may name its own container, which is what lets the
       * execution block (§7.6) put an Apply button *inside* the branch it belongs to rather than in
       * PF1's footer — with two branches on a card, "the card's button area" is no longer a place
       * that says which mechanics a click would apply.
       *
       * This is why `registerCardMutation` is registered before `registerCardButtons`
       * (critical-effects.mjs): the block that emits these mounts has to have drawn by the time we
       * look for them. A mount that still isn't there is skipped rather than falling back to the
       * footer — a button whose branch heading failed to render is a button nobody can read. */
      let container = fallback;
      if (descriptor.mount) {
        container = root.querySelector(descriptor.mount);
        if (!container) {
          console.error(`${MODULE_ID} | card-buttons: no "${descriptor.mount}" on ${message.id} to mount "${descriptor.label}" in`);
          continue;
        }
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ce-card-btn";
      if (id) btn.dataset.ceId = id;

      // Built from DOM nodes so a label can never inject markup.
      const icon = document.createElement("i");
      icon.className = descriptor.icon || DEFAULT_ICON;
      btn.append(icon, document.createTextNode(` ${descriptor.label || "Resolve"}`));

      btn.addEventListener("click", (event) => dispatch(descriptor, { message, event }));
      container.appendChild(btn);
    }
  });
}
