# Coverage

**Generated** by `node tools/pool-report.mjs --write`. Do not edit.

Pool: **79 effects**, 45 ranked, 34 untriaged.
Grid: **63 tables**, 756 rows — 3 weapon damage types ×
13 anatomy/location pairs, plus 8 damage types that roll no
location and keep one `general` table per anatomy.
**4 of 63 tables are saturated** (every band has its 3 candidates); 51 have no candidates at all.

A table is always twelve rows — the generator backfills gaps by reusing the nearest-ranked
candidate. This report is what tells you whether those twelve rows are twelve *effects* or one
effect stretched over twelve. Target is **3 candidates per band**, because a band is 3 rows.

---

## Work queue — tables in progress

32 band-gaps sit in tables that already have candidates. **Closest to done
first** — each line is a writing prompt: a damage type, a body part, and how bad the wound
should be. These are the cheapest wins; a table with two of three grave wounds needs one effect.

| Damage type | Body part      | Band     | Have | Need |
|-------------|----------------|----------|-----:|-----:|
| Piercing    | humanoid arm   | Minor    |    2 |    3 |
| Piercing    | humanoid arm   | Moderate |    2 |    3 |
| Piercing    | humanoid arm   | Severe   |    2 |    3 |
| Piercing    | humanoid head  | Minor    |    2 |    3 |
| Piercing    | humanoid head  | Moderate |    2 |    3 |
| Piercing    | humanoid leg   | Minor    |    2 |    3 |
| Piercing    | humanoid leg   | Moderate |    2 |    3 |
| Piercing    | humanoid torso | Minor    |    2 |    3 |
| Piercing    | humanoid torso | Severe   |    2 |    3 |
| Piercing    | humanoid torso | Grave    |    2 |    3 |
| Slashing    | humanoid arm   | Moderate |    2 |    3 |
| Slashing    | humanoid arm   | Severe   |    2 |    3 |
| Slashing    | humanoid head  | Minor    |    2 |    3 |
| Slashing    | humanoid head  | Moderate |    2 |    3 |
| Slashing    | humanoid leg   | Moderate |    2 |    3 |
| Slashing    | humanoid leg   | Severe   |    2 |    3 |
| Slashing    | humanoid torso | Severe   |    2 |    3 |
| Slashing    | humanoid torso | Grave    |    2 |    3 |
| Piercing    | humanoid arm   | Grave    |    1 |    3 |
| Piercing    | humanoid head  | Severe   |    1 |    3 |
| Piercing    | humanoid leg   | Severe   |    1 |    3 |
| Piercing    | humanoid torso | Moderate |    1 |    3 |
| Slashing    | humanoid arm   | Minor    |    1 |    3 |
| Slashing    | humanoid head  | Severe   |    1 |    3 |
| Slashing    | humanoid leg   | Minor    |    1 |    3 |
| Slashing    | humanoid leg   | Grave    |    1 |    3 |
| Slashing    | humanoid torso | Minor    |    1 |    3 |
| Slashing    | humanoid torso | Moderate |    1 |    3 |
| Piercing    | humanoid head  | Grave    |    0 |    3 |
| Piercing    | humanoid leg   | Grave    |    0 |    3 |
| Slashing    | humanoid arm   | Grave    |    0 |    3 |
| Slashing    | humanoid head  | Grave    |    0 |    3 |

---

## Untouched tables

51 of 63 tables have **no candidates at all**. These are
from-scratch jobs rather than gap-filling, so they are listed by damage type rather than
line by line. Remember one effect can be tagged for several body parts and damage types at once —
these do not cost 12 effects each.

| Damage type     | Empty | Body parts                                                                                                               |
|-----------------|------:|--------------------------------------------------------------------------------------------------------------------------|
| Bludgeoning     |  9/13 | beast arm, beast leg, beast torso, beast head, beast tail, beast wing, aberrant appendage, aberrant torso, aberrant head |
| Piercing        |  9/13 | beast arm, beast leg, beast torso, beast head, beast tail, beast wing, aberrant appendage, aberrant torso, aberrant head |
| Slashing        |  9/13 | beast arm, beast leg, beast torso, beast head, beast tail, beast wing, aberrant appendage, aberrant torso, aberrant head |
| Fire            |   3/3 | **all**                                                                                                                  |
| Cold            |   3/3 | **all**                                                                                                                  |
| Electricity     |   3/3 | **all**                                                                                                                  |
| Acid            |   3/3 | **all**                                                                                                                  |
| Sonic           |   3/3 | **all**                                                                                                                  |
| Force           |   3/3 | **all**                                                                                                                  |
| Positive Energy |   3/3 | **all**                                                                                                                  |
| Negative Energy |   3/3 | **all**                                                                                                                  |

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
| humanoid arm       |     2 |        2 |      2 |     1 |     7 |
| humanoid leg       |     2 |        2 |      1 |     . |     5 |
| humanoid torso     |     2 |        1 |      2 |     2 |     7 |
| humanoid head      |     2 |        2 |      1 |     . |     5 |
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
| humanoid arm       |     1 |        2 |      2 |     . |     5 |
| humanoid leg       |     1 |        2 |      2 |     1 |     6 |
| humanoid torso     |     1 |        1 |      2 |     2 |     6 |
| humanoid head      |     2 |        2 |      1 |     . |     5 |
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

## Untriaged

34 pool effects have no `rank` and are therefore placed in **no table at all** —
they are inventory, not content. Give each one a 1-12 severity score to bring it into play.

| Effect               | Slots          | Damage types       |
|----------------------|----------------|--------------------|
| Achilles Tendon      | humanoid/leg   | piercing, slashing |
| Back Stabbed         | humanoid/torso | piercing, slashing |
| Beheaded             | humanoid/head  | slashing           |
| Broken Heart         | humanoid/torso | piercing, slashing |
| Broken Heel          | humanoid/leg   | piercing           |
| Caved Cranium        | humanoid/head  | bludgeoning        |
| Cleaved Forehead     | humanoid/head  | slashing           |
| Disemboweled         | humanoid/torso | piercing, slashing |
| Eye Plucked          | humanoid/head  | piercing, slashing |
| Femoral Artery       | humanoid/leg   | piercing, slashing |
| Finger Tipped        | humanoid/arm   | piercing, slashing |
| Horrific Facial Scar | humanoid/head  | piercing, slashing |
| Impaled Stomach      | humanoid/torso | piercing, slashing |
| Lost Fingers         | humanoid/arm   | piercing, slashing |
| Lost Toes            | humanoid/leg   | piercing, slashing |
| Pierced Backside     | humanoid/torso | piercing, slashing |
| Pierced Brain        | humanoid/head  | piercing           |
| Pierced Eardrum      | humanoid/head  | piercing           |
| Pierced Foot         | humanoid/leg   | piercing, slashing |
| Pierced Hand         | humanoid/arm   | piercing, slashing |
| Pierced Knee         | humanoid/leg   | piercing           |
| Pierced Lung         | humanoid/torso | piercing, slashing |
| Pierced Mouth        | humanoid/head  | piercing           |
| Pierced Throat       | humanoid/head  | piercing           |
| Scalped              | humanoid/head  | slashing           |
| Severed Arm          | humanoid/arm   | slashing           |
| Severed Ear          | humanoid/head  | slashing           |
| Severed Foot         | humanoid/leg   | slashing           |
| Severed Hand         | humanoid/arm   | slashing           |
| Severed Leg          | humanoid/leg   | slashing           |
| Severed Nose         | humanoid/head  | piercing, slashing |
| Slit Wrists          | humanoid/arm   | piercing, slashing |
| Split Hand           | humanoid/arm   | slashing           |
| Throat Slashed       | humanoid/head  | slashing           |

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

