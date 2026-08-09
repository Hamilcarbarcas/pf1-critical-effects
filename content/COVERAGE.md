# Coverage

**Generated** by `node tools/pool-report.mjs --write`. Do not edit.

Pool: **0 effects**, 0 ranked, 0 untriaged.
Grid: **63 tables**, 756 rows — 3 weapon damage types ×
13 anatomy/location pairs, plus 8 damage types that roll no
location and keep one `general` table per anatomy.
**0 of 63 tables are saturated** (every band has its 3 candidates); 63 have no candidates at all.

A table is always twelve rows — the generator backfills gaps by reusing the nearest-ranked
candidate. This report is what tells you whether those twelve rows are twelve *effects* or one
effect stretched over twelve. Target is **3 candidates per band**, because a band is 3 rows.

---

## Work queue — tables in progress

0 band-gaps sit in tables that already have candidates. **Closest to done
first** — each line is a writing prompt: a damage type, a body part, and how bad the wound
should be. These are the cheapest wins; a table with two of three grave wounds needs one effect.

_None — every table with any content is saturated._

---

## Untouched tables

63 of 63 tables have **no candidates at all**. These are
from-scratch jobs rather than gap-filling, so they are listed by damage type rather than
line by line. Remember one effect can be tagged for several body parts and damage types at once —
these do not cost 12 effects each.

| Damage type     | Empty | Body parts |
|-----------------|------:|------------|
| Bludgeoning     | 13/13 | **all**    |
| Piercing        | 13/13 | **all**    |
| Slashing        | 13/13 | **all**    |
| Fire            |   3/3 | **all**    |
| Cold            |   3/3 | **all**    |
| Electricity     |   3/3 | **all**    |
| Acid            |   3/3 | **all**    |
| Sonic           |   3/3 | **all**    |
| Force           |   3/3 | **all**    |
| Positive Energy |   3/3 | **all**    |
| Negative Energy |   3/3 | **all**    |

---

## Coverage matrix

Candidates per band, per table. `3` is saturated; `.` is empty.

### Bludgeoning

| Body part          | Minor | Moderate | Severe | Grave | Total |
|--------------------|------:|---------:|-------:|------:|------:|
| humanoid arm       |     . |        . |      . |     . |     0 |
| humanoid leg       |     . |        . |      . |     . |     0 |
| humanoid torso     |     . |        . |      . |     . |     0 |
| humanoid head      |     . |        . |      . |     . |     0 |
| beast arm          |     . |        . |      . |     . |     0 |
| beast leg          |     . |        . |      . |     . |     0 |
| beast torso        |     . |        . |      . |     . |     0 |
| beast head         |     . |        . |      . |     . |     0 |
| beast tail         |     . |        . |      . |     . |     0 |
| beast wing         |     . |        . |      . |     . |     0 |
| aberrant appendage |     . |        . |      . |     . |     0 |
| aberrant torso     |     . |        . |      . |     . |     0 |
| aberrant head      |     . |        . |      . |     . |     0 |

### Piercing

| Body part          | Minor | Moderate | Severe | Grave | Total |
|--------------------|------:|---------:|-------:|------:|------:|
| humanoid arm       |     . |        . |      . |     . |     0 |
| humanoid leg       |     . |        . |      . |     . |     0 |
| humanoid torso     |     . |        . |      . |     . |     0 |
| humanoid head      |     . |        . |      . |     . |     0 |
| beast arm          |     . |        . |      . |     . |     0 |
| beast leg          |     . |        . |      . |     . |     0 |
| beast torso        |     . |        . |      . |     . |     0 |
| beast head         |     . |        . |      . |     . |     0 |
| beast tail         |     . |        . |      . |     . |     0 |
| beast wing         |     . |        . |      . |     . |     0 |
| aberrant appendage |     . |        . |      . |     . |     0 |
| aberrant torso     |     . |        . |      . |     . |     0 |
| aberrant head      |     . |        . |      . |     . |     0 |

### Slashing

| Body part          | Minor | Moderate | Severe | Grave | Total |
|--------------------|------:|---------:|-------:|------:|------:|
| humanoid arm       |     . |        . |      . |     . |     0 |
| humanoid leg       |     . |        . |      . |     . |     0 |
| humanoid torso     |     . |        . |      . |     . |     0 |
| humanoid head      |     . |        . |      . |     . |     0 |
| beast arm          |     . |        . |      . |     . |     0 |
| beast leg          |     . |        . |      . |     . |     0 |
| beast torso        |     . |        . |      . |     . |     0 |
| beast head         |     . |        . |      . |     . |     0 |
| beast tail         |     . |        . |      . |     . |     0 |
| beast wing         |     . |        . |      . |     . |     0 |
| aberrant appendage |     . |        . |      . |     . |     0 |
| aberrant torso     |     . |        . |      . |     . |     0 |
| aberrant head      |     . |        . |      . |     . |     0 |

### Fire

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Cold

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Electricity

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Acid

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Sonic

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Force

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Positive Energy

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

### Negative Energy

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     . |        . |      . |     . |     0 |
| beast general    |     . |        . |      . |     . |     0 |
| aberrant general |     . |        . |      . |     . |     0 |

---

## Fumbles

Pool: **19 fumbles** across 6 attack types,
d20 each — 120 slots.

Fumble rows are **unordered peers**: the die picks which fumble, not how bad it is, so there is
no rank and no band. A short table gets placeholders rather than repeats, because a repeat would
silently double that outcome's odds — a decision nobody made.

| Attack type | Have | Need | Short by |
|-------------|-----:|-----:|---------:|
| melee       |   12 |   20 |        8 |
| thrown      |   11 |   20 |        9 |
| bows        |   11 |   20 |        9 |
| crossbows   |   11 |   20 |        9 |
| unarmed     |    0 |   20 |       20 |
| natural     |   10 |   20 |       10 |

---

## Lethal

**10 entries.** Flavour only — a lethal result narrates a kill that
something else already decided (HP loss, a coup de grace). No save, no roll-off, no location
axis: the only tag is damage type, and one is drawn at random from whatever matches.

There is no target count, so nothing here is a gap in the sense the tables above use. An empty
damage type simply means a kill of that sort gets no narration.

| Damage type     | Entries |
|-----------------|--------:|
| Bludgeoning     |       — |
| Piercing        |       3 |
| Slashing        |       7 |
| Fire            |       — |
| Cold            |       — |
| Electricity     |       — |
| Acid            |       — |
| Sonic           |       — |
| Force           |       — |
| Positive Energy |       — |
| Negative Energy |       — |

