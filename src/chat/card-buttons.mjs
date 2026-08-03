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
 * @param {object[]} descriptors  { id?, type, label, icon?, gmOnly?, data? }
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
    const container = root.querySelector(".card-buttons") ?? root.querySelector(".chat-card") ?? root;

    for (const descriptor of flag) {
      if (descriptor.gmOnly && !game.user.isGM) continue;

      const id = descriptor?.id ?? "";
      if (id && root.querySelector(`.ce-card-btn[data-ce-id="${id}"]`)) continue; // already injected

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
