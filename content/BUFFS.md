# Buff manifest

**Generated** from `Critical Effects.csv` — the compendium buffs the effect catalog references.
None of these exist yet except the broken-bone set migrated from astora-mod.

Dedicated healing is derived from the bleed the buff carries: **5 per die** of hit-point bleed,
**10 per die** of ability bleed. A buff with no bleed takes its threshold from the `(heal N)`
in its own text, or none at all.

Bleed config goes on the buff as `flags.pf1-bleed-effects.bleed` in the default (non-persist)
mode, so it stops when the buff clears. DH goes in `flags.pf1-critical-effects.dedicatedHealing`.

**138 buffs**, 35 of them carrying a bleed.
34 carry no description — see the note under the table.

| Buff | Effect | Bleed | DH | Referenced by |
|---|---|---|---|---|
| **Appendage Destroyed** | Appendage permanently useless | — | — | Crushed Appendage · Appendage, Skewering Blow · Appendage +1 |
| **Arm Destroyed** | — | — | — | Crushed Shoulder · Arm, Pulverized Shoulder · Arm +2 |
| **Become Undead** | — | — | — | Soul Rend · Negative |
| **Brittle Flesh** | Vulnerability to bludgeoning, piercing, slashing (heal 20 or 10 fire damage) | — | 20 | Brittle Flesh · Cold |
| **Broken Arm** | — | — | — | Broken Arm · Arm |
| **Broken Back** | — | — | — | Broken Back · Torso, Compound Fracture: Back · Torso |
| **Broken Finger** | — | — | — | Broken Finger · Arm |
| **Broken Foot** | — | — | — | Broken Foot · Leg, Compound Fracture: Foot · Leg |
| **Broken Hand** | — | — | — | Broken Hand · Arm |
| **Broken Jaw** | Skills involving speech at disadvantage, spells w/verbal components - concentration DC 15 + 2xlevel or fail | — | — | Broken Jaw · Head |
| **Broken Leg** | — | — | — | Broken Leg · Leg |
| **Broken Neck** | — | — | — | Broken Neck · Head, Chopped Neck · Head |
| **Broken Rib** | — | — | — | Broken Rib · Torso, Compound Fracture: Rib · Torso |
| **Broken Skull** | — | — | — | Broken Skull · Head, Head Cracker · Head +1 |
| **Broken Toes** | Disadvantage on all climb and acrobatics checks until healed (DC 10, 5 heal) | — | — | Broken Toes · Leg |
| **Broken Wing** | Half fly speed, -4 attacks/checks using wing until healed (heal 10) | — | 10 | Wing broken · Wing |
| **Bruised Tail** | -4 to attacks/checks using tail until healed (heal 10) | — | 10 | Bruised Tail · Tail |
| **Bruised Wing** | Wing useless 1d4 rounds | — | — | Wing bruised · Wing |
| **Bruising Blow** | -4 to attacks/checks using appendage until healed (heal 10) | — | 10 | Bruising Blow · Appendage |
| **Burned Feverish** | Vulnerability to fire, staggered (heal 20) | — | 20 | Burned Feverish · Fire, Set Alight · Fire +1 |
| **Cleaved Ankle** | 1/2 move, -4 to attacks/skills using leg until healed (heal 20) | — | 20 | Cleaved Ankle · Leg |
| **Cleaved Appendage** | -2 to attacks or checks using appendage until healed (heal 20) | — | 20 | Cleaved Appendage · Appendage |
| **Cleaved Finger** | -2 to attacks/checks using arm until healed (heal 10) | — | 10 | Cleaved finger · Arm |
| **Cleaved Forehead** ⚠ | Weapon stuck, dazed until removed | — | — | Cleaved Forehead · Head |
| **Cleaved Hand** | -4 to attacks/checks using arm until healed (heal 20) | — | 20 | Cleaved hand · Arm |
| **Cleaved Tail** | -2 to attacks or checks using tail until healed (heal 20) | — | 20 | Cleaved Tail · Tail |
| **Cleaved Wing** | 1/2 fly speed, -2 to attacks/skills using wing until healed (heal 10) | — | 10 | Cleaved Wing · Wing |
| **Clipped Foot** ⚠ | 3/4 move, -2 to attacks/skills using leg until healed (heal 10) | — | 10 | Foot clipped · Leg |
| **Compound Fracture: Finger** | — | — | — | Compound Fracture: Finger · Arm |
| **Compound Fracture: Hand** | — | — | — | Compound Fracture: Hand · Arm |
| **Compound Fracture: Wing** | Can't fly until healed (heal 20) | — | 20 | Wing compound fractured · Wing |
| **Consuming Brilliance** | Staggered and lose DR for 1d6 rounds | — | — | Consuming Brilliance · Positive |
| **Corrosive Wound** | 1d6 acid damage per round 3 rounds | — | — | Corrosive Wound · Acid |
| **Crushed Larynx** | Fatigued, muted until healed (heal 20) | — | 20 | Crushed Larynx · Head |
| **Crushing Blow** | Appendage useless until healed (heal 20) | — | 20 | Crushing Blow · Appendage |
| **Cut Brachial** | 4d6 deep bleed, arm useless until healed | 4d6 deep | 20 | Cut brachial · Arm |
| **Cut Deltoids** | 4d6 deep bleed, arm useless until healed | 4d6 deep | 20 | Cut Deltoids · Arm |
| **Dead Leg** | Leg useless 1d4 rounds | — | — | Dead Leg · Leg |
| **Deep Slice** | -2 to attacks or checks using appendage until healed (heal 10) | — | 10 | Deep Slice · Appendage |
| **Disemboweled** | 1d4 con damage each round a standard/move action is taken until healed. Full-round action (DC 15 fort to do it yourself) to put it back in. Move action each round to hold it in until healed (heal 20). | — | 20 | Disemboweled · Torso |
| **Dislocated Knee** | Half move, no 5 foot step, -2 AC until healed (DC 10, 10 heal) | — | — | Dislocated Knee · Leg |
| **Disoriented** | Deafened (heal 10) | — | 10 | Disoriented · Sonic |
| **Encased** | As 12 + suffocation | — | — | Encased · Cold |
| **Flash Frozen** | Paralyzed (20 fire damage or 20 bludgeoning damage), Vulnerability to bludgeoning until freed | — | — | Flash Frozen · Cold |
| **Fractured Tail** | Tail useless until healed (heal 20) | — | 20 | Fractured Tail · Tail |
| **Frostbite** | -2 to all rolls from numbing (heal 10 or 5 fire damage) | — | 10 | Frostbite · Cold |
| **Frostburn** | Vulnerability to bludgeoning, piercing, slashing (heal 20 or 10 fire damage) | — | 20 | Frostburn · Cold |
| **Funny Bone** | Arm useless for 1d4 rounds | — | — | Funny Bone · Arm |
| **Grazed Lung** | 1d6 deep bleed, fatigued until healed | 1d6 deep | 5 | Grazed Lung · Torso |
| **Hamstring** | 3/4 move, -2 to attacks/skills using leg until healed (heal 10) | — | 10 | Hamstring · Leg |
| **Holy Fire** | Englufed in holy fire - 6d6 positive energy damage at start of each round. Full round action: fort save to extinguish | — | — | Burning Radiance · Positive, Radiant Annihilation · Positive |
| **Horrific Scar** | Disadvantage on charisma checks other than intimidate, advantage on intimidate (lasts 1 month) | — | — | Horrific Scar · Head |
| **Impaled Appendage** | 3d6 deep bleed, -4 to attacks/skills using appendage until healed | 3d6 deep | 15 | Lodging Blow · Appendage |
| **Impaled Arm** | 3d6 deep bleed, -4 to attacks/skills using arm until healed | 3d6 deep | 15 | Lodged Weapon · Arm |
| **Impaled Gut** | 2d6 deep bleed, sickened until healed | 2d6 deep | 10 | Impaled Gut · Torso |
| **Impaled Stomach** | 3d6 deep bleed, Staggered until healed | 3d6 deep | 15 | Impaled Stomach · Torso |
| **Jarring Blow** | Appendage useless 1d4 rounds | — | — | Jarring Blow · Appendage |
| **Kebabed Arm** | 8d6 deep bleed, arm useless until healed | 8d6 deep | 40 | Kebabed · Arm |
| **Kebabed Leg** | 8d6 deep bleed, leg useless until healed | 8d6 deep | 40 | Kebabed · Leg |
| **Leg Destroyed** | — | — | — | Crushed Leg · Leg, Pulverized Leg · Leg +2 |
| **Muscle Lock** | Staggered (heal 10) | — | 10 | Muscle Lock · Electricity |
| **Neural Overload** | Confused, no actions requiring patience/concentration, no cha/int/wis based skills (heal 20) | — | 20 | Neural overload · Electricity |
| **Nicked Achilles** | Leg useless 1d4 rounds | — | — | Nicked Achilles · Leg |
| **Nicked Femoral** | 4d6 deep bleed, leg useless until healed | 4d6 deep | 20 | Nicked Femoral · Leg |
| **Nicked Tendon** | Drop item held, -4 to attacks/checks using arm for 1 round | — | — | nicked tendon · Arm |
| **Numbed Tail** | Tail useless 1d4 rounds | — | — | Numbed Tail · Tail |
| **Permanently Blinded** | — | — | — | Eyes Slashed · Head |
| **Permanently Blinded (One Eye)** | — | — | — | Shattered Eye Socket · Head *(on fail)*, Eye Plucked · Head +1 |
| **Persistent Acid** | 2d6 acid damage per round until neutralized or washed off | — | — | Persistent Acid · Acid |
| **Pierced Calf** | 2d6 deep bleed, 3/4 move, -2 to attacks/skills using leg until healed | 2d6 deep | 10 | Pierced Calf · Leg |
| **Pierced Hip** | 3d6 deep bleed, leg useless until healed | 3d6 deep | 15 | Pierced Hip · Leg |
| **Pierced Knee** | 3d6 deep bleed, 1/2 move, -4 to attacks/skills using leg until healed | 3d6 deep | 15 | Pierced Knee · Leg |
| **Pierced Leg** | 2d6 deep bleed, 3/4 move, -2 to attacks/skills using leg until healed | 2d6 deep | 10 | Pinned Leg · Leg |
| **Pierced Lung** | 2d6 deep bleed, fatigued until healed | 2d6 deep | 10 | Pierced Lung · Torso |
| **Pierced Muscle** | 2d6 deep bleed, -2 to attacks/skills using arm until healed | 2d6 deep | 10 | Pierced muscle · Arm |
| **Pierced Organs** | 3d6 deep bleed, Nauseated until healed | 3d6 deep | 15 | Pierced Organs · Torso |
| **Pierced Stomach** | 3d6 deep bleed, Staggered until healed | 3d6 deep | 15 | Pierced Stomach · Torso |
| **Pierced Throat** ⚠ | 5d6 deep bleed, Suffocating until healed | 5d6 deep | 25 | Pierced Throat · Head |
| **Pierced Wing Base** | 3d6 deep bleed, 1/2 fly speed, -4 to attacks/skills using wing until healed | 3d6 deep | 15 | Wing base pierced · Wing |
| **Pinned Arm** | 2d6 deep bleed, -2 to attacks/skills using arm until healed | 2d6 deep | 10 | Pinned Arm · Arm |
| **Pinned Tail** | 3d6 deep bleed, -4 to attacks/skills using tail until healed | 3d6 deep | 15 | Tail Pinned · Tail |
| **Pulped Appendage** | As 12, appendage hangs limp, entangling creature | — | — | Pulped Appendage · Appendage |
| **Punctured Brow** ⚠ | 3d6 deep bleed, blinded until healed | 3d6 deep | 15 | Punctured Brow · Head |
| **Punctured Cheekbone** | 2d6 deep bleed | 2d6 deep | 10 | Punctured Cheekbone · Head |
| **Punctured Hip** | Leg useless until healed | — | — | Punctured Hip · Leg |
| **Punctured Knee** | Leg useless 1d4 rounds | — | — | Punctured Knee · Leg |
| **Punctured Lung** | 2d6 deep bleed, exhausted until healed | 2d6 deep | 10 | Punctured Lung · Torso |
| **Punctured Muscles** | 3d6 deep bleed, -4 to attack/skills using arm until healed | 3d6 deep | 15 | Punctured muscles · Arm |
| **Punctured Neck** ⚠ | 5d6 deep bleed, Suffocating until healed | 5d6 deep | 25 | Punctured Neck · Head |
| **Punctured Tail** | 2d6 deep bleed, -2 to attacks/skills using tail until healed | 2d6 deep | 10 | Tail Punctured · Tail |
| **Punctured Wing** | 2d6 deep bleed, 1/2 fly speed, -2 to attacks/skills using wing until healed | 2d6 deep | 10 | Wing punctured · Wing |
| **Punctured Wrist** | Drop item held, -4 to attacks/checks using arm for 1d4 rounds | — | — | Wrist puncture · Arm |
| **Puncturing Blow** | 2d6 deep bleed -2 to attacks/skills using appendage until healed | 2d6 deep | 10 | Puncturing Blow · Appendage |
| **Rung Bell** | Unconscious - Fort at end of each round to come to | — | — | Rung Bell · Head |
| **Ruptured Eardrums** | Nauseated, flat footed, deafened (heal 20) | — | 20 | Ruptured Eardrums · Sonic |
| **Ruptured Organs** | 4d6 deep bleed, Nauseated until healed | 4d6 deep | 20 | Ruptured Organs · Torso |
| **Seared Flesh** | Vulnerability to fire, -2 to all rolls from pain (heal 10) | — | 10 | Seared Flesh · Fire |
| **Severed Appendage** | — | — | — | Cleaved Appendage · Appendage *(on fail)*, Severed Appendage · Appendage +1 |
| **Severed Arm** | — | — | — | Severed Arm · Arm, Vorpal cut · Arm |
| **Severed Biceps** | 3d6 deep bleed, arm useless until healed | 3d6 deep | 15 | Severed biceps · Arm |
| **Severed Ear** | Disadvantage on all checks involving hearing | — | — | Ear Severed · Head |
| **Severed Femoral** | 4d6 deep bleed, leg useless until healed | 4d6 deep | 20 | Severed Femoral · Leg |
| **Severed Finger** | — | — | — | Cleaved finger · Arm *(on fail)* |
| **Severed Fingers** | 1d4 fingers severed | — | — | Severed Fingers · Arm |
| **Severed Foot** | — | — | — | Cleaved Ankle · Leg *(on fail)*, Severed Foot · Leg |
| **Severed Hand** | — | — | — | Cleaved hand · Arm *(on fail)*, Severed Hand · Arm |
| **Severed Jaw** | Can't speak | — | — | Jaw Dropped · Head |
| **Severed Leg** | — | — | — | Severed Leg · Leg, Vorpal Cut · Leg |
| **Severed Muscles** | Arm useless until healed (heal 30) | — | 30 | Severed muscles · Arm |
| **Severed Nose** | Disadvantage on all checks involving smell, loses scent ability | — | — | Nose Severed · Head |
| **Severed Quads** | Leg useless until healed (heal 30) | — | 30 | Severed Quads · Leg |
| **Severed Tail** | — | — | — | Cleaved Tail · Tail *(on fail)*, Tail severed · Tail +1 |
| **Severed Tendons** | 3d6 deep bleed, 1/2 move, -4 to attacks/skills using leg until healed | 3d6 deep | 15 | Severed tendons · Leg |
| **Severed Toes** | Disadvantage on acrobatics & climb | — | — | Foot clipped · Leg *(on fail)*, Declawed · Leg |
| **Severed Wing** | — | — | — | Cleaved Wing · Wing *(on fail)*, Wing severed · Wing +1 |
| **Shattered Arm** | — | — | — | Shattered Arm · Arm |
| **Shattered Back** | — | — | — | Shattered Back · Torso, Pulverized Spinal Column · Torso +1 |
| **Shattered Eye Socket** | Blinded in eye until healed (heal 30) | — | 30 | Shattered Eye Socket · Head |
| **Shattered Foot** | — | — | — | Shattered Foot · Leg |
| **Shattered Hand** | — | — | — | Shattered Hand · Arm |
| **Shattered Leg** | — | — | — | Shattered Leg · Leg |
| **Shattered Neck** | — | — | — | Shattered Neck · Head, Cleaved Neck · Head |
| **Shattered Rib** | — | — | — | Crushing Blast · Force, Shattered Rib · Torso +2 |
| **Shattered Skull** | — | — | — | Shattered Skull · Head, Caved Cranium · Head |
| **Skewered Arm** | 4d6 deep bleed, arm useless until healed | 4d6 deep | 20 | Arm skewered · Arm |
| **Slashed Arm** | Drop item held, -4 to attacks/checks using arm for 1 round | — | — | Slashed arm · Arm |
| **Slashed Brow** ⚠ | Blinded 1d6 rounds or until wiped off (standard action) | — | — | Slashed Brow · Head |
| **Slashed Tail** | -2 to attacks until healed (heal 10) | — | 10 | Slashed Tail · Tail |
| **Sliced Calf** | 1/2 move, -4 to attacks/skills using leg until healed (heal 20) | — | 20 | Sliced Calf · Leg |
| **Sliced Muscle** | -4 to attacks/checks using arm until healed (heal 20) | — | 20 | Sliced muscle · Arm |
| **Sliced Tendons** | -2 to attacks/checks using arm until healed (heal 10) | — | 10 | Sliced tendons · Arm |
| **Sliced Wing** | 1/2 fly speed, -2 to attacks/skills using wing until healed (heal 10) | — | 10 | Wing Sliced · Wing |
| **Slit Wrist** | Drop item held, -4 to attacks/checks using arm for 1d4 rounds | — | — | Wrist Slit · Arm |
| **Sprained Wrist** | Drop item held in hand, -4 to attacks/checks using arm for 1 round | — | — | Sprained wrist · Arm |
| **Tail Destroyed** | Tail permanently useless | — | — | Shattered vertibrae · Tail, Tail Skewered · Tail +1 |
| **Tissue Liquefaction** | 2d6 acid damage and 1d6 con damage per round until neutralized or washed off | — | — | Tissue Liquefaction · Acid |
| **Weapon Stuck** | — | — | — | Lodging Blow · Appendage, Skewering Blow · Appendage +16 |
| **Wing Destroyed** | — | — | — | Wing crushed · Wing, Wing Skewered · Wing +1 |

⚠ = the sheet gave prose rather than a name; named after its effect. Rename if you'd rather.

**Effect** is the sheet's own wording, verbatim but for a capitalised first letter — it is the
brief, not the buff text. `(heal N)` in it is where the DH column came from and need not survive
into the item. A dash means the sheet gave a bare name, which happens in three cases: the
broken-bone buffs already built in astora-mod, the severed/destroyed family whose name is its
whole rule, and **Weapon Stuck**, specified in DESIGN.md §8.1.

