/* Lethal draws (DESIGN.md §7.4).
 *
 * Concept §2's Lethal tables are flavour-only and mechanically inert — no save, no roll-off, no
 * outcomes — pure narration for a hit that has ALREADY been determined to kill. So this is the
 * cheapest thing in the system: a draw and a card. No resolve layer, no tables, no severity.
 *
 * Two entry points, per §7.4:
 *   - a roll-requests quick action, always available, for any kill including ones with no attack
 *     card behind them (coup de grace, environmental, narrative);
 *   - a GM-only button on an attack card, surfaced when the damage could plausibly have downed
 *     one of its targets.
 */

import { MODULE_ID } from "../const.mjs";
import * as catalog from "../catalog/catalog.mjs";
import { DAMAGE_TYPES } from "../catalog/schema.mjs";
import { registerButtonType, addButtons } from "../chat/card-buttons.mjs";

const BUTTON_TYPE = "lethal-draw";

const DAMAGE_TYPE_LABELS = { b: "Bludgeoning", p: "Piercing", s: "Slashing" };

// --- the draw ---------------------------------------------------------------

/**
 * Draw a lethal flavour and post it.
 *
 * @param {object} opts
 * @param {string} opts.damageType  b | p | s
 * @param {string} [opts.targetName]
 */
export async function postLethalDraw({ damageType, targetName = null } = {}) {
  const entry = catalog.drawLethal(damageType);

  if (!entry) {
    ui.notifications.warn(
      `${MODULE_ID}: no lethal entries for ${DAMAGE_TYPE_LABELS[damageType] ?? damageType} yet.`
    );
    return null;
  }

  const label = DAMAGE_TYPE_LABELS[damageType] ?? damageType;
  const who = targetName ? ` — ${foundry.utils.escapeHTML(targetName)}` : "";

  const content = `
    <div class="ce-lethal-card">
      <header class="ce-lethal-header">
        <span class="ce-lethal-title">Lethal Blow</span>
        <span class="ce-lethal-type">${label}${who}</span>
      </header>
      <div class="ce-lethal-name">
        ${entry.journal
          ? `<a class="content-link" draggable="true" data-link data-uuid="${entry.journal}" data-type="JournalEntry"><i class="fa-solid fa-book-open"></i>${foundry.utils.escapeHTML(entry.name)}</a>`
          : foundry.utils.escapeHTML(entry.name)}
      </div>
    </div>`;

  return ChatMessage.create({ content });
}

/** GM picks a damage type, then draws. Shared by both entry points. */
export async function promptLethalDraw({ damageType = null, targetName = null } = {}) {
  const chosen = damageType ?? await foundry.applications.api.DialogV2.wait({
    window: { title: "Lethal Blow" },
    content: `<p>Which damage type killed them?</p>`,
    buttons: [
      ...Object.entries(DAMAGE_TYPE_LABELS).map(([key, label]) => ({
        action: key,
        label: `${label} (${catalog.lethalFor(key).length})`,
        callback: () => key,
      })),
      { action: "cancel", icon: "fa-solid fa-xmark", label: "Cancel", callback: () => null },
    ],
    rejectClose: false,
  });

  if (!chosen) return null;
  return postLethalDraw({ damageType: chosen, targetName });
}

// --- attack-card button -----------------------------------------------------

/**
 * Could this attack plausibly have downed one of its targets?
 *
 * Deliberately a PREDICTION, not a fact, and used only to decide whether to *surface* the button
 * (§7.4). Three reasons it cannot be authoritative:
 *
 *   - damage isn't applied at card-render time, and DR/resistance may eat some of it;
 *   - several targets means the answer differs per target;
 *   - "kills" here is not `hp <= 0` — that's downing, which has its own automatic crit effect —
 *     it depends on the death threshold and on GM judgement about helpless targets.
 *
 * So a false negative just means the GM uses the quick action instead. Nothing is blocked.
 */
export function couldBeLethal(message) {
  const damage = totalDamageOf(message);
  if (!damage) return false;

  for (const uuid of message.system?.targets ?? []) {
    const actor = fromUuidSync(uuid)?.actor;
    const hp = actor?.system?.attributes?.hp?.value;
    if (Number.isFinite(hp) && damage >= hp) return true;
  }
  return false;
}

/** Best-effort damage total off a PF1 attack card. */
function totalDamageOf(message) {
  let total = 0;
  for (const roll of message.rolls ?? []) total += roll?.total ?? 0;
  return total || null;
}

/** The card's weapon damage type, for pre-selecting the draw. */
function damageTypeOf(message) {
  const action = message.system?.action ?? null;
  // `part.types` is a Set of PF1 registry ids since v11; the older `type.values` accessor is a
  // deprecation shim that logs on every read.
  const types = action?.damage?.parts?.flatMap((p) => [...(p?.types ?? [])]) ?? [];
  return types.find((t) => DAMAGE_TYPES.includes(t)) ?? null;
}

/** Offer a lethal draw on an attack card whose damage could have killed something. */
export async function offerLethalButton(message) {
  if (!message || !couldBeLethal(message)) return;

  await addButtons(message, [{
    type: BUTTON_TYPE,
    label: "Lethal Blow",
    icon: "fa-solid fa-skull",
    gmOnly: true,
    data: { damageType: damageTypeOf(message) },
  }]);
}

// --- registration -----------------------------------------------------------

export function registerLethal() {
  registerButtonType(BUTTON_TYPE, async (descriptor) => {
    // A pre-selected damage type still goes through the prompt, because the weapon's type is not
    // always the type that killed (a thrown flask, a coup de grace with a different weapon).
    await promptLethalDraw({ damageType: descriptor.data?.damageType ?? null });
  });
}

/** Registered against pf1-roll-requests at `ready`; see resolver-app.mjs for the sibling. */
export function registerLethalQuickAction() {
  if (!game.pf1RollRequests) return;

  game.pf1RollRequests.registerQuickAction({
    key: "critical-effects-lethal",
    label: "Lethal Blow",
    icon: "fa-skull",
    callback: () => promptLethalDraw(),
  });
}
