/* Turning a catalog entry into the one or two outcome branches a card offers (DESIGN.md §6).
 *
 * ── The override rule, in one place ─────────────────────────────────────────
 * With `save` present, an entry's own `buff` / `conditions` / `damage` are the **saved** outcome and
 * `onFail` is the **failed** one, overriding the base **channel by channel**: a channel `onFail`
 * names replaces the base, a channel it omits falls through, and an explicit `null` clears it.
 *
 * `undefined` and `null` therefore mean different things here, which is unusual enough to be worth
 * saying twice — `{}` inherits everything, `{ buff: null }` inherits the conditions and the damage
 * and takes the buff away. `"buff" in onFail` is the whole of the distinction.
 *
 * With no `save`, there is one branch and it is the entry.
 *
 * ── Why the buff is snapshotted ─────────────────────────────────────────────
 * The catalog names buffs by name (that is what `applyBuffTo` takes), but the card needs an image,
 * a description and a link. Resolving that at render time would mean a compendium lookup per client
 * per draw; resolving it once, GM-side, at resolution, means the card is instant and identical for
 * everyone, survives a pack recompile, and still shows what the critical did when astora-mod is not
 * installed to deliver it. The buff name travels alongside the snapshot, because delivery is by
 * name and must not start depending on a uuid that a recompile can change.
 */

import { MODULE_ID } from "../const.mjs";
import { searchAllBuffPacks } from "../settings.mjs";
import { rollDamage } from "./damage.mjs";
import { showDice } from "./dice.mjs";

/** This module's own buff pack — where §6 says these buffs live. */
const BUFF_PACK = `${MODULE_ID}.effect-buffs`;

/** The channels a branch carries. Order matters only for reading; nothing iterates it positionally. */
const CHANNELS = ["buffs", "conditions", "damage"];

/**
 * The authored (unrolled) shape of both branches.
 *
 * Pure — no rolling, no lookups — so it can be called anywhere, including from a preview or a test.
 * `failed` is null when the entry has no save, which is the signal the card reads to decide whether
 * to draw branch headings at all.
 *
 * @param {object} entry
 * @returns {{ save: number|null, saved: object, failed: object|null }}
 */
export function authoredBranches(entry) {
  const base = Object.fromEntries(CHANNELS.map((key) => [key, entry?.[key] ?? null]));
  const save = entry?.save ?? null;

  if (!save || entry?.onFail == null) return { save, saved: base, failed: null };

  /* `in` rather than a nullish read: `onFail.buffs === null` is an authored instruction to clear the
   * buffs on this branch, and a nullish coalesce would inherit them instead — the exact opposite. */
  const failed = Object.fromEntries(
    CHANNELS.map((key) => [key, key in entry.onFail ? (entry.onFail[key] ?? null) : base[key]])
  );

  return { save, saved: base, failed };
}

/** Whether two branches ended up with the same damage — i.e. whether `onFail` overrode it. */
const sameDamage = (a, b) => a === b || (a == null && b == null);

/**
 * Both branches, resolved for a card: buffs snapshotted, damage rolled, dice shown.
 *
 * Rolling happens here rather than at apply time because a card must show the same numbers to
 * everyone, forever (§7.2). When the two branches share a damage array — the usual case, damage
 * written once at the top level — it is rolled **once** and both branches point at the same result,
 * so the card draws one damage table below both rather than two contradictory ones. When `onFail`
 * genuinely overrides the damage, each branch gets its own roll, and both are thrown now: the card
 * offers both branches regardless of the save, so both have to be real.
 *
 * @param {object} entry
 * @param {object} [opts]
 * @param {object} [opts.rollData]  the attacker's roll data
 * @returns {Promise<{ save: number|null, saved: object, failed: object|null }>} branches whose
 *   `buff` is a snapshot (or null) and whose `damage` is a rolled result (or null)
 */
export async function resolveBranches(entry, { rollData = {} } = {}) {
  const authored = authoredBranches(entry);

  // One lookup per distinct buff name, shared by both branches when they name the same one.
  const snapshots = new Map();
  const snapshotOf = async (name) => {
    if (!name) return null;
    if (!snapshots.has(name)) snapshots.set(name, await buffSnapshot(name));
    return snapshots.get(name);
  };

  /* "Shared" means the card draws ONE damage table, below everything, rather than one inside each
   * branch. An entry with no save has one branch and therefore nothing to share it with — but the
   * table still belongs at the bottom rather than tucked inside the only section there is, so the
   * no-branch case reads as shared too. */
  const shared = !authored.failed || sameDamage(authored.saved.damage, authored.failed.damage);

  const savedDamage = await rollDamage(authored.saved.damage, rollData);
  const failedDamage = authored.failed
    ? shared
      ? savedDamage
      : await rollDamage(authored.failed.damage, rollData)
    : null;

  // One animation for every die this resolution threw, pooled — see showDice.
  await showDice([...(savedDamage?.rolls ?? []), ...(shared ? [] : (failedDamage?.rolls ?? []))]);

  const dress = async (branch, damage) =>
    branch && {
      /* One entry per authored name, in authoring order. The name travels beside the snapshot
       * because the two can disagree in exactly one way that matters: a buff the catalog names but
       * no compendium has. Then there is no snapshot to draw and the name is all we know, which is
       * still worth saying — the GM can go and make the buff. */
      buffs: await Promise.all(
        (branch.buffs ?? []).map(async (name) => ({ name, snapshot: await snapshotOf(name) }))
      ),
      conditions: branch.conditions ?? [],
      // `rolls` are live Roll objects and must not reach a flag; only the serialised parts do.
      damage: damage ? { parts: damage.parts, total: damage.total } : null,
    };

  return {
    save: authored.save,
    saved: await dress(authored.saved, savedDamage),
    failed: await dress(authored.failed, failedDamage),
    // Told to the card so it knows whether to draw one damage table or one per branch.
    sharedDamage: shared,
  };
}

/**
 * What the card needs to draw a buff header: name, image, description, and a link to the real item.
 *
 * **This module's own pack, and by default only that pack.** That is the pack §6 says these buffs
 * live in, and a name found somewhere else is as likely to be a coincidence as a copy — someone
 * else's "Broken Arm" drawn on our card as though it were ours is a worse outcome than a header
 * that fails to appear. A GM who genuinely keeps their own copies elsewhere turns on
 * *Look for effect buffs outside this module* and gets the wider sweep.
 *
 * The setting governs the **snapshot only**. Delivery is astora-mod's `applyBuffTo`, which searches
 * the buff sources configured in that module — so turning this on is how a GM makes the header agree
 * with what will actually be delivered, not how they enable anything.
 *
 * Returns null when nothing is found, which is reported but is not fatal: the entry still names its
 * buff in the apply button's label, and the button still delivers it if astora-mod can find it.
 *
 * @param {string} name
 * @returns {Promise<{ name: string, img: string, description: string, uuid: string }|null>}
 */
export async function buffSnapshot(name) {
  const wanted = normalise(name);
  if (!wanted) return null;

  const own = game.packs.get(BUFF_PACK);
  const wide = searchAllBuffPacks();
  const packs = wide
    ? [own, ...game.packs.filter((p) => p.documentName === "Item" && p.collection !== BUFF_PACK)]
    : [own];

  if (!own) console.error(`${MODULE_ID} | ${BUFF_PACK} is not present; effect buffs cannot be looked up`);

  for (const pack of packs) {
    if (!pack) continue;
    let index;
    try {
      index = await pack.getIndex({ fields: ["type"] });
    } catch (err) {
      console.error(`${MODULE_ID} | could not index ${pack.collection} looking for buff "${name}":`, err);
      continue;
    }

    const hit = index.find((e) => (!e.type || e.type === "buff") && normalise(e.name) === wanted);
    if (!hit) continue;

    try {
      const doc = await pack.getDocument(hit._id);
      if (!doc || doc.type !== "buff") continue;
      return {
        name: doc.name,
        img: doc.img,
        // Stored raw and enriched at render, so `@UUID` links inside a buff's description behave
        // like every other enriched string on the card.
        description: doc.system?.description?.value ?? "",
        uuid: doc.uuid,
      };
    } catch (err) {
      console.error(`${MODULE_ID} | could not load buff "${name}" from ${pack.collection}:`, err);
    }
  }

  /* Loud, and loud in both places. This is a **content** fault — the catalog names a buff that has
   * not been made — and it is invisible on the card, which simply renders one less header. The GM is
   * the only person who can fix it and the only person who will otherwise never learn of it. */
  const where = wide ? `${BUFF_PACK} or any other item compendium` : BUFF_PACK;
  console.error(`${MODULE_ID} | no buff named "${name}" in ${where}`);
  ui.notifications.error(
    `${MODULE_ID}: no buff named "${name}" in ${wide ? "any item compendium" : "Critical Effect Buffs"}.` +
      (wide ? "" : " Enable “Look for effect buffs outside this module” if it lives in another pack.")
  );
  return null;
}

/** The same name-matching astora's buff delivery uses: case and surrounding space are not identity. */
const normalise = (name) => String(name ?? "").trim().toLowerCase();
