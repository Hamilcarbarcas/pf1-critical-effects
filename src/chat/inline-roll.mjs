/* Confirmation anchors drawn after the card rendered (DESIGN.md §9.2, "Drawing it"): the deferred
 * confirmation and the explosion list. PF1 builds the card's own anchors at template time, and
 * Little Helper restyles those before our render hook runs, so anything added here has to match
 * both by hand.
 */

/**
 * Classes as PF1's `ChatAttack#_createInlineRoll(roll, true, true)` gives a confirmation.
 * @param {Roll} roll
 * @param {object} [opts]
 * @param {boolean} [opts.threat]  mark a threat the way PF1 marks one on the attack roll
 */
export function confirmAnchor(roll, { threat = false } = {}) {
  const classes = ["inline-dsn-hidden"];
  if (roll.isNat20) classes.push("natural-20", "success");
  if (roll.isNat1) classes.push("natural-1", "failure");
  if (threat && roll.isCrit) classes.push("critical-threat");
  return roll.toAnchor({ classes });
}

const signed = new Intl.NumberFormat(undefined, { signDisplay: "always" }).format;

function span(text, ...classes) {
  const el = document.createElement("span");
  el.textContent = text;
  el.className = classes.join(" ");
  return el;
}

/**
 * Little Helper's "Enrich Attack Rolls" (`roll-enhancement/attacks.mjs`, `enhanceAttackRoll`):
 * natural die, bonus, arrow, total. Applied only when the attack roll on the same card was
 * enriched, so the feature being off (or the module absent) leaves the plain anchor.
 *
 * @param {HTMLAnchorElement} anchor  from {@link confirmAnchor}
 * @param {Roll} roll
 * @param {HTMLElement} attack        the `.chat-attack` it sits in
 */
export function matchLittleHelper(anchor, roll, attack) {
  if (!attack?.querySelector("tr.attack td.roll.normal .lil-enhanced-roll")) return anchor;
  if (!roll.dice.length) return anchor;

  const single = roll.dice.length === 1;
  const natural = single ? roll.dice[0].values.join(", ") : `${roll.terms[0].total}`;
  const diceTotal = single ? roll.dice[0].total : roll.terms[0].total;

  anchor.replaceChildren(
    span(natural, "lil-roll", "roll", "die", "d20"),
    span(signed(roll.total - diceTotal), "lil-bonus"),
    span("⇒", "lil-arrow"),
    span(`${roll.total}`, "lil-total")
  );
  anchor.classList.add("lil-expanded-inline-roll", "lil-roll-restyle", "lil-enhanced-roll");
  return anchor;
}
