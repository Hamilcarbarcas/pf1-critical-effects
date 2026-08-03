# Bludgeoning

Effect tables for **Bludgeoning** damage. One section per anatomy × location; twelve rows each,
mildest first. Format and shorthands: [content/README.md](README.md).

Set a section's **Status** to `approved` and run `node tools/worksheets-to-catalog.mjs --write`
to fold it into `data/effects.json`. Sections left at `draft` are ignored.

## Humanoid · Arm
**Status:** draft

|  # | Band     | Effect            | Mechanic                                                                                                                    |
|---:|----------|-------------------|-----------------------------------------------------------------------------------------------------------------------------|
|  1 | Minor    | Numbed Arm        | -2 on attacks and skill checks using that arm until the end of your next turn.                                              |
|  2 | Minor    | Dropped Item      | Any item(s) held in the hand of the attacker's choice are dropped.                                                          |
|  3 | Minor    | Flung Weapon      | Weapon is thrown 1d6x5 feet in a random direction.                                                                          |
|  4 | Moderate | Broken Finger     | Broken Finger condition: disadvantage on skill checks with that hand. Two on one hand become Broken Hand. DC 10 Heal, 5 HP dedicated. |
|  5 | Moderate | Broken Hand       | Broken Hand condition: -4 on attacks and skills using it, and DC 10 Fort on each such use or it becomes a fractured hand. DC 10 Heal, 10 HP dedicated. |
|  6 | Moderate | Broken Arm        | Broken Arm condition: -6 on attacks and skills using that arm. DC 10 Heal, 10 HP dedicated.                                 |
|  7 | Severe   | Broken Elbow      | Broken Elbow condition: -6 on attacks and skills using that arm. DC 15 Heal, 15 HP dedicated.                               |
|  8 | Severe   | Compound Arm Fracture | Broken Arm condition and 1d6 bleed. DC 10 Heal, 10 HP dedicated.                                                            |
|  9 | Severe   | Shattered Hand    | Shattered Hand condition: the hand is useless and rolls using it automatically fail. DC 20 Heal, 20 HP dedicated.            |
| 10 | Grave    | Shattered Wrist   | Shattered Wrist condition: the hand is useless and rolls using it automatically fail. DC 25 Heal, 25 HP dedicated.           |
| 11 | Grave    | Broken Shoulder   | Broken Shoulder condition: the whole arm is useless and rolls involving it automatically fail; hand-only work (Disable Device) may be excepted at GM discretion. DC 20 Heal, 20 HP dedicated. |
| 12 | Grave    | Shattered Arm     | Shattered Arm condition: the arm is useless, rolls using it automatically fail, and 1d6 bleed. DC 25 Heal, 30 HP dedicated.  |

## Humanoid · Leg
**Status:** draft

|  # | Band     | Effect            | Mechanic |
|---:|----------|-------------------|----------|
|  1 | Minor    | Off Balance       | Knocked prone. You may spend an immediate action to stay standing; if you do, you are flat-footed and have a speed of 5 feet until the end of your next turn. |
|  2 | Minor    | Knocked Down      | Knocked prone.                                                                                                              |
|  3 | Minor    | Dead Leg          | Speed halved and -2 AC until the end of your next turn.                                                                     |
|  4 | Moderate | Broken Foot       | Broken Foot condition: -2 AC, speed halved, cannot run or charge, disadvantage on footwork skills. DC 10 Heal, 10 HP dedicated. |
|  5 | Moderate | Broken Ankle      | Broken Ankle condition: -2 AC, speed halved, cannot run or charge, disadvantage on footwork skills. DC 15 Heal, 15 HP dedicated. |
|  6 | Moderate | Knee Capped       | Dislocated Knee condition: -4 AC, speed halved, cannot run or charge, disadvantage on footwork skills. DC 15 Heal, 10 HP dedicated. |
|  7 | Severe   | Fractured Heel    | Fractured Heel condition: -4 AC, speed halved, cannot run or charge, disadvantage on footwork skills. DC 15 Heal, 15 HP dedicated. |
|  8 | Severe   | Broken Leg        | Broken Leg condition: -4 AC, speed halved, cannot run or charge, disadvantage on footwork skills. DC 15 Heal, 20 HP dedicated. |
|  9 | Severe   | Compound Leg Fracture | Broken Leg condition and 1d8 bleed. DC 15 Heal, 20 HP dedicated.                                                            |
| 10 | Grave    | Shattered Foot    | Shattered Foot condition: -4 AC, speed 5 feet (half with crutches), cannot run or charge, footwork skills automatically fail. DC 20 Heal, 20 HP dedicated. |
| 11 | Grave    | Broken Knee       | Broken Knee condition: -6 AC, speed 5 feet (half with crutches), cannot run or charge, footwork skills automatically fail. DC 20 Heal, 20 HP dedicated. |
| 12 | Grave    | Shattered Leg     | Shattered Leg condition: the leg bears no weight — speed 0 without aid, 5 feet with crutches — and 1d8 bleed. DC 25 Heal, 30 HP dedicated. |

## Humanoid · Torso
**Status:** draft

|  # | Band     | Effect            | Mechanic |
|---:|----------|-------------------|----------|
|  1 | Minor    | Off Balance       | Knocked prone. You may spend an immediate action to stay standing; if you do, you are flat-footed and have a speed of 5 feet until the end of your next turn. |
|  2 | Minor    | Knocked Down      | Knocked prone.                                                                                                              |
|  3 | Minor    | Thrown            | Moved 1d4x5 feet directly away from the attacker. A solid object stops the movement and forces a DC 12 Reflex save or prone; another creature stops it and forces the save on both. |
|  4 | Moderate | Nethers           | Stunned 1 round, and every ally of the defender in line of sight loses their immediate/swift action for the round.           |
|  5 | Moderate | Kidney Strike     | Stunned 1 round and fatigued.                                                                                               |
|  6 | Moderate | Wind Knocked Out  | Stunned 1d4 rounds. DC 12 Fort at the end of each of your turns to end it early.                                             |
|  7 | Severe   | Broken Tailbone   | Broken Tailbone condition, and the attacker may take an attack of opportunity against you. All rests take twice as long. DC 15 Heal, 15 HP dedicated. |
|  8 | Severe   | Slipped Vertebrae | -2 attack and AC, speed halved, cannot run or charge, disadvantage on Str- and Dex-based skills. DC 10 Heal or 5 HP dedicated. |
|  9 | Severe   | Broken Ribs       | Broken Ribs condition: -2 attack and AC, an extra 1d6 nonlethal whenever you are hit, and fatigued until healed. DC 15 Heal, 20 HP dedicated. |
| 10 | Grave    | Broken Hip        | Broken Hip condition: -2 attack and AC, speed halved, cannot run or charge, disadvantage on Str- and Dex-based skills. DC 15 Heal, 20 HP dedicated. |
| 11 | Grave    | Broken Back       | Broken Back condition: no movement, -4 attack and AC. DC 15 Heal, 30 HP dedicated.                                          |
| 12 | Grave    | Crushed Chest     | Crushed Chest condition: ribs driven inward — -4 attack and AC, staggered, 1d6 bleed, and you cannot recover HP naturally until it is set. DC 20 Heal, 30 HP dedicated. |

## Humanoid · Head
**Status:** draft

|  # | Band     | Effect               | Mechanic |
|---:|----------|----------------------|----------|
|  1 | Minor    | Knocked Down         | Knocked prone.                                                                                                              |
|  2 | Minor    | Lost Teeth           | The attacker may take one attack of opportunity against you. Disadvantage on Diplomacy checks. False teeth may reduce or remove this. |
|  3 | Minor    | Broken Nose          | Broken Nose condition and 1d4 bleed. Disadvantage on Cha-based checks. DC 10 Heal, 10 HP dedicated.                          |
|  4 | Moderate | Dazing Blow          | Stunned 1 round.                                                                                                            |
|  5 | Moderate | Concussed Ear        | Dazed 1 round and deafened 1d4 minutes.                                                                                     |
|  6 | Moderate | Broken Jaw           | Broken Jaw condition: disadvantage on skills requiring speech, and somatic-component spells require a concentration check (DC 15 + twice the spell's level) or the spell is lost. DC 10 Heal, 15 HP dedicated. |
|  7 | Severe   | Knocked Out          | Unconscious 1d4 rounds. DC 15 Fort at the end of each of your turns to wake.                                                 |
|  8 | Severe   | Crushed Larynx       | Stunned 1 round and gain the Crushed Larynx condition: you cannot speak above a whisper and cannot cast spells with verbal components. 20 HP dedicated. |
|  9 | Severe   | Cracked Skull        | Stunned 1 round and take 1d6 Int, 1d6 Wis and 1d6 Cha damage (rolled separately).                                            |
| 10 | Grave    | Shattered Eye Socket | Shattered Eye Socket condition: blinded in that eye, and -2 on sight-based skills, attack rolls and Reflex saves. DC 20 Heal, 20 HP dedicated. |
| 11 | Grave    | Broken Neck          | Broken Neck condition: paralyzed until healed. DC 20 Heal, 25 HP dedicated.                                                 |
| 12 | Grave    | Stove-In Skull       | Unconscious and dying, and 1d6 Int, Wis and Cha **drain** (rolled separately). A DC 20 Heal check stabilizes. DC 25 Heal, 30 HP dedicated to regain consciousness. |

## Beast · Arm
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Beast · Leg
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Beast · Torso
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Beast · Head
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Beast · Tail
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Beast · Wing
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Aberrant · Appendage
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Aberrant · Torso
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |

## Aberrant · Head
**Status:** draft

|  # | Band     | Effect | Mechanic |
|---:|----------|--------|----------|
|  1 | Minor    |        |          |
|  2 | Minor    |        |          |
|  3 | Minor    |        |          |
|  4 | Moderate |        |          |
|  5 | Moderate |        |          |
|  6 | Moderate |        |          |
|  7 | Severe   |        |          |
|  8 | Severe   |        |          |
|  9 | Severe   |        |          |
| 10 | Grave    |        |          |
| 11 | Grave    |        |          |
| 12 | Grave    |        |          |
