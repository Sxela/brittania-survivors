# Britannia Survivors mechanics reference

This profile records the implementation at 0.9.19. It accompanies the [reusable porting guide](game-to-survivors-mechanics.md). These settings are adaptations for this game, not claims about vanilla Ultima Online or prescribed values for another port.

The [Britannia playtesting case study](britannia-playtesting-and-balance-log.md) explains which observations and experiments motivated these settings, including historical decisions that were later superseded. The [general playtesting workflow](playtesting-and-balance-log.md) is reusable in other games.

## Mobile controls

The experience bar spans the top of the battlefield without a text row. Player
health, level, gold and kills share one compact panel with the encounter timeline;
the separate run/area text panel is removed. Pause sits at bottom right, and
portrait layouts use a compact minimap (92?128 CSS pixels wide). The zone name appears in
the center for two seconds when a journey starts or the player enters a new zone.
`tests/hud-layout.browser.cjs` checks real extracted-asset layouts at desktop and
phone sizes, including title expiry; screenshots go to `.cache/hud-layout/`.

Options provides a continuous World zoom slider from 50% to 200% on desktop and mobile, saved between page loads. The player camera centers in the usable battlefield below the bottom of the player/minimap HUD, and clicks, spawns and edge guides share that origin. Touch controls default to tap-to-move and hold-to-steer. Joystick settings are
also available in narrow portrait desktop windows (up to 760 pixels wide),
without touch hardware or a forced mobile URL. In Options, enable
**Thumb joystick** for an optional transparent fixed joystick. Adjust its size
from 75% to 200% and its horizontal/vertical position with the sliders and preview.
Settings persist on the device independently of run saves and world zoom. Position
is relative to the available game view, keeping the entire control inside the
screen when rotating. Reset joystick restores the default position/size and turns
it off. Releasing or cancelling the thumb, opening a menu, or leaving the app
stops steering. Other fingers can use the teleport button while steering.

`tests/thumb-joystick.browser.cjs` checks emulated touch input, pointer ownership,
cancellation, reload persistence and phone portrait/landscape layouts. Screenshots
are saved under `.cache/thumb-joystick/`. This is not physical-device validation.

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

Luck improves equipment and upgrade rarity; it does not grant extra equipment-chest occurrences. Upgrade rarity uses the clamped quality multiplier `min(6, 1 + luck / 1000)` for nonnegative luck. Shop prices multiply the base cost by 1/1.5/2/3/4 for Common through Legendary. The shop shows five offers sorted by rarity, rarest first. Buying marks that slot Purchased without moving or rerolling the other cards. All five purchases generate a fresh batch; a paid manual reroll can replace the batch earlier. Sold flags and positions persist across saves. The equipment trader follows the same five-slot batch rule. Backpack items also display rarest first.

If an ordinary level has no legal choice, it converts to 10 gold instead of opening an empty menu, and an empty menu cannot be rerolled. Repeatable hero passives make this a defensive fallback rather than a common path.

Sources: [spell catalog and behavior](../game/spell-system.mjs), [upgrade formulas and rarity](../game/spell-upgrades.mjs), [choice grouping](../game/choice-draw.mjs), [level progression](../game/core.mjs), [shop and modal flow](../game/app.mjs), [shop transactions](../game/zone-run.mjs).

## Zones and rewards

Easy selects 20 areas, Normal 35, and Hard all available areas, currently 73. Selection shuffles within up to 8 source-threat brackets. Route normalization establishes increasing median HP, damage and XP targets despite local roster variation. Gold scaling increases with area index. Local species retain their source identity and relative stats.

The first ordinary zone has a 120-second guardian timer and 30-second horde schedule. Initial hordes roll 25–50 ordinary creatures; later areas and later waves increase those ranges. Boss timing grows in 30-second increments toward 180 seconds on Easy, 210 on Normal and 240 on Hard. Areas without ordinary wave candidates use an immediate boss schedule.

Every scheduled wave has a local champion, including the boss wave and subsequent reinforcements. Failed champion placements stay queued. There is no enemy population cap. Spawns use legal on-screen positions with body clearance. Within-area elapsed pressure increases HP for newly spawned enemies and increases attack damage and speed; pressure also continues during the guardian fight.

Every new creature has a 0.8-second arrival with a visible effect and fade-in. During it, the creature cannot move, make contact, cast or take damage, and targeting, chains and projectiles skip it. On-screen spawns therefore never hit on their first frame. The remaining arrival time is saved.

Guardian promotion applies 7.5 times HP and 2.5 times damage to the selected source-scaled creature. These factors coexist with difficulty, route and applicable pressure scaling; they are not total multipliers from raw native stats. A guardian also appears with local escorts.

Guardian death opens the moongate immediately for 30 active seconds. Enemies and drops remain. Escape hordes begin after 10 seconds, then arrive faster toward a minimum 4-second interval and gain strength. Missing the gate ends the run. Pauses and reward menus freeze active simulation. Entering the gate clears combat and opens the safe upgrade shop; Next Area advances, or wins after the final area.

Only bosses and champions drop equipment chests, with a guaranteed chest per kill. Standing on a chest's original game tile or any of its eight adjacent tiles opens it automatically, subject to floor and reach/visibility rules; double-click also works. Ordinary enemies supply XP and probabilistic gold/healing/power-up rewards. Current ordinary drop chances are 1.2% gold, 4% healing, and 0.4% temporary power-up. Luck modifies quality independently.

Gold ore spawns in reachable clusters. Each rock has 1 HP and takes one three-second strike while the player stays on its original tile or an adjacent tile, including while moving. Mining bonuses speed the strike and increase yield; progress and contents persist in saves. The ore budget compensates for reduced ordinary monster gold.

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


## Permanent account shop and insured wardrobe

Main Menu ? Upgrades opens the native backpack/paperdoll UI.
The Wardrobe tab has a separate saved outfit for Magician, Warrior and Ranger,
with one shared insured-item backpack. Equipping a shared item on a different
character removes its assignment from the previous outfit; it never duplicates
an owned item. Ordinary run gear is separate. Insured equipment is excluded from
autosell; deliberately selling/discarding it removes ownership. New equipment
chests roll a 4% chance for their item to be insured. The property appears on
items and in their details. Only picked-up items enter account ownership.

The Upgrades tab sells global damage, health, movement, attack/cast speed,
resistance, pickup, regeneration, spell area/duration and gold-income bonuses.
Each rank adds 5% of the relevant base (regeneration adds 0.5% of base health per
second). Starting purse and Luck each add 5 points per rank, using a 100-point
reference base. There are no specific-spell purchases. Ranks cap at 10; a rank
costs 20 + 10 ? current rank gold ingots. Bonuses apply to future new runs and
are stored independently of session legacy, ordinary gold, and run saves.

Only bosses and champion/captain leaders can drop gold ingots. Boss chance is
30%, paying 2?10 ingots; champion chance is 12%, paying 2?4. Ordinary mobs and
escorts never roll them. A boss payout funds 10?50% of a first-rank upgrade;
clearances can yield no ingots, and several leader drops can yield more. These
are authored starting balance values, not measured human campaign reward rates.
Ingots are collected like gold and shown with native gold-bar artwork in the HUD,
pickup feed and account wallet. They survive death. Per-run receipts prevent
repeat credits after autosave/reload. Starting gold is granted once at new-run
creation, never on reopening camp or restoring a save.

Death removes the resumable run, preserves account upgrades/ingots/insured gear,
and clears ordinary carried gold, uninsured gear and session legacy. Continue,
new-run restore and save import reject dead/zero-health or recorded finished runs.
Old profiles migrate with an empty account without changing existing run gear.

## Paralysis balance

Paralyze is an area spell with a base radius of 100 world pixels, scaling with
area upgrades. Duration is min(3, (1.5 + 0.25 ? rank) ? duration multiplier) seconds,
with a 0.75-second boss cap. Damage breaks direct paralysis. A target resists
further paralysis until 2.5 seconds after its original expiry; cast cooldown
cannot fall below 5 seconds.

Paralyze Field is passable to both sides. It lasts min(4, (2 + 0.15 ? rank) ?
duration multiplier) seconds and freezes a crossing normal monster until the
field expires. Boss freeze caps at 1 second. Damage does not break field freeze.
Targets resist overlapping/repeated paralysis until 3 seconds after that field
expires; field cooldown has an 8-second minimum. Frozen enemies cannot move,
start/complete targeted casts or deal contact damage. The duration/cooldown caps
bound single-field control uptime to 50% for ordinary enemies and 12.5% for bosses;
these analytical limits and regression tests do not replace human balance trials.

Validation: `tests/account-progression.test.mjs` and
`tests/fixed-shop-and-paralysis.test.mjs` cover economy isolation, idempotent
credits, account save migration, insured gear transfer, bounded crowd control,
adjacent-tile collection and fixed shop batches. With extracted assets,
`tests/account-shop.browser.cjs` verifies the real SPA on desktop and an emulated
phone, including purchase/transfer/death/reload and screenshots under
`.cache/account-shop/`.


Wall of Stone is retired from learning, shops and active gameplay. Native source
identity/artwork remains documented. Old saved Wall of Stone ranks and upgrades
migrate to an available offensive spell (preferably Paralyze Field); pending
milestones migrate with it, and active stone walls are removed. Existing item
bonuses and insured account gear migrate to supported spell bonuses without
changing item ownership. `tests/retired-stone-wall.test.mjs` checks migration.
