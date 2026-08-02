/* Writing resolution results back onto the originating chat card.
 *
 * The result lives in a message flag and is rendered from it on every draw, for the same reason
 * the buttons do: stored HTML would not survive a re-render and would not match across clients.
 */

import { MODULE_ID } from "../const.mjs";
import { gmRequest } from "../integrations/socket.mjs";

const RESULT_FLAG = "fumbleResult";

/**
 * Record a fumble result on the attack card.
 * @param {ChatMessage} message
 * @param {object} result  { tableKey, total, entryId, name, journal }
 */
export async function setFumbleResult(message, result) {
  const key = `flags.${MODULE_ID}.${RESULT_FLAG}`;
  if (game.user.isGM) await message.update({ [key]: result });
  else await gmRequest("updateDocument", { uuid: message.uuid, updates: { [key]: result } });
}

export const getFumbleResult = (message) => message.getFlag(MODULE_ID, RESULT_FLAG) ?? null;

/** A clickable journal link, built as a real content link so Foundry's delegated handler opens it. */
function journalLink(uuid, label) {
  const a = document.createElement("a");
  a.className = "content-link";
  a.draggable = true;
  a.dataset.link = "";
  a.dataset.uuid = uuid;
  a.dataset.type = "JournalEntry";

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-book-open";
  a.append(icon, document.createTextNode(label));
  return a;
}

export function registerCardMutation() {
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
    if (result.journal) name.append(journalLink(result.journal, result.name));
    else name.textContent = result.name;

    block.append(header, name);

    const container = root.querySelector(".chat-card") ?? root.querySelector(".message-content") ?? root;
    container.appendChild(block);
  });
}
