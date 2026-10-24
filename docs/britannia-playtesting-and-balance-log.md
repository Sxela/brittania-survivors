# Britannia Survivors playtesting case study

Recorded on 2026-10-20, using deployed 0.9.19 and the retained earlier experiment results as the historical baseline. This log connects player observations and experiments to the changes they motivated. Early observations come from the development conversation and do not have reliable individual dates or build numbers; version labels below are used where release notes or saved experiment results establish them. Later working-tree changes need their own entry and validation rather than silently inheriting these outcomes.

Use the [general playtesting workflow](playtesting-and-balance-log.md) and [mechanics guide](game-to-survivors-mechanics.md) for reusable methods, and the [reference profile](britannia-survivors-reference.md) for this game's settings. Historical decisions below can be superseded. An implemented change establishes behavior; it does not, by itself, establish that players find the result balanced.

## How evidence is recorded

**Player report** means a concrete observation or preference from play. **Mechanical verification** means a test, source audit or packaged check of a specific rule. **Simulation result** means a seeded run under a stated control and purchasing policy. Keep these separate from human clear rates and subjective difficulty.

Code links below are available in the public source export. Raw reports under `research/`, checks under `.cache/`, and promo materials under `artifacts/` belong to the development checkout and are excluded from that export.

## Resources and useful choices

### Constant mana starvation

**Report:** the automatic main attack continuously exhausted mana, leaving the character at zero and making the resource unhelpful.

**Change:** remove player mana from the survival loop and retire dependent player spells and item properties. Stamina, item durability and unused primary attributes/requirements received the same dependency audit. Mana-drain abilities, mana/stamina leech, resource regeneration, repair and lower-requirement bonuses must not occupy valuable gameplay rolls when their underlying player systems are absent.

**Verification and scope:** active equipment properties are filtered in [equipment](../game/equipment.mjs); the playable spell subset is filtered in [the spell system](../game/spell-system.mjs). Enemy mages still have their own mana and casting logic. Removing the hero's resource did not remove the enemy AI resource.

**Lesson:** remove a failed resource through all dependent systems, including shops, comparisons and old saves, rather than only hiding its bar.

### Abilities with little crowd value

**Reports:** single-target paralysis or slow felt weak in dense crowds; uncontrolled blocking walls could be useless or harmful; Feeblemind, Cure and Arch Cure appeared to do nothing useful.

**Changes:** add modest splash to targeted offensive spells; adapt Feeblemind to interrupt and silence nearby casters; retire cures and other abilities without a supported useful role at the time. Preserve native spell identities and repair incorrect or absent effects, including Mind Blast, Earthquake, Meteor Swarm and directional projectiles, so usefulness can be judged from actual behavior.

**Current limitation:** blocking walls and some control spells remain available. Their inclusion is not evidence that their automatic placement has passed a complete utility audit. Player contact poison also exists in current [monster behavior](../game/monster-behavior.mjs), so the earlier rationale that the player cannot be poisoned must not be treated as a permanent fact. Reconsider cleanse usefulness against actual poison frequency and cost before either restoring or permanently rejecting it.

**Lesson:** record an exclusion's dependency and revisit it when the dependent system changes. A cosmetic fix and a balance fix answer different questions.

### Full spellbooks and unusable draws

**Reports:** full offensive/defensive categories could force replacement or produce repeated defensive choices; there was no useful way to keep the current build. Later, learning and improving spells were mixed together too often.

**Changes:** use 7 offensive and 3 defensive slots; ensure an ordinary reward has a useful passive fallback; sample eligible groups rather than letting the largest catalog family dominate. Separate new-spell learning from improvements. By 0.9.3, ordinary rewards and every-fifth-level learning show 3 choices, while the between-area shop shows 5. Learning milestones allow explicit replacement or keeping current spells; replacement resets individual progress, while shared bonuses remain.

**Verification:** [choice grouping](../game/choice-draw.mjs), [level rewards](../game/core.mjs), spell-learning tests and transaction tests cover eligibility, replacement and cancellation. A fallback cannot guarantee variety when only one useful family remains.

### Upgrade progression and compounding

**Reports and direction:** replace spell levels with damage/potency, area, cast speed and useful duration improvements; use target count for chains. Separate general improvements from individual ones. Prevent +50% followed by +5% from becoming a compounded +57.5%.

**Changes:** 0.9.0 introduced independent improvements and a separate two-option behavior milestone after each 5 individual spell purchases. Subsequent learning/shop revisions separated acquisition from improvement. Version 0.9.6 established individual/hero bonuses of 5/10/15/25/50% and shared bonuses of 5/10/15/20/25%, with additive accumulation against the documented base. Luck changes quality. Integer target counts have their own rarity schedule.

**Verification:** [upgrade arithmetic](../game/spell-upgrades.mjs) and its tests cover additive contributions, tradeoffs, fractional projectile chance, milestone queues and legacy offers. Shared purchases do not advance an individual spell milestone. Avoid interpreting equal percentage labels across raw damage and class-base bonuses as equal absolute gains.

## Threats and counterplay

### Early targeted caster pressure

**Reports:** many lightning casters could kill a moving player in the first minutes; targeted spells had no practical escape range. After readable warnings were added, the player requested wider range and restored casting frequency rather than overly passive enemies.

**Changes:** delay dangerous caster families and targeted attacks; place a warning at a fixed ground position; give casts a range, visibility checks and interruption rules. A short-range iteration was later widened. Current targeted spell ranges are 900 world units, with leaving range canceling a pending cast immediately. The ground warning remains dodgeable within that range.

**Current mechanical settings:** targeted warnings last 1.15 seconds before game time 300 and 0.95 seconds afterward. A global 1.8-second targeted-cast spacing and at most 2 pending targeted casts limit overlap. Other per-caster cadence and spell selection remain active. See [monster behavior](../game/monster-behavior.mjs); world units are not a promise of identical screen coverage on every viewport.

**Lesson:** improve counterplay first, then restore pressure. The final cast cadence should be judged with actual warnings, sight lines and available movement, not by looking at range alone.

### Native monster identity and role

**Reports:** Balrons appeared early with implausibly low HP; humanoid enemies could be naked; elementals and variants could lose their expected hue. Mixed monsters from unrelated zones weakened the setting.

**Changes:** recover source HP/damage and behavior, restrict ordinary-wave eligibility, use native wearable layers/hues, and bind area rosters to local spawn data. Boss promotion is an explicit survival adaptation rather than an excuse to flatten all native creatures into interchangeable trash.

**Verification:** [source stat resolution](../game/monster-stats.mjs), [enemy equipment](../game/enemy-equipment.mjs), source catalog audits and zone tests exercise the mapping. Appearance completeness and encounter fairness remain separate checks.

### Guardians took too long to kill

**Report:** bosses in the opening areas felt excessively tough; the requested first change was approximately halving HP.

**Change in 0.9.9:** reduce guardian promotion from 15 times to 7.5 times HP. Damage stays at 2.5 times the selected source-scaled creature. Existing affected saves migrate once, preserving remaining-health fraction.

**Verification:** [promotion and migration](../game/zone-run.mjs) and timed-zone tests cover the halving and idempotence. These numbers coexist with source stats, difficulty, route growth and within-zone pressure. They are not the total ratio against an unscaled native monster.

**Follow-up:** measure boss time to kill with earned builds. Later bot failures do not prove that boss HP alone remains the cause.

## Rewards and the area loop

### Repetitive or meaningless equipment

**Reports:** weapons dominated drops, jewelry was rarely seen, plain clothing could have no useful stats, and differently named items sharing a slot were compared incorrectly. A starter robe could obscure equipment and appear impossible to remove.

**Changes:** include meaningful slot families and active affixes; reject drops without gameplay benefits; compare against the canonical equipment slot before shared visual layers. Make worn equipment visible and treat removable clothing separately from the base character. Hide unsupported properties in valuation and display as well as generation.

**Verification:** [equipment eligibility/comparison](../game/equipment.mjs), [conservative dominance checks](../game/general-mechanics.mjs), equipment and class-weapon tests. A scalar item score is not sufficient justification for autoselling a tradeoff or a different granted spell.

### Tiny drops were easy to miss

**Report:** rings and similar equipment were visually easy to overlook.

**Changes:** 0.9.4 packaged equipment in visible native chests, initially opened with double-click/tap. Player feedback then changed 0.9.8 to automatic walk-over opening, retaining manual opening and floor/reach/visibility checks. Version 0.9.7 guarantees exactly one chest from each boss or champion; ordinary enemies do not roll equipment chests. Every wave includes a champion, including the boss wave, and failed leader placements remain queued.

**Verification:** [chest reach](../game/loot-chests.mjs), [drop eligibility](../game/reward-rules.mjs), wave-champion and loot tests. Luck affects equipment quality and upgrade rarity, not the guaranteed chest occurrence.

### Repeated purchases and accidental spending

**Reports:** the gold spell shop closed after one purchase; returning from replacement could still spend gold; clicking while a boss died could accidentally select a card. Players wanted to sell equipment to fund more upgrades.

**Changes:** use a repeatable safe shop with 5 offers, inventory access, item trading, paid rerolls and an explicit Next Area action. Charge only successful transactions. Require action buttons rather than whole-card activation, with a 1-second input guard on shop opening/refresh. Higher-rarity upgrades cost more.

**Verification:** [shop transactions](../game/zone-run.mjs) and [modal controls](../game/app.mjs), with tests for insufficient money, canceled replacement, invalid offers and repeated purchases. The input guard must be exercised through actual mouse, touch and keyboard paths as well as simulation tests.

### Fixed quotas and unlimited post-boss farming

**Reports and direction:** monsters should arrive in substantial timed hordes rather than stop after a fixed count; waves should continue through the boss fight and pressure the player to evacuate afterward. The moongate should appear immediately after the boss dies, while remaining drops are still collectible.

**Changes:** 0.9.6 replaced quotas with a timed schedule: 30-second hordes and an opening guardian at 120 seconds, larger randomized waves as progression rises, and no population cap. Post-boss pressure continues. Version 0.9.12 makes the immediately available gate last 30 active seconds; missing it ends the run. Entering it opens the safe upgrade shop. Reward/pause screens freeze active time.

**Verification:** [wave plan](../game/zone-pacing.mjs), [area state machine](../game/zone-run.mjs), timed-wave and evacuation tests. Route lengths are 20/35/all available areas on Easy/Normal/Hard, randomized within source-threat brackets and normalized toward increasing target strength/rewards.

**Superseded behavior:** collecting indefinitely after the boss and quota-based completion are historical designs, not current rules. An earlier square battlefield cap was also reverted in 0.9.13; spawning must use the actual full-width or portrait viewport.

### Mining distance, floating ore and reward feedback

**Reports:** ore sometimes appeared above its reachable floor, required standing too close, and could look inexhaustible. Gold balance and pickup rewards were difficult to track.

**Changes:** use reachable walking surfaces and resample ore height on load/relocation. Deposits have 4 finite strikes of 3 stationary seconds each; 0.9.10 extends interaction reach to 66 world units. Show gold in the HUD/shop and floating gold/XP/item feedback near the hero. Movement interrupts the current strike; saves preserve depletion.

**Verification:** [mining](../game/mining.mjs), same-floor collection and all-area mining tests. Optional resource income must be distinguished from income assumed by campaign balance bots.

## Combat and sustain experiment in 0.9.18

**Question:** can the player stop moving because enemies cannot reach, weak mobs block stronger hits, or regeneration/resistance/leech outheal everything?

The experiment used the actual fixed-step game simulation, seeded rewards and native-map navigation, with open-terrain stress runs separated from earned native campaigns. Raw data is retained under `research/balance/`; the report is `research/balance/index.html` and summary is `research/balance/summary.json`.

### Diagnosed causes and changes

| Finding | Change | Verification scope |
| --- | --- | --- |
| Shared contact hit timing let a weak overlapping creature shield the hero from a stronger one | Resolve the strongest eligible touching attacker | Direct contact tests; not an increase to every enemy's damage |
| Passive/item recovery could sustain excessive incoming pressure | For 2 seconds after actual damage, use 25% regeneration capped at 1% of base HP per second; restore full recovery afterward | Formula, timing, save and combat stress checks |
| Repeated crowd-hit leech could heal too rapidly | Retain proc chance and 30%-of-damage formula, but share a 0.5-second cooldown and cap each heal at 2.5% of base HP | Recursive/crowd proc accounting and cooldown tests |
| Ranger coverage and tempo lagged | Add +50% to the native bow tempo pool and let arrows hit up to 3 creatures; the tested starter interval changed from 1.5 to 1 second | Starter weapon tests plus scenario simulations |
| Tight corners and footprint checks trapped pursuers | Validate continuous body clearance, keep tight corners, retry finer paths; after 6 seconds stuck, permit recovery to a legal visible location with a clear approach while retaining HP | Native movement probes plus regression cases |

The class resistance and damage-base formula stayed unchanged. The experiment identified contact/sustain and pursuit defects before supporting a wholesale switch back to flat resistance upgrades.

### Controlled defense stress results

The before/after set uses seed 712, Normal difficulty, three classes, checkpoints 5/10/20 and stationary or moving policies. The synthetic allocation gives 10 legal passive cards and 5 generated leader chests per prior area, with an estimated 7 character levels per area. It is deliberately generous and was not earned through a campaign.

| Version | Control | Cases | Cleared checkpoint encounter | Died | Survived to horizon without clear |
| --- | --- | --- | --- | --- | --- |
| Before tuning | Stationary | 9 | 6 | 1 | 2 |
| Before tuning | Moving | 9 | 7 | 0 | 2 |
| 0.9.18 | Stationary | 9 | 1 | 8 | 0 |
| 0.9.18 | Moving | 9 | 9 | 0 | 0 |

The remaining stationary clear was the heavily invested warrior at checkpoint 20. The result supports reducing effortless passive tanking while retaining a strong moving defensive build under this allocation. It does not establish human win rates. Changing procs can change subsequent RNG draws even with the same seed; historical outgoing-damage telemetry could double-count nested procs and was not used for a before/after DPS claim.

### Earned campaigns and navigation

| Experiment | Result | Interpretation |
| --- | --- | --- |
| 36 fresh native campaign bots; 3 classes, 3 difficulties, 2 seeds, stationary/moving; at most 2 areas or 6 minutes | Stationary: 18/18 died. Moving: 2/18 cleared the requested 2 areas, 16/18 died | Early difficulty needs human follow-up; simple local avoidance and choice scoring are limited |
| 18 moving full-route attempts; 6-hour simulated horizon and 60-second CPU allowance per attempt | 0 victories, 18 deaths, 0 CPU-budget aborts; farthest area 4; longest attempt 452.3 active seconds | Complete 20/35/73-area viability was not established |
| 584 navigation probes across 73 native areas, radii 14 and 22.4, up to 35 simulated seconds | 584 reached melee range; 5 used stuck recovery; no incomplete probes | Sampled coverage, including fallback behavior; not proof of every hiding position or giant body |

Campaign bots earn actual XP, loot and purchases, but omit mining and simplify item valuation, tactics and exit travel. Synthetic checkpoints, earned runs and human play must remain distinct. These results predate the 0.9.19 geometry expansion.

## Geometry and usability findings

### Floors, buildings and missing scenery

**Reports:** floating scrolls/ore, missing supports, apparently walkable grass blocked, black dungeon tiles, no combat inside a house, upper floors disappearing from a distance, floor tiles drawing over the hero, and jumps during ordinary walking.

**Changes:** restore source decorations; normalize collision against native supports and clearance; use continuous rendered terrain heights with explicit floor-entry rules; keep drops/corpses at the death floor. Cutaway applies to the obstructing foreground building/object rather than every upper story in the scene. Foreground trees can use the native stump treatment. Verified Spectre floor placeholders received targeted native-floor repairs rather than a blanket replacement of all black tiles.

**Evidence:** the earlier `research/zone-quality-audit.json` records 73 reviewed areas, 28 floor repairs, no missing art and no audit errors at that revision. The current `research/zone-height-audit.json` still excludes 8 unsupported cells; it retains separate counts for real/remaining large support transitions. Those counts do not mean every vertical seam is a bug or that every multistory position is supported. Runtime projection still has one selected walking height per cell.

### Compact crops in 0.9.19

**Report:** some areas, specifically Vinculum Inn, were cramped despite walkable terrain visible around them.

**Diagnosis:** the Inn exported only 29 by 40 native tiles. Surrounding scenery was rendered as a backdrop but remained outside movement bounds.

**Change:** widen 12 compact crops to at least 128 tiles per side, copy their actual surrounding terrain/statics, and recompute physical reachability. Nine gained connected walkable floor. Translate saved actors, loot, ore, spell endpoints and moongates when the local origin changes.

| Area | Previous reachable cells | After expansion |
| --- | --- | --- |
| Vinculum Inn | 842 | 10,689 |
| Shrine of Sacrifice | 1,398 | 9,528 |
| Bet-Lem Reg | 3,296 | 11,443 |
| Gypsy Camp 4 | 714 | 3,456 |
| Gypsy Camp 1 | 978 | 4,079 |
| Shrine of Honesty | 1,725 | 3,981 |
| Gypsy Camp 3 | 2,072 | 5,994 |
| Pormir Harm | 964 | 9,691 |
| Fan Dancer's Dojo | 1,640 | 9,358 |
| Lizard Passage | 620 | 620 |
| Cyclops Temple | 2,342 | 2,342 |
| The Painted Caves | 737 | 737 |

The last three are physically enclosed, so larger image dimensions did not create new floor. All old reachable ground was retained, and 61 unaffected region records stayed unchanged. Recorded checks passed 356 gameplay tests and 22 Python location tests. A packaged Inn check crossed the former crop boundary and restored an older save's player/ore positions. The complete 584-probe navigation matrix was not rerun after this expansion.

Evidence: `research/zone-expansion-audit.json`, `research/zone-height-audit.json`, [map/save relocation](../game/location-map.mjs), location tests and development check logs. A larger arena can change crowd density and escape routes; the prior combat results are not fresh balance validation of these enlarged areas.

### Interface friction and intermittent stalls

**Reports:** overlapping HUD panels; oversized/clunky menu copy; unreadable or unscrollable comparisons covering items; self-comparison on equipped items; backpack and spell panels occupying unnecessary space; missing native accessory frames; loud sound and repetitive footsteps; phone layout priorities differed from desktop.

**Changes:** favor source-game controls/icons/fonts, separate scrollable overlays, visible native slot frames, direct drag targets, shorter menu actions, configurable sound defaulting to 20%, and responsive HUD layouts. Player footsteps were removed. Current Stats and per-spell source breakdowns arrived in 0.9.16. See the [UI workflow](nostalgic-ui-workflow.md) for the reusable rules.

**Performance report:** occasional approximately one-second frames could recover without a major crowd reduction. Population alone was therefore not a sufficient diagnosis. Per-area loading, bounded image caches, visible-static indexing and budgeted navigation reduce known work, but the report remains open for long-session profiling of path searches, decoding, garbage collection, particular spells and map transitions. Do not record it as fully solved without matching captured stalls to their cause.

## Next playtest priorities

1. Play fresh human starts with every class/difficulty and record warnings, level timing, gold, deaths and first-boss duration.
2. Continue genuinely earned saves through the full route; inspect late compounded target HP/damage before assuming opening success carries forward.
3. Repeat navigation and spawn coverage on enlarged regions, with large bodies, interiors, stairs and possible hiding places.
4. Re-audit automatic walls, control effects and cleanse eligibility against the current enemy/status ecosystem.
5. Test economy with and without mining, and compare low/high luck quality and purchases without granting free resources.
6. Capture worst-frame traces in long sessions on desktop and portrait devices, including crowd growth and high-projectile builds.

Promo encounters use staged health, equipment, timing and source artwork. They are presentation checks and must never be counted as earned balance runs.

## Template for the next entry

```text
Entry ID and date:
Build and source/configuration hashes:
Player report or test hypothesis:
Reproduction: seed, route, area, class, equipment, abilities, input and device:
Evidence type: human / mechanical / synthetic stress / earned bot:
Diagnosis and alternatives considered:
Change and exact old/new values with units:
Verification and raw output paths:
Before/after outcomes, including horizons, aborts and recovery fallbacks:
What the evidence establishes:
Remaining uncertainty, superseded decisions and next playtest:
```
