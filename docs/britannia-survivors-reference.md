# Britannia Survivors mechanics reference

This profile records the implementation at 0.9.19. It accompanies the [reusable porting guide](game-to-survivors-mechanics.md). These settings are adaptations for this game, not claims about vanilla Ultima Online or prescribed values for another port.

The [Britannia playtesting case study](britannia-playtesting-and-balance-log.md) explains which observations and experiments motivated these settings, including historical decisions that were later superseded. The [general playtesting workflow](playtesting-and-balance-log.md) is reusable in other games.

## Combat and classes

The hero moves manually and attacks automatically. Mana, stamina, primary attributes, item durability and their dependent bonuses/requirements are excluded from the active equipment system. Physical and elemental are the two calculation channels; native elemental identities remain useful for effects and burn, slow and poison.

Class bases apply to both resistance percentages and damage bonus percentages:

| Class | Physical base | Elemental base |
| --- | --- | --- |
| Magician | 5% | 20% |
| Warrior | 20% | 5% |
| Ranger | 12% | 12% |

Relative improvements add against these class bases; flat item points add separately. Resistance caps at 70%. A magician with +50% physical resistance reaches 7.5% before flat additions. For damage, an elemental base bonus of 20% with +50% relative improvement becomes a 30% bonus, giving a 1.30 channel multiplier before other applicable layers.

Incoming damage subtracts flat armor, applies channel resistance and a minimum of 1 damage before absorption, then consumes any applicable temporary shield. Warrior starts with 2 flat armor. A shared contact hit window uses the strongest overlapping eligible attacker, preventing a weak enemy from sheltering the player against a boss.

For two seconds after actual damage, passive/item regeneration runs at 25%, capped at 1% of base HP per second. Outside that window it returns to full recovery. Life leech retains its rolled chance and 30%-of-damage healing but shares a 0.5-second cooldown and caps each proc at 2.5% of base HP. Healing spells remain separate.

Magicians start with a Fireball Wand. Wands and staves grant a separate autocast that consumes no learned slot, receives shared/general bonuses and cannot receive individual or Super Upgrades. Swapping preserves its shared cooldown. Other weapons receive deterministic arcane, sweeping, swift or vampiric traits stored separately from native properties. Rangers gain a +50% contribution to native bow tempo, and basic arrows can hit three targets.

Sources: [combat types](../game/combat-types.mjs), [simulation and classes](../game/core.mjs), [equipment filtering and comparison](../game/equipment.mjs), [weapon identities](../game/weapon-traits.mjs).

## Abilities and progression

The learned loadout has 7 offense and 3 defense slots. The source Magery catalog is retained, but the playable subset excludes travel/world utilities and retired combat abilities without useful targets or resources. Examples include Mana Drain, Mana Vampire, Cure, Arch Cure, Dispel and Mass Dispel. Feeblemind is adapted to interrupt and silence a group of casters.

Ordinary character rewards show 3 choices drawn from hero passives, improvements to learned spells and shared improvements. A useful passive option is ensured. Every fifth character level instead shows 3 new-spell choices. Full slots permit explicit replacement at that learning milestone; keeping the existing spells is allowed. Replacement resets the old spell's individual progress and Super Upgrades while shared progress remains.

Spells use individual damage/potency, area, cast speed and useful duration improvements rather than the old displayed spell-level progression. Chain Lightning uses additional targets instead of area. Useful-upgrade eligibility removes capped or redundant improvements. Legacy rank fields still exist internally and in migrations.

Equipment raises a spell's **effective rank**, an adaptation that revives native rank scaling. Generated jewelry, talismans and spellbooks can roll +1 to +3 levels to one spell, favouring learned spells. Caster weapons can roll levels to their granted spell. Jewelry and spellbooks can also roll Magery or Evaluating Intelligence from RunUO's 1–15 skill-bonus range, and fixed uniques with those skills now count too. Effective rank is `learned + min(3, item levels for that spell) + min(3, school points / 10)`, capped at 8. Each rank adds 25% of rank-1 potency and 6.5% shorter cooldown, plus rank-based duration and radius. The stored learned rank never changes. Combat, previews, the HUD inspector, upgrade eligibility and the stats screen read the same helper, and unequipping recomputes. Weapon autocasts receive it as a general bonus. Source: [spell levels](../game/spell-levels.mjs).

| Rarity | Individual spell or hero | Shared | Additional chain targets |
| --- | --- | --- | --- |
| Common | 5% | 5% | 1 |
| Uncommon | 10% | 10% | 2 |
| Rare | 15% | 15% | 3 |
| Epic | 25% | 20% | 5 |
| Legendary | 50% | 25% | 10 |

Each fifth successful individual spell improvement queues a separate Super Upgrade with 2 choices. Depending on the spell, choices include +50% cast speed with -20% potency, +60% potency with -20% cast speed, or an additional projectile/field/summon with -20% potency. Chain Lightning's extra-count Super adds 2 targets. Applicability and caps determine which options appear. Global and hero purchases do not advance an individual spell's milestone.

Luck improves equipment and upgrade rarity; it does not grant extra equipment-chest occurrences. Upgrade rarity uses the clamped quality multiplier `min(6, 1 + luck / 1000)` for nonnegative luck. Shop prices multiply the base cost by 1/1.5/2/3/4 for Common through Legendary. Successful upgrade purchases refresh the five shop offers; the shop remains open for further purchases, inventory and item trading until Next Area.

If an ordinary level has no legal choice, it converts to 10 gold instead of opening an empty menu, and an empty menu cannot be rerolled. Repeatable hero passives make this a defensive fallback rather than a common path.

Sources: [spell catalog and behavior](../game/spell-system.mjs), [upgrade formulas and rarity](../game/spell-upgrades.mjs), [choice grouping](../game/choice-draw.mjs), [level progression](../game/core.mjs), [shop and modal flow](../game/app.mjs), [shop transactions](../game/zone-run.mjs).

## Zones and rewards

Easy selects 20 areas, Normal 35, and Hard all available areas, currently 73. Selection shuffles within up to 8 source-threat brackets. Route normalization establishes increasing median HP, damage and XP targets despite local roster variation. Gold scaling increases with area index. Local species retain their source identity and relative stats.

The first ordinary zone has a 120-second guardian timer and 30-second horde schedule. Initial hordes roll 25–50 ordinary creatures; later areas and later waves increase those ranges. Boss timing grows in 30-second increments toward 180 seconds on Easy, 210 on Normal and 240 on Hard. Areas without ordinary wave candidates use an immediate boss schedule.

Every scheduled wave has a local champion, including the boss wave and subsequent reinforcements. Failed champion placements stay queued. There is no enemy population cap. Spawns use legal on-screen positions with body clearance. Within-area elapsed pressure increases HP for newly spawned enemies and increases attack damage and speed; pressure also continues during the guardian fight.

Every new creature has a 0.8-second arrival with a visible effect and fade-in. During it, the creature cannot move, make contact, cast or take damage, and targeting, chains and projectiles skip it. On-screen spawns therefore never hit on their first frame. The remaining arrival time is saved.

Guardian promotion applies 7.5 times HP and 2.5 times damage to the selected source-scaled creature. These factors coexist with difficulty, route and applicable pressure scaling; they are not total multipliers from raw native stats. A guardian also appears with local escorts.

Guardian death opens the moongate immediately for 30 active seconds. Enemies and drops remain. Escape hordes begin after 10 seconds, then arrive faster toward a minimum 4-second interval and gain strength. Missing the gate ends the run. Pauses and reward menus freeze active simulation. Entering the gate clears combat and opens the safe upgrade shop; Next Area advances, or wins after the final area.

Only bosses and champions drop equipment chests, with a guaranteed chest per kill. Walking over a chest opens it automatically subject to floor and reach/visibility rules; double-click also works. Ordinary enemies supply XP and probabilistic gold/healing/power-up rewards. Current ordinary drop chances are 12% gold, 4% healing, and 0.4% temporary power-up. Luck modifies quality independently.

Deposits provide four mining strikes, each requiring 3 stationary seconds within 66 world units. Each strike gives zone-scaled gold, and the fourth depletes the deposit. Deposits use reachable walking floors and preserve remaining contents in saves.

Gold find is a separate adaptation stat, independent of Luck. It rolls 5–40% on worn non-weapon families, caps at +100%, and multiplies creature gold and ore strikes. Autosell income is unaffected.

Active runs autosave every 2 seconds of active play, when the tab is hidden, on pause and on page hide. Camp import/export of the profile and active run is unchanged.

Native map pieces preserve terrain, statics, heights and local scenery. Compact crops were reviewed in 0.9.19: 9 gained reachable surroundings, including Vinculum Inn increasing from 842 to 10,689 tiles. Twelve crops were widened; 3 physically enclosed sections gained no additional reachable cells. Saved map origins allow actors and world objects to retain their native positions after expansion.

Sources: [route normalization](../game/zone-progression.mjs), [wave plans](../game/zone-pacing.mjs), [zone state machine](../game/zone-run.mjs), [source creature stats](../game/monster-stats.mjs), [drop rules](../game/reward-rules.mjs), [mining](../game/mining.mjs), [native map and save relocation](../game/location-map.mjs).

## Reproduce balance checks

From the repository root with runtime data and native area assets available:

```sh
node tools/test-ci.mjs
node tools/simulate-balance.mjs --terrain=native --seeds=712,42 --seconds=360 --areas=2 --output=research/balance/new-campaign
node tools/simulate-balance.mjs --mode=stress --difficulties=normal --builds=defense --motions=stand,kite --checkpoints=5,10,20 --seconds=360 --output=research/balance/new-stress
node tools/simulate-balance.mjs --mode=navigation --seconds=35 --wall-seconds=8 --output=research/balance/new-navigation
```

The default simulator mode earns campaign XP, loot and purchases. It uses simple local movement and item/choice scoring, omits mining and abstracts travel through the exit after a clear. Stress mode deliberately grants a synthetic checkpoint budget; it is not an earned save. Navigation mode tests sampled native pursuit and records recoveries. JSON/CSV output records hashes, policies, seeds, outcomes and timing. Check [simulator options and policies](../tools/simulate-balance.mjs) and [telemetry accounting](../tools/balance-telemetry.mjs) before interpreting a result.

The 0.9.18 balance experiments exposed weak-enemy contact shielding, excessive passive recovery/leech, ranger coverage weaknesses and corner navigation failures. Fixes preserved the class resistance formula. Controlled defense stress clears changed from 6/9 to 1/9 for stationary builds and from 7/9 to 9/9 for moving builds. That result tests a specific generous synthetic allocation; it does not establish human win rates. Full earned 20/35/73-area campaign balance remains unproven, and simple bots struggled in opening native areas. The 0.9.19 map expansion changes geometry, so the older navigation and campaign results are historical rather than fresh coverage of the expanded maps.

In the private development checkout, detailed evidence is available in `research/balance/index.html`, `research/balance/summary.json`, `research/zone-height-audit.json` and `research/zone-expansion-audit.json`. Research is intentionally excluded from the public export. The portable guide, this profile, runtime code and simulation tools are included in the public source export.
