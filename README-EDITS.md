# Documentation edits pending review

Changes made to published documentation, for a human pass before release.
**Delete an entry once you have reviewed it** — what is left is the queue.

---

## 2026-09-01 — `README.md` + `lang/en.json` — dedicated healing, `dc: 0` no longer needs a use

Prompted by: injuries authored with no Heal check DC never flagged themselves treated, so they
absorbed nothing until the buff was used by hand.

### 1. CHANGED — `README.md` § *Dedicated healing*, opening two paragraphs

Before:

> Some conditions — broken bones, mostly — can't simply be healed away. They must first be
> **treated** (a Heal check), after which they absorb a threshold of healing before clearing:
> healing that would otherwise have gone to hit points.
>
> Once a treated condition is on an actor, any incoming healing opens an allocation dialog so the
> player can split it between hit points and their conditions.

After:

> Some conditions — broken bones, mostly — can't simply be healed away. They absorb a threshold of
> healing before clearing: healing that would otherwise have gone to hit points. Where a **Heal check
> DC** is authored on one, it must be **treated** first; with no DC there is nothing to treat, and the
> condition absorbs healing from the moment it lands.
>
> Once such a condition is on an actor, any incoming healing opens an allocation dialog so the
> player can split it between hit points and their conditions.

### 2. CHANGED — `README.md` § *Dedicated healing*, configuration paragraph

Before:

> …the healing required to clear the condition, the Heal check DC that makes it ready to
> absorb healing (0 waives the check), and — once it's configured — a read-out of the progress so
> far with a reset control.

After:

> …the healing required to clear the condition, the Heal check DC that must be passed before
> it will absorb any (0 = no check), and — once it's configured — a read-out of the progress so
> far with a reset control. The *Treated* mark appears only when a DC is set, since that is the only
> thing it gates.

### 3. CHANGED — `lang/en.json` — `CRITICAL_EFFECTS.DedicatedHealing.Section.Hint`

Before: `Once treated, this condition absorbs healing instead of hit points, and clears when it has taken enough.`

After: `Absorbs healing instead of hit points, and clears once it has taken enough.`

### 4. CHANGED — `lang/en.json` — `CRITICAL_EFFECTS.DedicatedHealing.Field.DCHint`

Before: `Heal check to make it ready to absorb healing. 0 waives the check.`

After: `Heal check before it will absorb healing. 0 = no check needed.`

### 5. CHANGED — `lang/en.json` — `CRITICAL_EFFECTS.DedicatedHealing.Field.ResetTooltip`

Before: `Clear the treated mark and healing received.`

After: `Clear the healing received and any treated mark.`

### 6. REMOVED — `lang/en.json` — `CRITICAL_EFFECTS.DedicatedHealing.Field.AwaitingUse`

Removed: `Awaiting treatment`

The status it labelled — a threshold wound with `dc: 0`, waiting on a use that did nothing but tick
a box — no longer exists. The sheet shows the running total instead.
