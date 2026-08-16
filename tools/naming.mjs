/* Canonical naming for the critical-effects catalog.
 *
 * Three rules, applied in order:
 *   1. Title Case, with the usual small words left down unless they lead.
 *   2. Descriptor first — "Severed Hand", never "Hand Severed". Body-part names only.
 *   3. A short list of hand-set overrides for names the rules cannot reach.
 */
const SMALL = /^(of|to|in|the|a|an|on|using|and|or|with)$/i;
/** Acronyms the catalog uses. Left alone — "CL check" must not become "Cl check". */
const ACRONYM = /^(CL|DC|HP|HD|GM|AC|DR)$/;
export const title = (s) =>
  s.replace(/\s+/g, " ").trim()
    .replace(/\w[\w']*/g, (w, i) =>
      ACRONYM.test(w) ? w
      : i > 0 && SMALL.test(w) ? w.toLowerCase()
      : w[0].toUpperCase() + w.slice(1).toLowerCase());

const PART = /^(arm|arms|hand|hands|finger|fingers|leg|legs|foot|feet|toes|head|skull|cranium|neck|jaw|nose|ear|ears|eye|eyes|tail|wing|wings|appendage|torso|rib|ribs|back|shoulder|brow|forehead|cheekbone|throat|calf|knee|hip|ankle|quads|muscle|muscles|tendon|tendons|biceps|deltoids|femoral|carotid|aorta|larynx|lung|lungs|gut|stomach|organs|pectoral|vertebrae|vertibrae|wrist|scalp|face|socket|chest|spine)$/i;
const DESC = /^(severed|cleaved|broken|shattered|crushed|pulverized|pulped|punctured|pierced|sliced|slashed|lodged|pinned|skewered|kebabed|impaled|nicked|grazed|ruptured|destroyed|bruised|fractured|dislocated|sprained|numbed|declawed|scalped|collapsed|plucked|clipped)$/i;

/** Names the rules would get wrong, or that need collapsing onto one spelling. */
const OVERRIDE = new Map(Object.entries({
  "weapon stuck": "Weapon Stuck",                       // idiom; "Stuck Weapon" reads wrong
  "become undead!": "Become Undead",
  "jaw severed (can't speak)": "Severed Jaw",           // parenthetical is an implementation note
  "jaw dropped": "Jaw Dropped",                         // the pun stays; its buff is Severed Jaw
  "wrist puncture": "Punctured Wrist",
  "wrist slit": "Slit Wrist",
  /* Permanent limb loss — one family, one shape. Deliberately noun-first, like Weapon Stuck:
   * "Destroyed Arm" would collide with the *Crushed/Pulverized* descriptors that cause it. */
  "permanent loss of use of arm": "Arm Destroyed",
  "destroyed leg": "Leg Destroyed",
  "appendage permanently useless": "Appendage Destroyed",
  "tail permanently useless": "Tail Destroyed",
  "wing permanently useless": "Wing Destroyed",
  "permanently blinded in 1 eye": "Permanently Blinded (One Eye)",
  "permanently blinded in one eye": "Permanently Blinded (One Eye)",
  "permanently blinded": "Permanently Blinded",         // both eyes — a different wound
  "nose severed (disadvantage on all checks involving smell, loses scent ability)": "Severed Nose",
  "ear severed (disadvantage on all checks involving hearing)": "Severed Ear",
  "toes severed (disadvantage on acrobatics & climb)": "Severed Toes",
  "shattered vertibrae": "Shattered Vertebrae",         // spelling
  "wing compound fractured": "Shattered Wing",          // joins the Shattered Arm/Hand/Rib/Leg family
  "wing base pierced": "Pierced Wing Base",
}));

export function canonical(raw) {
  const key = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (OVERRIDE.has(key)) return OVERRIDE.get(key);
  const t = title(raw);
  const w = t.split(" ");
  if (w.length === 2 && PART.test(w[0]) && DESC.test(w[1])) return `${w[1]} ${w[0]}`;
  return t;
}
