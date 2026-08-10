# Coverage

**Generated** by `node tools/pool-report.mjs --write`. Do not edit.

Pool: **196 effects**, 196 ranked, 0 untriaged.
Grid: **63 tables**, 756 rows — 3 weapon damage types ×
13 anatomy/location pairs, plus 8 damage types that roll no
location and keep one `general` table per anatomy.
**30 of 63 tables are saturated** (every band has its 3 candidates); 0 have no candidates at all.

A table is always twelve rows — the generator backfills gaps by reusing the nearest-ranked
candidate. This report is what tells you whether those twelve rows are twelve *effects* or one
effect stretched over twelve. Target is **3 candidates per band**, because a band is 3 rows.

---

## Work queue — tables in progress

132 band-gaps sit in tables that already have candidates. **Closest to done
first** — each line is a writing prompt: a damage type, a body part, and how bad the wound
should be. These are the cheapest wins; a table with two of three grave wounds needs one effect.

| Damage type | Body part          | Band     | Have | Need |
|-------------|--------------------|----------|-----:|-----:|
| Acid        | aberrant general   | Minor    |    1 |    3 |
| Acid        | aberrant general   | Moderate |    1 |    3 |
| Acid        | aberrant general   | Severe   |    1 |    3 |
| Acid        | aberrant general   | Grave    |    1 |    3 |
| Acid        | beast general      | Minor    |    1 |    3 |
| Acid        | beast general      | Moderate |    1 |    3 |
| Acid        | beast general      | Severe   |    1 |    3 |
| Acid        | beast general      | Grave    |    1 |    3 |
| Acid        | humanoid general   | Minor    |    1 |    3 |
| Acid        | humanoid general   | Moderate |    1 |    3 |
| Acid        | humanoid general   | Severe   |    1 |    3 |
| Acid        | humanoid general   | Grave    |    1 |    3 |
| Bludgeoning | aberrant appendage | Minor    |    1 |    3 |
| Bludgeoning | aberrant appendage | Moderate |    1 |    3 |
| Bludgeoning | aberrant appendage | Severe   |    1 |    3 |
| Bludgeoning | aberrant appendage | Grave    |    1 |    3 |
| Bludgeoning | beast tail         | Minor    |    1 |    3 |
| Bludgeoning | beast tail         | Moderate |    1 |    3 |
| Bludgeoning | beast tail         | Severe   |    1 |    3 |
| Bludgeoning | beast tail         | Grave    |    1 |    3 |
| Bludgeoning | beast wing         | Minor    |    1 |    3 |
| Bludgeoning | beast wing         | Moderate |    1 |    3 |
| Bludgeoning | beast wing         | Severe   |    1 |    3 |
| Bludgeoning | beast wing         | Grave    |    1 |    3 |
| Cold        | aberrant general   | Minor    |    1 |    3 |
| Cold        | aberrant general   | Moderate |    1 |    3 |
| Cold        | aberrant general   | Severe   |    1 |    3 |
| Cold        | aberrant general   | Grave    |    1 |    3 |
| Cold        | beast general      | Minor    |    1 |    3 |
| Cold        | beast general      | Moderate |    1 |    3 |
| Cold        | beast general      | Severe   |    1 |    3 |
| Cold        | beast general      | Grave    |    1 |    3 |
| Cold        | humanoid general   | Minor    |    1 |    3 |
| Cold        | humanoid general   | Moderate |    1 |    3 |
| Cold        | humanoid general   | Severe   |    1 |    3 |
| Cold        | humanoid general   | Grave    |    1 |    3 |
| Electricity | aberrant general   | Minor    |    1 |    3 |
| Electricity | aberrant general   | Moderate |    1 |    3 |
| Electricity | aberrant general   | Severe   |    1 |    3 |
| Electricity | aberrant general   | Grave    |    1 |    3 |
| Electricity | beast general      | Minor    |    1 |    3 |
| Electricity | beast general      | Moderate |    1 |    3 |
| Electricity | beast general      | Severe   |    1 |    3 |
| Electricity | beast general      | Grave    |    1 |    3 |
| Electricity | humanoid general   | Minor    |    1 |    3 |
| Electricity | humanoid general   | Moderate |    1 |    3 |
| Electricity | humanoid general   | Severe   |    1 |    3 |
| Electricity | humanoid general   | Grave    |    1 |    3 |
| Fire        | aberrant general   | Minor    |    1 |    3 |
| Fire        | aberrant general   | Moderate |    1 |    3 |
| Fire        | aberrant general   | Severe   |    1 |    3 |
| Fire        | aberrant general   | Grave    |    1 |    3 |
| Fire        | beast general      | Minor    |    1 |    3 |
| Fire        | beast general      | Moderate |    1 |    3 |
| Fire        | beast general      | Severe   |    1 |    3 |
| Fire        | beast general      | Grave    |    1 |    3 |
| Fire        | humanoid general   | Minor    |    1 |    3 |
| Fire        | humanoid general   | Moderate |    1 |    3 |
| Fire        | humanoid general   | Severe   |    1 |    3 |
| Fire        | humanoid general   | Grave    |    1 |    3 |

_…and 72 more._

---

## Untouched tables

0 of 63 tables have **no candidates at all**. These are
from-scratch jobs rather than gap-filling, so they are listed by damage type rather than
line by line. Remember one effect can be tagged for several body parts and damage types at once —
these do not cost 12 effects each.

| Damage type | Empty | Body parts |
|-------------|------:|------------|

---

## Coverage matrix

Candidates per band, per table. `3` is saturated; `.` is empty.

### Bludgeoning

| Body part          | Minor | Moderate | Severe | Grave | Total |
|--------------------|------:|---------:|-------:|------:|------:|
| humanoid arm       |     3 |        3 |      3 |     3 |    12 |
| humanoid leg       |     3 |        3 |      3 |     3 |    12 |
| humanoid torso     |     3 |        3 |      3 |     3 |    12 |
| humanoid head      |     3 |        3 |      3 |     3 |    12 |
| beast arm          |     3 |        3 |      3 |     3 |    12 |
| beast leg          |     3 |        3 |      3 |     3 |    12 |
| beast torso        |     3 |        3 |      3 |     3 |    12 |
| beast head         |     3 |        3 |      3 |     3 |    12 |
| beast tail         |     1 |        1 |      1 |     1 |     4 |
| beast wing         |     1 |        1 |      1 |     1 |     4 |
| aberrant appendage |     1 |        1 |      1 |     1 |     4 |
| aberrant torso     |     3 |        3 |      3 |     3 |    12 |
| aberrant head      |     3 |        3 |      3 |     3 |    12 |

### Piercing

| Body part          | Minor | Moderate | Severe | Grave | Total |
|--------------------|------:|---------:|-------:|------:|------:|
| humanoid arm       |     3 |        3 |      3 |     3 |    12 |
| humanoid leg       |     3 |        3 |      3 |     3 |    12 |
| humanoid torso     |     3 |        3 |      3 |     3 |    12 |
| humanoid head      |     3 |        3 |      3 |     3 |    12 |
| beast arm          |     3 |        3 |      3 |     3 |    12 |
| beast leg          |     3 |        3 |      3 |     3 |    12 |
| beast torso        |     3 |        3 |      3 |     3 |    12 |
| beast head         |     3 |        3 |      3 |     3 |    12 |
| beast tail         |     1 |        1 |      1 |     1 |     4 |
| beast wing         |     1 |        1 |      1 |     1 |     4 |
| aberrant appendage |     1 |        1 |      1 |     1 |     4 |
| aberrant torso     |     3 |        3 |      3 |     3 |    12 |
| aberrant head      |     3 |        3 |      3 |     3 |    12 |

### Slashing

| Body part          | Minor | Moderate | Severe | Grave | Total |
|--------------------|------:|---------:|-------:|------:|------:|
| humanoid arm       |     3 |        3 |      3 |     3 |    12 |
| humanoid leg       |     3 |        3 |      3 |     3 |    12 |
| humanoid torso     |     3 |        3 |      3 |     3 |    12 |
| humanoid head      |     3 |        3 |      3 |     3 |    12 |
| beast arm          |     3 |        3 |      3 |     3 |    12 |
| beast leg          |     3 |        3 |      3 |     3 |    12 |
| beast torso        |     3 |        3 |      3 |     3 |    12 |
| beast head         |     3 |        3 |      3 |     3 |    12 |
| beast tail         |     1 |        1 |      1 |     1 |     4 |
| beast wing         |     1 |        1 |      1 |     1 |     4 |
| aberrant appendage |     1 |        1 |      1 |     1 |     4 |
| aberrant torso     |     3 |        3 |      3 |     3 |    12 |
| aberrant head      |     3 |        3 |      3 |     3 |    12 |

### Fire

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Cold

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Electricity

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Acid

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Sonic

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Force

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Positive Energy

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

### Negative Energy

| Body part        | Minor | Moderate | Severe | Grave | Total |
|------------------|------:|---------:|-------:|------:|------:|
| humanoid general |     1 |        1 |      1 |     1 |     4 |
| beast general    |     1 |        1 |      1 |     1 |     4 |
| aberrant general |     1 |        1 |      1 |     1 |     4 |

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

