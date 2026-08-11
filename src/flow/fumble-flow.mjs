/* Fumble path, end to end (DESIGN.md §7.1).
 *
 *   1. pf1PreActionUse   — force a confirmation roll on a natural 1 (migrated from astora-mod's
 *                          critical-fumble.mjs). Synchronous, so Dice So Nice sees the die.
 *   2. pf1PostActionUse  — attach a "Resolve Fumble" button to the attack card.
 *   3. click             — GM picks the attack type (pre-selected from the weapon).
 *   4. draw              — a targeted 1d20 roll request carrying the table, which the PLAYER
 *                          clicks to roll. Posting it ends the GM's turn in the flow.
 *   5. result            — picked up from the rollComplete hook whenever that roll lands, then
 *                          appended to the original attack card, with its prose and conditions.
 *
 * Steps 4 and 5 are deliberately disconnected: the wait for a player's click is open-ended, so
 * the link between the two lives in a flag on the request card rather than in memory.
 *
 * Steps 3-5 have a second way in: a roll-requests quick action, which draws for the selected token
 * with no attack card behind it. It joins at step 3 and rejoins the same code from there; the only
 * difference is at step 5, where a draw with no attack card gets a card of its own.
 *
 * Nothing here touches PF1's crit pipeline; that is phase 7.
 */

import { MODULE_ID } from "../const.mjs";
import * as catalog from "../catalog/catalog.mjs";
import { registerButtonType, addButtons, removeButton } from "../chat/card-buttons.mjs";
import { setFumbleResult, createFumbleResultCard, FUMBLE_RESULT_CLASS } from "../chat/card-mutate.mjs";
import { postFumbleDraw, totalFromResult, DRAW_FLAG } from "../integrations/roll-requests.mjs";
import { attachExecution, attackerRollData, resolveExecution } from "./execution.mjs";
import { displayName } from "../integrations/token-randomizer.mjs";

const BUTTON_TYPE = "resolve-fumble";

// --- 1. forced confirmation on a natural 1 ----------------------------------

/* Migrated verbatim in behaviour from astora-mod/scripts/critical-fumble.mjs. It must stay
 * synchronous: PF1 hands the roll pool to Dice So Nice later in the same pass, and an async
 * hook would miss that window, so the die would never animate. */
function forceFumbleConfirmation(actionUse) {
  for (const [idx, atk] of (actionUse.shared.attacks ?? []).entries()) {
    const chatAttack = atk.chatAttack;
    if (!chatAttack?.attack?.isNat1) continue;

    const rollData = chatAttack.rollData;
    const confirmParts = [];

    if (rollData.critConfirmBonus !== 0) {
      confirmParts.push(`@critConfirmBonus[${game.i18n.localize("PF1.CriticalConfirmation")}]`);
    }
    const ccKeys = pf1.documents.actor.changes.getChangeFlat.call(chatAttack.actor, "critConfirm");
    for (const ccKey of ccKeys) {
      chatAttack.actor?.sourceDetails[ccKey]?.forEach((c) => confirmParts.push(`(${c.value})[${c.name}]`));
    }
    const conditionalParts = actionUse._getConditionalParts(atk, { index: idx });
    if (conditionalParts["attack.crit"]?.length) confirmParts.push(...conditionalParts["attack.crit"]);

    const baseFormula = standardConfirmFormula(chatAttack.attack);
    const formula = confirmParts.length ? `${baseFormula}+${confirmParts.join("+")}` : baseFormula;

    const roll = new pf1.dice.D20RollPF(formula, rollData, {
      critical: actionUse.shared.action.critRange,
    });
    roll.evaluate({ async: false });
    roll.options.flavor = game.i18n.localize("PF1.CriticalConfirmation");

    chatAttack.critConfirm = roll;
    chatAttack.hasCritConfirm = true;
  }
}

/**
 * The attack's formula with its d20 forced back to a plain `1d20`, keeping every bonus term.
 *
 * PF1's attack dialog can replace the d20 with any formula — `20`, `2d20kh` — held in
 * `rollData.d20` and spliced in as the FIRST term of the attack roll (which is exactly what
 * `D20RollPF#d20` reads). Reusing the attack's formula verbatim would carry that override into
 * the confirmation, so an override bought with one roll would pay for two.
 *
 * Only the d20 slot is replaced; the size, ability, BAB and situational terms are kept as they
 * are, flavour and all, so the confirmation's breakdown still reads like the attack's.
 *
 * The mirror of this for critical confirmations is in integrations/pf1-pipeline.mjs — that one
 * has to be a libWrapper, since PF1 rolls those itself.
 */
export function standardConfirmFormula(attackRoll) {
  if (!attackRoll) return pf1.dice.D20RollPF.standardRoll;
  if (attackRoll.isNormal) return attackRoll.formula; // already a plain d20; nothing to strip

  const standard = new foundry.dice.terms.Die({ number: 1, faces: 20 });
  return pf1.dice.D20RollPF.getFormula([standard, ...attackRoll.terms.slice(1)]);
}

// --- 2. attach the button ---------------------------------------------------

/**
 * Which fumble table this action draws from.
 *
 * Best-effort, and only ever a **pre-selection**: the Resolve Fumble dialog shows the full list
 * with this choice highlighted, so a wrong guess costs one click. That is why nothing here strains
 * to be clever.
 *
 * `bows` and `crossbows` come straight from PF1's own weapon groups, so that split is exact.
 * `unarmed` is the soft one — PF1 has no first-class marker for an unarmed strike (there is no
 * `unarmed` weapon group and no attack subtype for it), so it is recognised by name and by the
 * `close` weapon group, and anything unrecognised falls through to `melee`. Detecting it wrongly
 * is cheap; guessing elaborately would not be.
 */
export function inferAttackType(item, action) {
  if (item?.type === "attack" && item.system?.subType === "natural") return "natural";

  const groups = item?.system?.weaponGroups?.value ?? item?.system?.weaponGroups?.base ?? [];
  const list = Array.isArray(groups) ? groups : Object.keys(groups ?? {});

  const actionType = action?.data?.actionType ?? action?.actionType;
  const isRanged = actionType === "rwak" || actionType === "rsak";

  if (isRanged) {
    if (list.includes("crossbows")) return "crossbows";
    if (list.includes("bows")) return "bows";
    return "thrown";
  }

  if (/\bunarmed\b/i.test(item?.name ?? "") || list.includes("close")) return "unarmed";
  return "melee";
}

/* A natural 1 is the whole gate. The confirmation roll is rolled and displayed, but nothing
 * reads it: whether it "failed" is a judgement about the target's AC that the GM is better
 * placed to make than we are, and the button costs nothing when it goes unused. */
async function attachFumbleButton(actionUse, message) {
  if (!message) return; // hidden chat — nowhere to attach

  const item = actionUse.shared?.item ?? actionUse.item;
  const action = actionUse.shared?.action ?? actionUse.action;

  const fumbles = (actionUse.shared?.attacks ?? []).filter((atk) => atk.chatAttack?.attack?.isNat1);
  if (!fumbles.length) return;

  await addButtons(message, [{
    type: BUTTON_TYPE,
    label: game.i18n.localize("CRITICAL_EFFECTS.Fumble.ResolveButton"),
    icon: "fa-solid fa-face-dizzy",
    gmOnly: true,
    data: {
      attackType: inferAttackType(item, action),
      tokenId: actionUse.shared?.token?.id ?? message.speaker?.token ?? null,
      count: fumbles.length,
    },
  }]);
}

// --- 3. the dialog ----------------------------------------------------------

async function promptAttackType(preselected) {
  const keys = catalog.fumbleTableKeys();
  if (!keys.length) {
    ui.notifications.error(`${MODULE_ID}: no fumble tables are loaded.`);
    return null;
  }

  const options = keys.map((key) => {
    const label = game.i18n.localize(`CRITICAL_EFFECTS.Fumble.Table.${key}`);
    const selected = key === preselected ? " selected" : "";
    return `<option value="${key}"${selected}>${label}</option>`;
  }).join("");

  const content = `
    <div class="ce-dialog">
      <p>${game.i18n.localize("CRITICAL_EFFECTS.Fumble.PickTable")}</p>
      <select name="attackType" class="ce-table-select">${options}</select>
    </div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("CRITICAL_EFFECTS.Fumble.DialogTitle") },
    content,
    ok: {
      label: game.i18n.localize("CRITICAL_EFFECTS.Fumble.Draw"),
      callback: (_event, button) => button.form.elements.attackType.value,
    },
    rejectClose: false,
  });
}

// --- 4. post the draw -------------------------------------------------------

/**
 * Prompt for the table and post the draw. The single implementation behind both entry points.
 *
 * Posts the request and stops. The player rolls it in their own time, and `completeDraw` below
 * finishes the job off the rollComplete hook — so nothing here holds state across the wait.
 *
 * Returns null for a cancelled prompt and for a failed post alike, having said so where it
 * mattered; the callers treat both the same way, which is to leave everything as it was.
 *
 * @param {object} opts
 * @param {TokenDocument} opts.token             the fumbling token
 * @param {string|null} [opts.preselected]       attack type to open the prompt on
 * @param {string|null} [opts.sourceMessageId]   attack card to record onto; null for a hand-started
 *                                               draw, which gets a card of its own when it lands
 * @returns {Promise<ChatMessage|null>} the request card
 */
async function startDraw({ token, preselected = null, sourceMessageId = null }) {
  const attackType = await promptAttackType(preselected);
  if (!attackType) return null; // cancelled

  const resultTable = catalog.fumbleResultTable(attackType);
  if (!resultTable) {
    ui.notifications.error(`${MODULE_ID}: no "${attackType}" fumble table.`);
    return null;
  }

  /* Only a hand-started draw carries these. The button path records onto the attack card, which
   * already says who swung; a standalone one has to say it itself, so the name is captured now —
   * sanitised (§10) — rather than read off a token that may be gone by the time it is rolled. */
  const standalone = sourceMessageId
    ? {}
    : { fumblerName: displayName(token) ?? "—", speaker: speakerFor(token) };

  const request = await postFumbleDraw({
    token,
    resultTable,
    tableKey: attackType,
    sourceMessageId,
    ...standalone,
    flavor: game.i18n.format("CRITICAL_EFFECTS.Fumble.DrawFlavor", {
      type: game.i18n.localize(`CRITICAL_EFFECTS.Fumble.Table.${attackType}`),
    }),
  });

  if (!request) {
    ui.notifications.warn(`${MODULE_ID}: could not post the fumble draw.`);
    return null;
  }

  return request;
}

/* The card's speaker, with the alias replaced by the name §10 already sanitised — `getSpeaker`
 * would otherwise stamp an obscured NPC's real name onto a public card. Mirrors the standalone
 * crit card's speaker for the same reason. */
function speakerFor(token) {
  const actor = token?.actor ?? null;
  if (!token && !actor) return null;
  return {
    ...ChatMessage.getSpeaker({ actor, token }),
    alias: displayName(token) ?? game.i18n.localize("CRITICAL_EFFECTS.Fumble.ResultLabel"),
  };
}

/* Entry point 1: the attack card's button. */
async function resolveFumble(descriptor, { message }) {
  const token = resolveToken(descriptor, message);
  if (!token) {
    ui.notifications.warn(`${MODULE_ID}: could not find the fumbling token; the draw needs one to target.`);
    return;
  }

  const request = await startDraw({
    token,
    preselected: descriptor.data?.attackType,
    sourceMessageId: message.id,
  });
  if (!request) return;

  // The button has handed off; a second click would post a duplicate request.
  await removeButton(message, descriptor.id);
}

/**
 * Entry point 2: the roll-requests quick action, for a fumble with no attack card behind it —
 * a house rule, a hazard, an attack rolled before the module was watching.
 *
 * The fumbler defaults to the GM's **canvas selection**, not roll-requests' actor picker. That
 * picker offers assigned PCs and player-owned linked NPCs only, so the creature that most often
 * fumbles is not in it at all, and what it hands back is an actor id that then has to be guessed
 * back into one of the actor's tokens. A controlled token is the exact answer to both.
 *
 * @param {object} [opts]
 * @param {TokenDocument|null} [opts.token]  overrides the selection, for a console caller
 */
export async function promptFumbleDraw({ token = null } = {}) {
  token ??= canvas.tokens?.controlled?.[0]?.document ?? null;
  if (!token) {
    ui.notifications.warn(game.i18n.localize("CRITICAL_EFFECTS.Fumble.NoSelection"));
    return;
  }
  // No attack behind it, so nothing to infer the table from: the prompt opens on its first entry.
  await startDraw({ token });
}

// --- 5. record the result ---------------------------------------------------

/* Fires on the GM's client for every roll on any request card, including rolls a player made
 * (roll-requests relays those to the GM to record). We claim only the cards we stamped. */
async function completeDraw({ messageId, result }) {
  if (!game.user.isGM) return;

  const request = game.messages.get(messageId);
  const draw = request?.getFlag(MODULE_ID, DRAW_FLAG);
  if (!draw) return; // not one of ours

  const total = totalFromResult(result);
  if (total == null) return;

  const entry = catalog.drawFumble(draw.tableKey, total);
  if (!entry) {
    ui.notifications.warn(`${MODULE_ID}: d12 rolled ${total}, which the "${draw.tableKey}" table does not cover.`);
    return;
  }

  /* Where the record goes. The attack card when the draw came from one; otherwise a card made for
   * it here — the same answer §7.5 gives a hand-driven crit resolution, and the same renderer
   * paints both. Created only now that there is a result to put in it, so an unmapped draw never
   * leaves an empty card behind. */
  const source = draw.sourceMessageId
    ? game.messages.get(draw.sourceMessageId)
    : await createFumbleResultCard({ fumblerName: draw.fumblerName, speaker: draw.speaker });

  if (!source) {
    if (draw.sourceMessageId) {
      console.error(`${MODULE_ID} | fumble draw resolved but its attack card ${draw.sourceMessageId} is gone`);
    }
    return;
  }

  /* A fumble carries the same three channels a critical does, and a save over them — a snapped
   * bowstring is prose, but a fumbled swing that leaves you prone is a condition, and one that
   * buries the arrow in your own foot deals damage (§6, §7.6). The fumbler is both target and
   * source here: nobody did this to them, so the damage formula reads their own roll data.
   *
   * No `sourceMessage`, deliberately, even when the draw came from an attack card. A save DC is the
   * damage of the attack that caused the effect (§6) and a fumble caused nothing — the swing missed.
   * Handing the card over would derive the DC from whichever attack sits at index 0, which on a
   * full attack is a *different* swing that happened to hit. So a save on a fumble entry falls
   * through to the GM prompt, which is the only party that knows what to DC it against. */
  const execution = await resolveExecution(entry, {
    rollData: attackerRollData(draw.actorId),
  });

  await setFumbleResult(source, {
    tableKey: draw.tableKey,
    total,
    entryId: entry.id,
    name: entry.name,
    text: entry.text ?? null,
    note: entry.note ?? null,
    conditions: entry.conditions ?? null,
    execution,
  });

  await attachExecution(source, execution, {
    scope: FUMBLE_RESULT_CLASS,
    target: { actorId: draw.actorId ?? null, tokenId: draw.tokenId ?? null },
    sourceActorId: draw.actorId ?? null,
  });

  // Resolved — don't act on a re-roll of the same card.
  await request.unsetFlag(MODULE_ID, DRAW_FLAG);
}

function resolveToken(descriptor, message) {
  const id = descriptor.data?.tokenId ?? message.speaker?.token;
  if (id) {
    const doc = canvas.scene?.tokens?.get(id);
    if (doc) return doc;
  }
  // Fall back to the speaker's actor, so a resolution still works off-scene.
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  return actor?.getActiveTokens(false, true)?.[0] ?? null;
}

// --- registration -----------------------------------------------------------

export function registerFumbleFlow() {
  Hooks.on("pf1PreActionUse", (actionUse) => {
    try {
      forceFumbleConfirmation(actionUse);
    } catch (err) {
      console.error(`${MODULE_ID} | fumble confirmation failed:`, err);
    }
  });

  Hooks.on("pf1PostActionUse", async (actionUse, message) => {
    try {
      await attachFumbleButton(actionUse, message);
    } catch (err) {
      console.error(`${MODULE_ID} | attaching the fumble button failed:`, err);
    }
  });

  // Global rather than per-request, so a pending draw survives a GM reload.
  Hooks.on("pf1RollRequests.rollComplete", async (payload) => {
    try {
      await completeDraw(payload);
    } catch (err) {
      console.error(`${MODULE_ID} | recording the fumble draw failed:`, err);
    }
  });

  registerButtonType(BUTTON_TYPE, resolveFumble);
}

/** Registered against pf1-roll-requests at `ready`; see lethal.mjs and resolver-app.mjs for the siblings. */
export function registerFumbleQuickAction() {
  if (!game.pf1RollRequests) return;

  game.pf1RollRequests.registerQuickAction({
    key: "critical-effects-fumble",
    // Localized by roll-requests, which runs every quick action's label through `localize`.
    label: "CRITICAL_EFFECTS.Fumble.QuickAction",
    icon: "fa-face-dizzy",
    // No `promptActors`: the fumbler is the canvas selection (see promptFumbleDraw). The dialog is
    // left open, because a click with nothing selected is answered with a warning and the GM needs
    // it still there to try again.
    callback: () => promptFumbleDraw(),
  });
}
