import {buildZonePacing} from './zone-pacing.mjs';
import {canOpenLootChest} from './loot-chests.mjs';
import {tickGoldOre,validGoldOre} from './mining.mjs';
import {damageChannel,combatResistances,damageDistribution,damageIncrease,itemResistances,itemResistanceParts,classChannelBases,classPercent,damageBonusParts,combatAffixRules,elementalAreaTypes} from './combat-types.mjs';
import {applyWeaponIdentity,WEAPON_TRAITS} from './weapon-traits.mjs';
import {decorateUpgrade,normalizeUpgradeOffer,UPGRADE_RARITIES,globalSpellChoices,applyGlobalUpgrade,GLOBAL_SPELL_UPGRADES,HERO_UPGRADE_IDS} from './spell-upgrades.mjs';
import {mixedChoiceDraw} from './choice-draw.mjs';
import {rollSpellPower,withGoldFind,validSpellLevels} from './spell-levels.mjs';
import {difficultyAreaCount,chooseProgressiveRoute,buildZoneProgression} from './zone-progression.mjs';
import { EQUIPMENT_SLOTS, activeProperty, hasGameplayStats, aosFamily, lootSourceEligible, attributesOf, artifactItem, itemScore, sourceProperties, rollAosProperty } from "./equipment.mjs";
import { DIFFICULTIES, POWERUPS, strictlyDominates } from "./general-mechanics.mjs";
import { SPELLS, MAGERY_BOOK, RETIRED_SPELLS, spellImpact, initSpellState, spellChoices, newSpellChoices, chooseSpell, applySpellOffer, tickSpellSystem, passiveIcon, spellResistanceBonus, validSpellState,tryReflectSpell,spellBlocksMovement,spellMovementMultiplier,spellDamageBonus,spellEnemyMovementMultiplier,spellEnemyDamageMultiplier,spellInvisible } from "./spell-system.mjs";
import { initMonsterBehavior, tickMonsterBehavior, applyMonsterContact, tickMonsterStatus,monsterProfile,enemyCasterSpawnAllowed,tickEnemyCasts } from "./monster-behavior.mjs";
import { dropsLootChest, POWERUP_DROP_CHANCE, HEAL_DROP_CHANCE, GOLD_DROP_CHANCE, ORDINARY_GOLD_RETAINED, monsterGoldBase, bossSchedule, championSchedule, lootRarity, lootLeader } from './reward-rules.mjs';
import {nativeMonsterStats,waveCreature,bossAvailable} from './monster-stats.mjs';
import {generateEnemyEquipment,isEquipmentBody} from './enemy-equipment.mjs';
import {chooseAreaRoute,areaForTime} from './area-route.mjs';
import {createZoneRun,migrateZonePacing,initWaveChampions,applyZonePressure,zoneUpgradePrice,zoneProgress,zoneCombatTime,tickZoneRun,zoneEnemyKilled,rollZoneSpells,rerollZoneSpells,buyZoneSpell,finishZoneSpellShop,advanceZone,validZoneState} from './zone-run.mjs';
// The simulation deliberately has no browser or rendering dependencies.
const TAU = Math.PI * 2;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const copy = (value) => JSON.parse(JSON.stringify(value));
// On-screen spawns materialize first: no movement, contact, casting or damage
// in either direction until the arrival effect finishes.
export const ENEMY_ARRIVAL_SECONDS=.8;
// Unit tests that predate arrival can opt out per test file.
export const MASTERED_LEVEL_GOLD=10;
export const GAME_DEFAULTS={enemyArrival:ENEMY_ARRIVAL_SECONDS};
const FALLBACK_MONSTER = {
  id: "mongbat",
  name: "Mongbat",
  body: 39,
  adaptation: {
    tier: 1,
    hp: 24,
    speed: 47,
    damage: 7,
    xp: 5,
    radius: 13,
    color: "#a29571",
  },
};
const UPGRADES = [
  {
    id: "power",
    name: "Evaluating Intelligence",
    description: "Damage bonus +5% of your class base.",
  },
  { id: "haste", name: "Faster Casting", description: "Basic attack speed +5% of base." },
  {
    id: "vitality",
    name: "Anatomy",
    description: "Maximum health +5% of base; heal the added health.",
  },
  { id: "speed", name: "Ninjitsu", description: "Movement speed +5% of base." },
  {
    id: "magnet",
    name: "Spirit Speak",
    description: "Pickup radius +5% of base.",
  },
  {
    id: "nova",
    name: "Meteor Swarm",
    description: "Periodically blast surrounding creatures.",
  },
  {
    id: "chain",
    name: "Chain Lightning",
    description: "Lightning jumps between nearby creatures.",
  },
  {
    id: "multishot",
    name: "Double Strike",
    description: "Additional basic projectiles +5% of base.",
  },
  {
    id: "regen",
    name: "Healing",
    description: "Regenerate 5% of base health per 10 seconds.",
  },
  {
    id: "armor",
    name: "Resisting Spells",
    description: "Resistance +5% of your class base.",
  },
];

export class Game {
  constructor(
    catalog = {},
    { seed = 1, archetype = "mage", duration = 600, difficulty = "normal", autoequip = true, legacyBonuses = {}, enemyArrival = GAME_DEFAULTS.enemyArrival } = {},
  ) {
    Object.defineProperty(this, "audioEvents", { value: [], enumerable: false });
    Object.defineProperty(this, "isPassable", { value: null, writable:true, enumerable:false });
    Object.defineProperty(this, "nearestPassable", { value: null, writable:true, enumerable:false });
    for(const hook of ['enemyWaypoint','blockedActor','clearSight','areaAt','spawnLocation','elevationAt','canTraverse'])Object.defineProperty(this,hook,{value:null,writable:true,enumerable:false});
    Object.defineProperty(this,"lootEvents",{value:[],enumerable:false});
    Object.defineProperty(this,"enemyArrival",{value:Math.max(0,Math.min(5,Number(enemyArrival)||0)),writable:true,enumerable:false});
    this.catalog = catalog;
    this.seed = Number(seed) >>> 0 || 1;
    this.rng = this.seed;
    this.archetype = archetype;
    this.duration = Math.max(10, Number(duration) || 600);
    this.difficulty=Object.hasOwn(DIFFICULTIES,difficulty)?difficulty:'normal';
    this.routeVersion=catalog.zoneMode?2:1;
    this.areaRoute = catalog.zoneMode ? chooseProgressiveRoute(catalog.areas||[],catalog.areaCount||difficultyAreaCount(catalog.areas||[],this.difficulty),this.seed) : chooseAreaRoute(catalog.areas || [], catalog.areaCount || 6, this.seed);
    for (const area of this.areaRoute) {
      const source = catalog.areas.find(candidate=>candidate.id===area.id);
      area.sourceCoverage = {missingClasses:source.combatClasses.filter(name=>!(catalog.monsters||[]).some(monster=>monster.className===name||monster.sourceName===name))};
    }
    this.zoneRun = catalog.zoneMode === true && this.areaRoute.length ? createZoneRun(this) : null;
    this.zoneSpellOffers = [];
    this.levelRerolls = 0;
    this.oreAreaKey=null;
    this.globalSpellUpgrades={};
    this.spellLearningVersion=2;
    this.time = 0;
    this.status = "playing";
    this.kills = 0;
    this.nextId = 1;
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.effects = [];
    this.inventory = [];
    this.equipment = Object.fromEntries([...new Set([...EQUIPMENT_SLOTS,...(catalog.equipmentSlots||[]).map(s=>s.id)])].map(slot=>[slot,null]));
    this.gearVersion=2;
    this.starterClothingVersion=1;
    this.gearHpBonus=0;
    this.autosell="inferior";
    this.autoequip=!!autoequip;
    this.difficulty=Object.hasOwn(DIFFICULTIES,difficulty)?difficulty:"normal";
    this.legacyBonuses=Object.fromEntries(["power","vitality","magnet"].map(id=>[id,Math.max(0,Math.min(5,Math.floor(Number(legacyBonuses[id])||0)))]));
    this.buffs={};
    this.encounterVersion=1;
    this.monsterStatsVersion=1;
    this.pendingEnemyCasts=[];
    this.enemyGlobalCastClock=0;
    this.championMarks=[];
    this.shopRestocks=0;
    this.corpses=[];
    this.choices = [];
    this.shop = [];
    this.upgrades = {};
    this.heroStatUpgrades = {};
    this.weapons = [];
    this.bossesSpawned = [];
    this.bossesKilled = 0;
    this.finalBossSpawned = false;
    this.spawnClock = 0.5;
    this.attackClock = 0.15;
    this.weaponSpellClock=0;
    this.weaponIdentityVersion=1;
    this.novaClock = 3;
    this.chainClock = 2;
    this.shopClock = 45;
    this.hitClock = 0;
    this.regenDelay=0;
    this.lifeLeechClock=0;
    this.dashTime = 0;
    this.dashDirection = { x: 1, y: 0 };
    this.viewport = { width: 960, height: 600 };
    this.lastDirection = { x: 1, y: 0 };
    const role =
      (catalog.archetypes || []).find(
        (a) => a.id === (archetype === "mage" ? "magician" : archetype),
      ) || {};
    const roleDesign = role.adaptation || role;
    this.player = {
      x: 0,
      y: 0,
      dx: 1,
      dy: 0,
      dashCooldown: 0,
      hp: 110,
      maxHp: 110,
      speed: 150,
      level: 1,
      xp: 0,
      nextXp: 18,
      gold: 0,
      armor: 0,
      radius: 14,
      color: roleDesign.color || "#78d2ed",
      archetype,
      name: role.name || archetype,
    };
    this.attackKind = /arch|ranger|bow/i.test(archetype)
      ? "arrow"
      : /warrior|knight|paladin|fighter|samurai|melee|blacksmith|ninja/i.test(
            archetype,
          )
        ? "melee"
        : "magic";
    if (this.attackKind === "melee") {
      this.player.maxHp = this.player.hp = 150;
      this.player.armor = 2;
    }
    this.player.maxHp+=this.legacyBonuses.vitality*10;this.player.hp=this.player.maxHp;
    if (this.attackKind === "arrow") this.player.speed = 165;
    const weapon = (this.attackKind==='magic'?(catalog.weapons||[]).find(w=>w.id==='fireball-wand')|| (catalog.items||[]).find(w=>w.id==='fireball-wand'):null)||
      (catalog.weapons || []).find(
        (w) => w.id === roleDesign.weapon || w.name === roleDesign.weapon,
      ) ||
      (catalog.weapons || []).find((w) =>
        this.attackKind === "arrow"
          ? /bow/i.test(w.name)
          : this.attackKind === "melee"
            ? /sword|katana|axe/i.test(w.name)
            : /staff|wand/i.test(w.name),
      );
    if (weapon) {
      this.inventory.push(this.makeItem(weapon, "weapon", 0));
      this.equipment.weapon = this.inventory[0].uid;
    }
    this.ensureStarterClothing();
    this.refreshWeapons();
    initSpellState(this);
    this.refreshShop();
    // This opening group is part of the initial world, visible before play starts.
    // Later waves always enter from beyond the viewport.
    if(this.zoneRun)return;
    const waveMonsters = this.areaMonsters().filter(
      monster=>waveCreature(monster)&&enemyCasterSpawnAllowed(monster,0),
    );
    const monsters = waveMonsters.length ? waveMonsters : this.areaRoute.length ? [] : [FALLBACK_MONSTER];
    const weakestTier = Math.min(
      ...monsters.map((monster) => monster.adaptation?.tier ?? 1),
    );
    const openingTypes = monsters.filter(
      (monster) => (monster.adaptation?.tier ?? 1) === weakestTier,
    );
    const openingAngle = this.random() * TAU;
    for (let i = 0; i < 3; i++) {
      const enemy = this.spawnEnemy(openingTypes.length ? this.pick(openingTypes) : null);
      if (!enemy) continue;
      const angle = openingAngle + (i * TAU) / 3 + (this.random() - 0.5) * 0.25;
      const radius = 220 + this.random() * 100;
      enemy.x = Math.cos(angle) * radius;
      enemy.y = Math.sin(angle) * radius;
    }
  }

  random() {
    let t = (this.rng += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.rng >>>= 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  audioCue(role, source = this.player) {
    if (this.audioEvents.length >= 128) this.audioEvents.shift();
    this.audioEvents.push({ role, x: source.x, y: source.y });
  }

  drainAudioEvents() { return this.audioEvents.splice(0); }

  pick(list) {
    return list[Math.floor(this.random() * list.length)];
  }
  equipped(slot) {
    return this.inventory.find((item) => item.uid === this.equipment[slot]);
  }
  get wornItems() { return Object.values(this.equipment).map(uid=>this.inventory.find(i=>i.uid===uid)).filter(Boolean); }
  get aosBonuses() {
    const total={};for(const item of this.wornItems)for(const [key,value]of Object.entries(attributesOf(item)))total[key]=(total[key]||0)+value;
    return total;
  }
  get baseMaxHp(){return (this.attackKind==='melee'?150:110)+this.legacyBonuses.vitality*10;}
  get baseRegeneration(){return this.baseMaxHp/10*this.heroUpgradeBonus('regen')+(this.aosBonuses.RegenHits||0)/10;}
  get regeneration(){return this.regenDelay>1e-8?Math.min(this.baseRegeneration*.25,this.baseMaxHp*.01):this.baseRegeneration;}
  get baseDamage(){return (this.attackKind==='melee'?28:this.attackKind==='arrow'?23:25)+(this.equipped('weapon')?.power||0);}
  heroUpgradeBonus(id){
    if(Object.hasOwn(this.heroStatUpgrades||{},id))return this.heroStatUpgrades[id];
    const n=this.upgrades[id]||0;
    return id==='power'?n*.2:id==='haste'?Math.pow(.88,-n)-1:id==='speed'?Math.pow(1.1,n)-1:id==='magnet'?n*65/90:id==='regen'?n/(this.baseMaxHp/10):id==='vitality'?n*25/this.baseMaxHp:id==='multishot'?(this.attackKind==='melee'?n*12/92:n):0;
  }
  get spellDamageAddition(){return this.legacyBonuses.power*.04+spellDamageBonus(this,false);}
  channelDamageBuff(channel){return this.legacyBonuses.power*.04+spellDamageBonus(this,channel==='Physical');}
  damageBonus(channel){return damageBonusParts(this,channel);}
  get weaponSpell(){const weapon=this.equipped('weapon');return weapon?.grantedSpell?{id:weapon.grantedSpell,rank:1,cooldown:this.weaponSpellClock,active:false,weaponGranted:true}:null;}
  get damage() {
    return this.baseDamage;
  }
  get attackInterval() {
    const b=this.aosBonuses,weapon=this.equipped('weapon');
    let base=this.attackKind==='melee'?.8:.75;
    if(weapon?.aosMode&&this.attackKind!=='magic') {
      const speed=weapon.stats.AosSpeed||weapon.stats.Speed||35;
      const v=200*speed*(1+(b.WeaponSpeed||0)/100+(this.attackKind==='arrow'?.5:0));
      base=Math.max(1.25,Math.floor(40000/Math.max(1,v))*.5)*.5;
    } else if(this.attackKind==='magic') base/=1+Math.min(6,b.CastSpeed||0)*.1+Math.min(6,b.CastRecovery||0)*.025;
    if(this.attackKind==='magic')base/=1+(b.WeaponSpeed||0)/100;
    return Math.max(.16,base/(1+this.heroUpgradeBonus('haste')+(this.buffs.haste?.remaining>0?1/.72-1:0)));
  }
  get armor() { return this.player.armor+this.wornItems.filter(i=>!i.aosMode).reduce((sum,i)=>sum+(i.defense||0),0); }
  get resistances() {
    return Object.fromEntries(['Physical','Elemental'].map(channel=>[channel,this.resistanceBonus(channel).total]));
  }
  resistanceBonus(channel){
    const base=classChannelBases(this)[channel];let flat=0,items=0;
    for(const item of this.wornItems){const parts=itemResistanceParts(item);flat+=parts.flat[channel];items+=parts.bonus[channel];}
    const passive=this.heroUpgradeBonus('armor')*100,wards=spellResistanceBonus(this,channel);
    return {base,flat,items,passive,wards,total:classPercent(base,items+passive+wards,flat,70)};
  }
  refreshEquipmentStats() {
    const b=this.aosBonuses,next=b.BonusHits||0;
    this.player.maxHp=Math.max(1,this.player.maxHp+next-(this.gearHpBonus||0));this.gearHpBonus=next;
    this.player.hp=Math.min(this.player.hp,this.player.maxHp);
  }
  ensureStarterClothing() {
    if(!this.catalog.items?.length)return;
    const wanted={shirt:'shirt',pants:this.attackKind==='magic'?'short-pants':'long-pants',feet:this.attackKind==='magic'?'sandals':'boots'};
    for(const [slot,id]of Object.entries(wanted)){
      if(this.equipment[slot])continue;
      const source=this.catalog.items.find(i=>i.id===id)||this.catalog.items.find(i=>i.slot===slot&&!artifactItem(i));
      if(source){const item=this.makeItem(source,source.slot,0);this.inventory.push(item);this.equipment[item.slot]=item.uid;}
    }
    this.refreshEquipmentStats();
  }
  notifyLoot(event) {
    this.lootEvents.push(event);if(this.lootEvents.length>64)this.lootEvents.shift();
    const kind=event.kind;if(!['gold','autosell','item','heal','powerup','xp'].includes(kind))return;
    const currency=kind==='gold'||kind==='autosell',key=currency?'gold':kind;
    const recent=this.effects.findLast(e=>e.kind==='reward-text'&&e.rewardKind===key&&e.life>1.05&&Math.hypot(e.x-this.player.x,e.y-this.player.y)<40);
    const value=Number(event.value)||0;
    if(recent&&(currency||kind==='xp')){recent.value+=value;recent.text=`+${recent.value} ${currency?'gold':'XP'}`;return;}
    const text=currency?`+${value} gold`:kind==='xp'?`+${value} XP`:kind==='heal'?`+${value} health`:kind==='item'?event.item.name:event.text;
    const rewards=this.effects.filter(e=>e.kind==='reward-text');if(rewards.length>=8)this.effects.splice(this.effects.indexOf(rewards[0]),1);
    this.effects.push({kind:'reward-text',rewardKind:key,text:String(text).slice(0,60),value,x:this.player.x,y:this.player.y,z:this.elevationAt?.(this.player.x,this.player.y,this.time)??0,radius:0,color:currency?'#ffe17c':kind==='heal'?'#a8eaa3':kind==='xp'?'#b4e6ff':'#fff1c6',lane:rewards.length%3,life:1.2,maxLife:1.2});
  }
  drainLootEvents() { return this.lootEvents.splice(0); }

  get difficultySettings() { return DIFFICULTIES[this.difficulty]||DIFFICULTIES.normal; }
  get activeBuffs() { return Object.entries(this.buffs).filter(([,b])=>b.remaining>0).map(([id,b])=>({id,...b})); }
  get restockPrice() { return 15+this.shopRestocks*5; }
  restockShop() {
    if(["dead","victory"].includes(this.status)||this.player.gold<this.restockPrice)return false;
    this.player.gold-=this.restockPrice;this.shopRestocks++;this.refreshShop();this.audioCue('gold');return true;
  }
  canAutoequip(item) {
    if(!(item.slot in this.equipment)||(this.player.sex==='female'?item.allowFemale===false:item.allowMale===false))return false;
    if(item.slot==='weapon'&&item.twoHanded&&this.equipped('offhand'))return false;
    if(item.slot==='offhand'&&this.equipped('weapon')?.twoHanded)return false;
    if(this.wornItems.some(w=>w.slot!==item.slot&&item.serverLayer&&w.serverLayer===item.serverLayer))return false;
    const current=this.equipped(item.slot);
    // Outer robes conceal the rest of the outfit; wearing one is a manual choice.
    if(item.slot==='robe'&&!current)return false;
    return !current||strictlyDominates(item,current);
  }
  autoEquipInventory() {
    let equipped=0;
    if(this.autoequip)for(const item of [...this.inventory])if(this.equipment[item.slot]!==item.uid&&this.canAutoequip(item)&&this.equip(this.inventory.findIndex(i=>i.uid===item.uid)))equipped++;
    this.cleanupInventory();return equipped;
  }
  acquireItem(item) {
    this.inventory.push(item);this.notifyLoot({kind:'item',item,text:item.name});
    if(this.autoequip&&this.canAutoequip(item))this.equip(this.inventory.length-1);
    this.cleanupInventory();return item;
  }
  cleanupInventory() {
    if(this.autosell==='off')return 0;
    const worn=new Set(Object.values(this.equipment)),candidates=[...this.inventory];let sold=0;
    for(const item of candidates){
      if(worn.has(item.uid)||item.artifact||item.predefined)continue;
      const common=this.autosell==='common'&&(item.rarity==='normal'||!item.rarity);
      const inferior=this.autosell==='inferior'&&this.inventory.some(other=>other.uid!==item.uid&&strictlyDominates(other,item));
      if(!common&&!inferior)continue;
      const index=this.inventory.findIndex(i=>i.uid===item.uid);if(index<0)continue;
      const gold=Math.max(1,Math.floor(item.price*.5));this.inventory.splice(index,1);this.player.gold+=gold;sold++;
      this.notifyLoot({kind:'autosell',item,text:`Auto-sold ${item.name}`,value:gold});this.audioCue('gold');
    }return sold;
  }

  setViewport(width, height) {
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      this.viewport = {
        width: Math.max(1, Math.min(10000, width)),
        height: Math.max(1, Math.min(10000, height)),
      };
    }
  }

  canStand(x,y,radius=0) {
    if(spellBlocksMovement(this,x,y,radius))return false;
    if(!this.isPassable)return true;
    return [[0,0],[-radius,0],[radius,0],[0,-radius],[0,radius]].every(([dx,dy])=>this.isPassable(x+dx,y+dy,this.time));
  }
  canWalk(from,x,y,radius=0) {
    return this.canStand(x,y,radius)&&(!from||!this.canTraverse||this.canTraverse(from,{x,y}));
  }
  moveActor(actor,dx,dy) {
    if(this.canWalk(actor,actor.x+dx,actor.y+dy,actor.radius*.5)){actor.x+=dx;actor.y+=dy;return;}
    const before={x:actor.x,y:actor.y};
    if(this.canWalk(actor,actor.x+dx,actor.y,actor.radius*.5))actor.x+=dx;
    if(this.canWalk(actor,actor.x,actor.y+dy,actor.radius*.5))actor.y+=dy;
    if(actor!==this.player&&Math.hypot(dx,dy)>0&&distance(before,actor)<Math.hypot(dx,dy)*.3)this.blockedActor?.(actor);
  }

  spawnPoint(radius = 14, margin = 0) {
    const angle = this.random() * TAU,
      x = Math.cos(angle),
      y = Math.sin(angle);
    const halfWidth = this.viewport.width / 2 + radius + 20 + margin;
    const halfHeight = this.viewport.height / 2 + radius + 20 + margin;
    const scale = Math.min(
      halfWidth / (Math.abs(x) || 1e-9),
      halfHeight / (Math.abs(y) || 1e-9),
    );
    const point={ x: this.player.x + x * scale, y: this.player.y + y * scale };
    if(this.isPassable&&!this.canStand(point.x,point.y,radius*.5)&&this.nearestPassable){
      const resolved=this.nearestPassable(point.x,point.y,this.time);
      if(resolved&&Number.isFinite(resolved.x)&&Number.isFinite(resolved.y))return resolved;
    }
    return point;
  }

  dash() {
    if (this.status !== "playing" || this.player.dashCooldown > 0) return false;
    const length = Math.hypot(this.lastDirection.x, this.lastDirection.y) || 1;
    const direction = {
      x: this.lastDirection.x / length,
      y: this.lastDirection.y / length,
    };
    // Jump over intervening obstacles, checking only the landing footprint.
    // Search back along the jump so an obstructed endpoint can land safely.
    let landing=null;
    for(let travel=820*.18;travel>=8;travel-=4){
      const x=this.player.x+direction.x*travel,y=this.player.y+direction.y*travel;
      if(this.canStand(x,y,this.player.radius)){landing={x,y};break;}
    }
    if(!landing||(!direction.x&&!direction.y))return false;
    this.dashDirection = direction;
    this.dashTime = 0.18;
    this.player.dashCooldown = 3;
    this.hitClock = Math.max(this.hitClock, 0.28);
    this.effect(this.player.x, this.player.y, 26, "#a4e5ed", "dash", 0.25);
    Object.assign(this.player,landing);
    this.effect(this.player.x, this.player.y, 26, "#a4e5ed", "dash", 0.25);
    this.audioCue("dash");
    return true;
  }

  refreshWeapons() {
    this.weapons = [
      {
        id: this.attackKind,
        name:
          this.attackKind === "melee"
            ? "Whirlwind Attack"
            : this.attackKind === "arrow"
              ? "Archery"
              : "Magic Arrow",
        level: 1 + (this.upgrades.multishot || 0),
        color: this.attackKind === "arrow" ? "#e6c890" : "#86dcff",
      },
    ];
    for (const id of ["nova", "chain"])
      if (this.upgrades[id])
        this.weapons.push({
          id,
          name: id === "nova" ? "Meteor Swarm" : "Chain Lightning",
          level: this.upgrades[id],
          color: id === "nova" ? "#ff9959" : "#c7a2ff",
        });
  }

  update(dt, input = {}) {
    if (this.status !== "playing" || this.pendingSpellSupers?.length || !Number.isFinite(dt) || dt <= 0) return;
    // Fixed-size substeps keep fast attacks and incoming damage stable on slow frames.
    let remaining = Math.min(dt, 1);
    while (remaining > 0.000001 && this.status === "playing"&&!this.pendingSpellSupers?.length) {
      const step = Math.min(remaining, 1 / 60);
      this.step(step, input);
      remaining -= step;
    }
  }

  step(dt, input) {
    this.time += dt;
    const p = this.player;
    for(const [id,buff]of Object.entries(this.buffs)){buff.remaining=Math.max(0,buff.remaining-dt);if(!buff.remaining)delete this.buffs[id];}
    const movementMultiplier=1+((this.buffs.haste?.remaining>0?.3:0)+spellMovementMultiplier(this)-1)*(this.attackKind==='arrow'?165:150)/p.speed;
    let x = Number.isFinite(input.x) ? input.x : 0,
      y = Number.isFinite(input.y) ? input.y : 0;
    const length = Math.hypot(x, y);
    if (length > 0) {
      x /= Math.max(1, length);
      y /= Math.max(1, length);
      this.moveActor(p,x*p.speed*movementMultiplier*dt,y*p.speed*movementMultiplier*dt);
      this.lastDirection = { x, y };
      p.dx = x;
      p.dy = y;
    }
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    if (this.dashTime > 0) {
      this.dashTime = Math.max(0, this.dashTime - dt);
    }
    this.regenDelay=Math.max(0,this.regenDelay-dt);
    this.lifeLeechClock=Math.max(0,this.lifeLeechClock-dt);
    p.hp = Math.min(p.maxHp, p.hp + this.regeneration * dt);
    if(!this.zoneRun)for(const corpse of this.corpses)corpse.life-=dt;
    this.corpses=this.corpses.filter(c=>c.life>0);
    this.hitClock = Math.max(0, this.hitClock - dt);
    tickSpellSystem(this,dt);tickMonsterStatus(this,dt);tickEnemyCasts(this,dt);
    if(this.zoneRun){tickZoneRun(this,dt);if(this.status==='dead')return;}
    else {
    this.spawnClock -= dt;
    if (this.spawnClock <= 0 && this.time < this.duration) {
      this.spawnClock += Math.max(
        0.13,
        (1.05 - (this.time / this.duration) * 0.8)/this.difficultySettings.population,
      );
      const count = 1 + Math.floor(this.time / 100);
      for (let i = 0; i < count && this.enemies.length < 180; i++)
        this.spawnEnemy();
    }
    for(const [index,mark] of championSchedule(this.duration).entries()){
      if(this.time<mark||this.championMarks.includes(mark))continue;
      this.championMarks.push(mark);
      if(this.time-mark>2||this.time>=this.duration-30||this.enemies.filter(e=>e.captain&&e.hp>0).length>=2)continue;
      this.spawnChampionEncounter(index);
    }
    const majors=bossSchedule(this.duration),finalAt=majors.at(-1);
    for (const milestone of majors.slice(0,-1)) {
      if (
        this.time >= milestone &&
        !this.bossesSpawned.includes(milestone)
      ) {
        this.bossesSpawned.push(milestone);
        this.spawnEnemy(null, true);
      }
    }
    if (this.time >= finalAt && !this.finalBossSpawned) {
      if(this.spawnEnemy(null, true, true))this.finalBossSpawned = true;
    }
    }
    this.attackClock -= dt;
    if (this.attackClock <= 0 && this.enemies.some((e) => e.hp > 0)) {
      this.attack();
      this.attackClock = this.attackInterval;
    }
    this.novaClock -= dt;
    if (this.upgrades.nova && this.novaClock <= 0&&!spellInvisible(this)) {
      this.novaClock = Math.max(1.3, 5 - this.upgrades.nova * 0.35);
      const radius = 110 + this.upgrades.nova * 22;
      this.effect(p.x, p.y, radius, "#ff965c", "nova", 0.7);
      this.audioCue("meteor-swarm");
      for (const enemy of this.enemies)
        if (distance(p, enemy) < radius + enemy.radius)
          this.hurtEnemy(enemy, this.damage * (1 + this.upgrades.nova * 0.3),false,'Fire');
    }
    this.chainClock -= dt;
    if (this.upgrades.chain && this.chainClock <= 0&&!spellInvisible(this)) {
      this.chainClock = 3;
      this.chainAttack();
    }
    const hiddenFromEnemies=spellInvisible(this);let contact=null,contactThreat=-Infinity;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      if(enemy.arrival>0){enemy.arrival=Math.max(0,enemy.arrival-dt);enemy.moving=false;continue;}
      const dx = p.x - enemy.x,
        dy = p.y - enemy.y,
        d = Math.hypot(dx, dy) || 1;
      const visible=!hiddenFromEnemies&&(!this.clearSight||this.clearSight(enemy,p));
      const stop=hiddenFromEnemies?Infinity:visible?tickMonsterBehavior(this,enemy,dt,true).stop:0;
      if(d>stop){
        const waypoint=this.enemyWaypoint?.(enemy,p);
        const goal=waypoint&&Number.isFinite(waypoint.x)&&Number.isFinite(waypoint.y)?waypoint:p;
        const wx=goal.x-enemy.x,wy=goal.y-enemy.y,wd=Math.hypot(wx,wy);
        if(wd>0){enemy.dx=wx/wd;enemy.dy=wy/wd;enemy.moving=true;const slow=spellEnemyMovementMultiplier(this,enemy),travel=Math.min(wd,enemy.speed*slow*dt);this.moveActor(enemy,wx/wd*travel,wy/wd*travel);}
      }
      else {enemy.moving=false;enemy.dx=dx/d;enemy.dy=dy/d;}
      if(visible&&d<enemy.radius+p.radius){
        const threat=enemy.damage*(enemy.lowerAttackUntil>this.time?.75:1)*spellEnemyDamageMultiplier(this,enemy);
        if(threat>contactThreat){contact=enemy;contactThreat=threat;}
      }
      // Recover far-away creatures without spawning unbounded entities.
      if (
        Math.abs(enemy.x - p.x) > this.viewport.width / 2 + 650 ||
        Math.abs(enemy.y - p.y) > this.viewport.height / 2 + 650
      ) {
        if(!this.zoneRun)Object.assign(enemy, this.spawnPoint(enemy.radius));
      }
    }
    // Array order must not let a weak rat spend the shared hit window before
    // an overlapping guardian. Keep invulnerability; resolve the worst contact.
    if(contact)this.hurtPlayer(contact.damage,'Physical',contact);
    for (const shot of this.projectiles) {
      shot.life -= dt;
      const before={x:shot.x,y:shot.y};
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      if(this.clearSight&&!this.clearSight(before,shot)){shot.life=0;continue;}
      if (shot.life <= 0) continue;
      if (shot.hostile) {
        if (distance(shot, p) < shot.radius + p.radius) {
          const owner=this.enemies.find(enemy=>enemy.id===shot.ownerId);
          const magical=shot.spellId&&shot.kind!=='arrow'&&!shot.reflected;
          if(magical&&tryReflectSpell(this,owner,shot.damage,shot.element||'Fire',{spellId:shot.spellId,circle:shot.circle,deferDamage:true,reflected:shot.reflected})){
            const speed=Math.hypot(shot.vx,shot.vy)||195,a=owner?Math.atan2(owner.y-shot.y,owner.x-shot.x):Math.atan2(-shot.vy,-shot.vx);
            shot.vx=Math.cos(a)*speed;shot.vy=Math.sin(a)*speed;shot.hostile=false;shot.reflected=true;shot.proc=true;shot.hits=[];shot.pierce=0;shot.life=shot.maxLife||4;
          }else{this.hurtPlayer(shot.damage,shot.element||"Fire",owner);shot.life=0;}
        }
      } else {
        for (const enemy of this.enemies)
          if (
            enemy.hp > 0 &&
            !(enemy.arrival > 0) &&
            !shot.hits.includes(enemy.id) &&
            distance(shot, enemy) < shot.radius + enemy.radius
          ) {
            shot.hits.push(enemy.id);
            if(shot.splashRadius&&!shot.reflected){
              spellImpact(this,enemy,shot.damage,shot.spellId||shot.kind,shot.element||'Fire',shot.splashRadius);
              if(shot.kind==='magic'&&!shot.proc)this.applyWeaponProperties(enemy,shot.damage);
            }
            else this.hurtEnemy(enemy,shot.damage,!shot.proc&&shot.kind!=='magic'&&shot.kind!=='fireball',shot.element||(shot.kind==='magic'||shot.kind==='fireball'?'Fire':null));
            if (shot.hits.length > shot.pierce) {
              shot.life = 0;
              break;
            }
          }
      }
    }
    this.projectiles = this.projectiles.filter((s) => s.life > 0);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    tickGoldOre(this,dt);
    for (const drop of this.pickups) {
      if(drop.kind==='ore')continue;
      if(drop.kind==='loot'){
        if(distance(drop,p)<p.radius+8&&canOpenLootChest(this,drop)){
          drop.collected=true;this.collect(drop);
          this.effect(drop.x,drop.y,28,'#edcc7a','spark',.5);
        }
        continue;
      }
      drop.life=(drop.life??(drop.kind==='loot'?180:90))-(this.zoneRun?0:dt);
      if(drop.life<=0){drop.collected=true;continue;}
      const playerZ=this.elevationAt?.(p.x,p.y,this.time);
      if(Number.isFinite(drop.z)&&Number.isFinite(playerZ)&&Math.abs(drop.z-playerZ)>2)continue;
      const d = distance(drop, p),
        magnet = 90*(1+this.heroUpgradeBonus('magnet')) + this.legacyBonuses.magnet*8;
      if (d < magnet || drop.attracted || (drop.kind==='xp'&&this.buffs.magnet?.remaining>0)) {
        drop.attracted = true;
        const travel = Math.min(
          d,
          (300 + (magnet - Math.min(magnet, d)) * 3) * dt,
        );
        drop.x += ((p.x - drop.x) / (d || 1)) * travel;
        drop.y += ((p.y - drop.y) / (d || 1)) * travel;
      }
      if (distance(drop, p) < p.radius + 8) {
        this.collect(drop);
        drop.collected = true;
      }
    }
    this.pickups = this.pickups.filter((drop) => !drop.collected);
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);

    if (p.hp <= 0) this.status = "dead";
    else if (!this.zoneRun && this.time>=this.duration && this.finalBossSpawned && !this.enemies.some((e) => e.final))
      this.status = "victory";
  }

  spawnChampionEncounter(index=0) {
    const native=this.zoneRun?this.areaMonsters():null;
    const waves=native?.filter(waveCreature);
    const ordinary=native?(waves.length?waves:native.filter(m=>!m.adaptation?.requiresContext)):null;
    const eligible=ordinary?.filter(m=>enemyCasterSpawnAllowed(m,zoneCombatTime(this)));
    const local=eligible?.length?eligible:ordinary;
    if(local&&!local.length)return null;
    const encounter=this.zoneRun?{zoneEncounter:true,zoneRole:'champion'}:{};
    const pack=index%2===1,captain=this.spawnEnemy(local?this.pick(local):null,false,false,encounter);
    if(!captain)return null;
    // A zone containing only named bosses remains a sparse encounter.
    if(captain.boss)return captain;
    captain.captain=true;captain.elite=true;captain.packChampion=pack;
    captain.name=(pack?'Pack Champion ':'Captain ')+captain.name;
    captain.hp*=pack?3.5:5;captain.maxHp=captain.hp;captain.damage*=1.2;captain.speed=Math.min(135,captain.speed*1.15);captain.xp*=4;
    if(captain.pressureStats){captain.pressureStats.damage*=1.2;captain.pressureStats.speed*=1.15;}
    const source=this.catalog.monsters?.find(m=>m.id===captain.type);
    const dx=captain.x-this.player.x,dy=captain.y-this.player.y,d=Math.hypot(dx,dy)||1;
    for(let n=0;n<2;n++){
      const escort=this.spawnEnemy(source||captain.type,false,false,{modifier:null,...encounter});if(!escort)continue;escort.escortOf=captain.id;escort.elite=pack;
      escort.hp*=pack?2.2:1.4;escort.maxHp=escort.hp;
      const x=captain.x+dx/d*55-dy/d*(n?45:-45),y=captain.y+dy/d*55+dx/d*(n?45:-45);
      const offscreen=Math.abs(x-this.player.x)>this.viewport.width/2+escort.radius||Math.abs(y-this.player.y)>this.viewport.height/2+escort.radius;
      if(!this.zoneRun&&offscreen&&this.canStand(x,y,escort.radius))Object.assign(escort,{x,y});
    }
    return captain;
  }

  get levelRerollPrice(){return 15+5*(this.levelRerolls||0);}
  get zoneScale(){
    if(!this.zoneRun||this.routeVersion!==2)return {hp:1,damage:1,xp:1,gold:1,loot:0,magicFind:0};
    if(!this._progressionCache)Object.defineProperty(this,'_progressionCache',{value:buildZoneProgression(this.areaRoute,this.catalog),configurable:true});
    return this._progressionCache[this.zoneRun.index];
  }
  get zonePlan(){
    if(!this._pacingCache)Object.defineProperty(this,'_pacingCache',{value:buildZonePacing(this.areaRoute,this.catalog,this.difficulty),configurable:true});
    return this._pacingCache[this.zoneRun?.index||0];
  }
  get zoneSpellPrice(){return 25+15*(this.zoneRun?.index||0);}
  zoneUpgradePrice(offer){return zoneUpgradePrice(this,offer);}
  get zoneSpellRerollPrice(){return 10+5*(this.zoneRun?.rerolls||0);}
  zoneProgress(){return zoneProgress(this);}
  rerollZoneSpells(){return rerollZoneSpells(this);}
  buyZoneSpell(index,replaceId=null){return buyZoneSpell(this,index,replaceId);}
  finishZoneSpellShop(){return finishZoneSpellShop(this);}
  advanceZone(){return advanceZone(this);}

  currentArea(id = null) {
    const selected=(id&&this.areaRoute.find(area=>area.id===id))||(this.zoneRun?this.areaRoute[this.zoneRun.index]:areaForTime(this.areaRoute,this.time,this.duration));
    if(!selected)return null;
    const source=this.catalog.areas?.find(area=>area.id===selected.id);
    return source?{...source,...selected}:null;
  }

  areaMonsters(area=this.currentArea()) {
    const monsters=this.catalog.monsters||[];
    if(!area)return this.areaRoute.length?[]:monsters;
    const classes=new Set(area.combatClasses);
    return monsters.filter(monster=>classes.has(monster.className)||classes.has(monster.sourceName));
  }

  spawnEnemy(type = null, boss = false, final = false, options = {}) {
    let placed=null;
    if(this.zoneRun){
      if(!options.zoneEncounter||!['combat','cleared'].includes(this.zoneRun.phase)||!this.spawnLocation)return null;
    }
    if(!this.zoneRun&&this.areaRoute.length&&this.areaAt){
      const target=this.currentArea();
      // The nearby offscreen ring can retain the previous area's patches.
      // Enter beyond the transition band so a stationary player still meets
      // the timed area's population without replacing visible terrain.
      for(const margin of [400,520,640]){
        const candidate=this.spawnPoint(65,margin);
        if(this.areaAt(candidate.x,candidate.y,this.time)===target.id){placed=candidate;break;}
      }
      if(!placed)return null;
    }
    const area=this.currentArea(!this.zoneRun&&placed&&this.areaAt?.(placed.x,placed.y,this.time)),local=this.areaMonsters(area);
    const combatTime=zoneCombatTime(this);
    const monsters = local.length ? local : this.areaRoute.length ? [] : [FALLBACK_MONSTER];
    const tier = Math.min(5, Math.floor((this.time / this.duration) * 6));
    const casterCap=combatTime<180?2:combatTime<360?4:6,casters=this.enemies.filter(e=>e.hp>0&&e.behavior?.caster&&!e.boss).length;
    const waveMonsters = monsters.filter(m=>waveCreature(m)&&enemyCasterSpawnAllowed(m,combatTime)&&(!monsterProfile(m).caster||casters<casterCap));
    const bossMonsters=monsters.filter(m=>(m.adaptation?.bossOnly||m.adaptation?.boss)&&bossAvailable(m,combatTime,this.duration)&&enemyCasterSpawnAllowed(m,combatTime));
    // Never replace a missing or gated native roster with an unrelated creature.
    // Boss-only zones keep one encounter alive instead of generating boss waves.
    if(area&&!this.zoneRun&&!boss&&!waveMonsters.length){
      if(monsters.some(waveCreature)||!bossMonsters.length||this.enemies.some(enemy=>enemy.hp>0&&enemy.areaId===area.id))return null;
      boss=true;
    }
    const pool = boss&&bossMonsters.length ? bossMonsters : waveMonsters;
    let eligible = pool.filter(
      (m) => (m.adaptation?.tier ?? 1) <= tier + (boss ? 1 : 0),
    );
    if (boss) {
      // Named encounters stay in the champion pool, and lower-tier bosses remain
      // reachable later in the run instead of disappearing behind the top tier.
      const encounters = eligible.filter((m) => m.adaptation?.bossOnly);
      if (encounters.length) eligible = encounters;
      else {
        const highest = Math.max(
          ...eligible.map((m) => m.adaptation?.tier ?? 1),
        );
        eligible = eligible.filter(
          (m) => (m.adaptation?.tier ?? 1) === highest,
        );
      }
    }
    let source =
      typeof type === "object" && type
        ? type
        : monsters.find((m) => m.id === type) ||
          this.pick(
            eligible.length
              ? eligible
              : pool.length
                ? pool
                : [FALLBACK_MONSTER],
          );
    if(area){
      const requested=typeof type==='object'&&type?type:monsters.find(monster=>monster.id===type);
      if(type!==null&&!requested)return null;
      if(requested&&!monsters.some(monster=>monster.id===requested.id))return null;
      // Local bosses are selected from source bosses when available. Otherwise
      // promote the strongest available inhabitant without changing native HP.
      const allowed=this.zoneRun?monsters:boss?monsters.filter(monster=>bossAvailable(monster,combatTime,this.duration)&&enemyCasterSpawnAllowed(monster,combatTime)):waveMonsters;
      if(!allowed.length)return null;
      if(requested&&allowed.some(monster=>monster.id===requested.id))source=requested;
      else if(boss){
        const native=allowed.filter(monster=>monster.adaptation?.bossOnly||monster.adaptation?.boss);
        const mean=value=>Array.isArray(value)?value.reduce((sum,n)=>sum+n,0)/value.length:Number(value)||0;
        const strength=monster=>mean(monster.stats?.hits||monster.stats?.str||monster.adaptation?.hp)*mean(monster.stats?.damage||monster.adaptation?.damage||1);
        const strongest=Math.max(...allowed.map(strength));
        source=this.pick(native.length?native:allowed.filter(monster=>strength(monster)===strongest));
      }else if(!allowed.some(monster=>monster.id===source.id))source=this.pick(allowed);
    }
    const stats = source.adaptation || FALLBACK_MONSTER.adaptation;
    const visual = this.monsterVisual(source);
    const serverStats=nativeMonsterStats(source,()=>this.random());
    const zoneScale=this.zoneScale;
    const hp = serverStats.hits*this.difficultySettings.health*zoneScale.hp;
    const radius = (stats.radius || 13) * (boss ? 1.6 : 1);
    if(this.zoneRun){
      placed=this.spawnLocation(area,radius,boss,options);
      if(!placed||!Number.isFinite(placed.x)||!Number.isFinite(placed.y))return null;
    }
    const enemy = {
      id: this.nextId++,
      type: source.id,
      ...(area?{areaId:area.id,facet:area.facet}:{}),
      ...(this.zoneRun?{zoneIndex:this.zoneRun.index,zoneRole:options.zoneRole||'wave'}:{}),
      name: final
        ? `Ancient ${source.name}`
        : boss
          ? `${source.name} Champion`
          : source.name,
      body: visual.body,
      hue: visual.hue,
      partialHue: visual.partialHue,
      ...(placed||this.spawnPoint(radius)),
      hp,
      maxHp: hp,
      damage: serverStats.damage*this.difficultySettings.damage*zoneScale.damage,
      serverStats,
      equipment:generateEnemyEquipment(source.id,visual.body,()=>this.random(),this.catalog.enemyEquipment),
      speed: Math.min(125, stats.speed || 47) * (boss ? 0.9 : 1),
      radius,
      resistances:serverStats.resistances,
      color: stats.color || "#a59679",
      xp: Math.max(1,Math.round((stats.xp || 5) * (boss ? 12 : 1)*this.difficultySettings.reward*zoneScale.xp)),
      ranged: !!(
        stats.ranged ??
        source.ranged ??
        /mage|lich|gazer|dragon|daemon/i.test(source.name)
      ),
      cooldown: 1.5,
      boss,
      final,
    };
    const modifier = (this.catalog.enemyModifiers || []).find(
      (entry) => entry.id === "paragon",
    );
    const paragonEligible =
      stats.paragonEligible ?? source.paragonEligible ?? false;
    if (modifier && paragonEligible && (!area||area.facet==='Ilshenar') && !stats.bossOnly && !boss && !final) {
      const design = modifier.adaptation || {};
      const selected = Object.hasOwn(options, "modifier")
        ? options.modifier === "paragon"
        : this.time >= (design.startsAt ?? 120) &&
          this.random() < (design.chance ?? 0.03);
      if (selected) {
        enemy.modifier = modifier.id;
        enemy.baseHue = enemy.hue;
        enemy.basePartialHue = enemy.partialHue;
        enemy.hue = modifier.hue;
        enemy.partialHue = !!(enemy.hue & 0x8000);
        enemy.name = `${enemy.name} (${modifier.name || "Paragon"})`;
        enemy.hp *= design.hpMultiplier ?? 2;
        enemy.maxHp = enemy.hp;
        enemy.damage *= design.damageMultiplier ?? 1.3;
        enemy.speed = Math.min(
          125,
          enemy.speed * (design.speedMultiplier ?? 1.1),
        );
        enemy.xp = Math.round(enemy.xp * (design.xpMultiplier ?? 2));
      }
    }
    applyZonePressure(this,enemy);
    initMonsterBehavior(this,enemy,source);
    if(this.enemyArrival>0){enemy.arrival=this.enemyArrival;this.effect(enemy.x,enemy.y,Math.max(24,enemy.radius*1.8),'#b9d8ff','teleport',this.enemyArrival);}
    this.enemies.push(enemy);
    return enemy;
  }

  monsterVisual(source) {
    let body = source.body;
    let hue = source.hue ?? 0;
    let partialHue = source.partialHue;
    if (source.visualVariants?.length) {
      const variants = source.visualVariants;
      const total = variants.reduce(
        (sum, variant) => sum + (variant.weight ?? 1),
        0,
      );
      let roll = this.random() * total;
      const variant =
        variants.find((entry) => (roll -= entry.weight ?? 1) < 0) ||
        variants.at(-1);
      body = variant.body ?? body;
      hue = variant.hue ?? hue;
      partialHue = variant.partialHue ?? partialHue;
    } else {
      if (source.bodyIds?.length) body = this.pick(source.bodyIds);
      if (source.hueIds?.length) hue = this.pick(source.hueIds);
    }
    return { body, hue, partialHue: partialHue ?? !!(hue & 0x8000) };
  }

  nearest(origin = this.player, max = 500, excluded = []) {
    let result = null,
      closest = max;
    for (const e of this.enemies)
      if (
        e.hp > 0 &&
        !(e.arrival > 0) &&
        distance(this.player, e) <= 500 &&
        (!this.clearSight||this.clearSight(origin,e)) &&
        !excluded.includes(e.id)
      ) {
        const d = distance(origin, e);
        if (d < closest) {
          result = e;
          closest = d;
        }
      }
    return result;
  }

  attack() {
    if(spellInvisible(this))return;
    const p = this.player,
      target = this.nearest();
    if (!target) return;
    this.audioCue(this.attackKind === "magic" ? "magic-arrow" : this.attackKind === "arrow" ? "bow" : "melee");
    if (this.attackKind === "melee") {
      const radius = 92*(1+this.heroUpgradeBonus('multishot'));
      this.effect(p.x, p.y, radius, "#f0cf88", "slash", 0.24);
      for (const e of this.enemies)
        if (distance(e, p) < radius + e.radius) this.hurtEnemy(e, this.damage,true);
      return;
    }
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    const extra=Math.min(5,this.heroUpgradeBonus('multishot'));
    const count = 1+Math.floor(extra)+(extra%1>0&&this.random()<extra%1?1:0);
    for (let i = 0; i < count; i++) {
      const a = angle + (i - (count - 1) / 2) * 0.14,
        speed = this.attackKind === "arrow" ? 520 : 390;
      this.projectiles.push({
        id: this.nextId++,
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: this.attackKind === "arrow" ? 4 : 7,
        damage: this.damage,
        life: 2.2,
        hostile: false,
        hits: [],
        pierce: this.attackKind === "arrow" ? 2 : 0,
        kind: this.attackKind,
        splashRadius: this.attackKind === "magic" ? 56 : 0,
        maxLife: 2.2,
        color: this.attackKind === "arrow" ? "#f1d19a" : "#8ee4ff",
      });
    }
  }

  chainAttack() {
    if(this.nearest()) this.audioCue("chain-lightning");
    let origin = this.player;
    const hit = [];
    for (let i = 0; i < 2 + this.upgrades.chain; i++) {
      const target = this.nearest(origin, i ? 200 : 450, hit);
      if (!target) break;
      hit.push(target.id);
      this.effects.push({
        x: origin.x,
        y: origin.y,
        x2: target.x,
        y2: target.y,
        radius: 8,
        kind: "chain",
        color: "#c6acff",
        life: 0.45,
        maxLife: 0.45,
      });
      this.hurtEnemy(target, this.damage * 0.8,false,'Energy');
      origin = target;
    }
  }

  effect(x, y, radius, color, kind = "hit", life = 0.2) {
    life=Math.max(life,kind==='explosion'?1.3:kind==='flame-strike'?3:0);
    this.effects.push({ x, y, radius, color, kind, life, maxLife: life });
  }
  hurtPlayer(damage,element="Physical",attacker=null) {
    if (this.hitClock > 0 || this.player.hp <= 0) return;
    if(this.aosBonuses.DefendChance>0&&this.random()*100<Math.min(45,this.aosBonuses.DefendChance))return;
    if(attacker?.lowerAttackUntil>this.time)damage*=.75;
    if(attacker)damage*=spellEnemyDamageMultiplier(this,attacker);
    let taken=Math.max(1,(damage-this.armor)*(1-(this.resistances[damageChannel(element)]||0)/100));
    const shield=this.buffs.shield;if(shield?.remaining>0&&shield.value>0){const absorbed=Math.min(taken,shield.value);shield.value-=absorbed;taken-=absorbed;if(shield.value<=0)delete this.buffs.shield;}
    this.player.hp = Math.max(0,this.player.hp-taken);
    if(taken>0)this.regenDelay=2;
    if(taken>0&&element==='Physical'&&attacker)applyMonsterContact(this,attacker);
    if(element==='Physical'&&attacker&&this.aosBonuses.ReflectPhysical>0)this.hurtEnemy(attacker,damage*Math.min(100,this.aosBonuses.ReflectPhysical)/100);
    if(this.player.hp<=0){this.corpses.push({id:this.nextId++,body:this.player.sex==='female'?401:400,hue:0,x:this.player.x,y:this.player.y,dx:this.lastDirection.x,dy:this.lastDirection.y,life:35,maxLife:35});if(this.corpses.length>180)this.corpses.shift();}
    this.hitClock = 0.65;
    this.audioCue(this.player.hp <= 0 ? "death" : "hurt");
    this.effect(this.player.x, this.player.y, 25, "#ff6666", "hurt");
  }

  applyWeaponProperties(enemy,damage,rawDamage=damage) {
    const weapon=this.equipped('weapon');if(!weapon?.aosMode)return;
    const b=this.aosBonuses,roll=key=>(b[key]||0)>0&&this.random()*100<b[key];
    if(this.lifeLeechClock<=1e-8&&roll('HitLeechHits')){
      this.player.hp=Math.min(this.player.maxHp,this.player.hp+Math.min(damage*.3,this.baseMaxHp*.025));
      this.lifeLeechClock=.5;
    }
    for(const [key,kind,base,dice]of [['HitMagicArrow','magic',10,4],['HitFireball','fireball',19,5]])if(enemy.hp>0&&roll(key)){
      const a=Math.atan2(enemy.y-this.player.y,enemy.x-this.player.x);
      this.projectiles.push({id:this.nextId++,x:this.player.x,y:this.player.y,vx:Math.cos(a)*390,vy:Math.sin(a)*390,radius:7,damage:(base+1+Math.floor(this.random()*dice)),life:2.2,maxLife:2.2,hostile:false,hits:[],pierce:0,kind,proc:true});
      this.audioCue(kind==='magic'?'magic-arrow':'fireball');
    }
    if(enemy.hp>0&&roll('HitLightning')){this.effects.push({x:this.player.x,y:this.player.y,x2:enemy.x,y2:enemy.y,radius:8,kind:'chain',life:.45,maxLife:.45});this.audioCue('chain-lightning');this.hurtEnemy(enemy,(24+Math.floor(this.random()*4)),false,'Energy');}
    if(enemy.hp>0&&roll('HitHarm'))this.hurtEnemy(enemy,18+Math.floor(this.random()*5),false,'Cold');
    if(roll('HitLowerAttack'))enemy.lowerAttackUntil=this.time+10;
    if(roll('HitLowerDefend'))enemy.lowerDefendUntil=this.time+10;
    for(const channel of ['Physical','Elemental'])if(roll('Hit'+channel+'Area')){
      const types=channel==='Physical'?{Physical:100}:elementalAreaTypes(this.wornItems,weapon);
      const element=Object.keys(types).find(k=>['Fire','Cold','Poison'].includes(k))||channel;
      this.effect(enemy.x,enemy.y,110,element==='Fire'?'#ff965c':element==='Cold'?'#99dfff':element==='Poison'?'#7db751':'#d2b9ff',element==='Fire'?'fireball':element==='Cold'?'harm':element==='Poison'?'poison':channel==='Elemental'?'lightning':'nova',.5);
      for(const victim of this.enemies)if(victim.hp>0&&distance(enemy,victim)<=110+victim.radius&&(!this.clearSight||this.clearSight(enemy,victim)))this.hurtEnemy(victim,rawDamage*.5,false,types);
    }
  }
  hurtEnemy(enemy,damage,weaponHit=false,element=null,damageOverTime=false) {
    if (enemy.hp <= 0||enemy.arrival>0) return;
    if(damage>0)enemy.spellParalyzedUntil=0;
    const weapon=this.equipped('weapon');
    if(weaponHit&&weapon?.aosMode&&this.random()>Math.min(1,.9+(this.aosBonuses.AttackChance||0)/150)){this.audioCue(this.attackKind==='arrow'?'bow-miss':'melee-miss');return;}
    const distribution=element?(typeof element==='object'?element:{[element]:100}):weaponHit?(Object.values(weapon?.damageTypes||{}).some(v=>v>0)?weapon.damageTypes:{Physical:100}):{Physical:100};
    const rawDamage=damage;
    const resist=combatResistances(enemy.resistances);
    let weighted=0;for(const [channel,percent]of Object.entries(damageDistribution(distribution)))weighted+=percent*damageIncrease(this,channel)*(1-Math.max(0,Math.min(100,resist[channel]))/100)/100;
    damage=Math.max(1,damage*weighted);
    const wasAlive=enemy.hp>0;
    if(enemy.lowerDefendUntil>this.time)damage*=1.25;
    enemy.hp = Math.max(0,enemy.hp-damage);
    if(enemy.hp>0&&!damageOverTime&&damage>0&&distribution){
      const cold=(distribution.Cold||0)/100;
      if(cold>0)enemy.spellSlowedUntil=Math.max(enemy.spellSlowedUntil||0,this.time+3*cold);
      for(const [element,prefix,duration,interval]of [['Fire','spellBurn',3,1],['Poison','spellPoison',6,2]]){
        const amount=rawDamage*(distribution[element]||0)/100*.1;if(!(amount>0))continue;
        const active=enemy[prefix+'Until']>this.time;
        enemy[prefix+'Damage']=active?Math.max(enemy[prefix+'Damage']||0,amount):amount;
        enemy[prefix+'Until']=Math.max(enemy[prefix+'Until']||0,this.time+duration);
        if(!active)enemy[prefix+'Tick']=interval;
      }
    }
    if(weaponHit&&wasAlive)this.applyWeaponProperties(enemy,damage,rawDamage);
    this.audioCue("hit", enemy);
    enemy.hit = this.time;
    this.effect(enemy.x, enemy.y, 12, "#fff0ba");
    if (enemy.hp > 0 || enemy.deathHandled) return;
    enemy.deathHandled=true;
    if(/skeleton|bone-knight/.test(enemy.type)) this.audioCue("skeleton-death",enemy);
    else if(/zombie/.test(enemy.type)) this.audioCue("zombie-death",enemy);
    else if(/^orc/.test(enemy.type)) this.audioCue("orc-death",enemy);
    this.corpses.push({id:this.nextId++,body:enemy.body,hue:enemy.hue||0,partialHue:!!enemy.partialHue,boss:!!enemy.boss,equipment:copy(enemy.equipment||[]),x:enemy.x,y:enemy.y,z:this.elevationAt?.(enemy.x,enemy.y,this.time)??enemy.z??0,dx:this.player.x-enemy.x,dy:this.player.y-enemy.y,life:35,maxLife:35});
    if(this.corpses.length>180)this.corpses.shift();
    this.kills++;
    this.pickups.push({
      id: this.nextId++,
      x: enemy.x,
      y: enemy.y,
      z:this.elevationAt?.(enemy.x,enemy.y,this.time)??enemy.z??0,
      kind: "xp",
      value: enemy.xp,
      color: "#62dcb5",
      radius: 5,
    });
    if (enemy.boss) {
      this.bossesKilled++;
    }
    if(dropsLootChest(enemy))this.dropLoot(enemy);
    if (enemy.boss || enemy.captain || enemy.packChampion || this.random() < GOLD_DROP_CHANCE*ORDINARY_GOLD_RETAINED) {
      const gold=withGoldFind(this,monsterGoldBase(this,enemy));
      if(enemy.boss||enemy.captain||enemy.packChampion){this.player.gold+=gold;this.notifyLoot({kind:'gold',value:gold,text:`+${gold} gold`});}
      else this.pickups.push({
        id: this.nextId++,
        x: enemy.x + 8,
        y: enemy.y,
        z:this.elevationAt?.(enemy.x,enemy.y,this.time)??enemy.z??0,
        kind: "gold",
        value: gold,
        color: "#eac16e",
        radius: 5,
      });
    }
    if(enemy.boss||enemy.captain||this.random()<POWERUP_DROP_CHANCE){
      const kind=this.pick(Object.keys(POWERUPS));this.pickups.push({id:this.nextId++,x:enemy.x-14,y:enemy.y+9,z:this.elevationAt?.(enemy.x,enemy.y,this.time)??enemy.z??0,kind,value:POWERUPS[kind].value,color:'#dcbd73',radius:8,life:45});
    }
    zoneEnemyKilled(this,enemy);
    if (enemy.boss||this.random() < HEAL_DROP_CHANCE)
      this.pickups.push({
        id: this.nextId++,
        x: enemy.x - 8,
        y: enemy.y,
        z:this.elevationAt?.(enemy.x,enemy.y,this.time)??enemy.z??0,
        kind: "heal",
        value: enemy.boss?35:12,
        color: "#e26771",
        radius: 7,
      });
  }

  openLootChest(id){
    const index=this.pickups.findIndex(drop=>drop.id===id),chest=this.pickups[index];
    if(!canOpenLootChest(this,chest))return false;
    this.pickups.splice(index,1);this.collect(chest);
    this.effect(chest.x,chest.y,28,'#edcc7a','spark',.5);
    return true;
  }

  collect(drop) {
    if(POWERUPS[drop.kind]){
      const definition=POWERUPS[drop.kind];
      if(drop.kind==='heal-percent')this.player.hp=Math.min(this.player.maxHp,this.player.hp+this.player.maxHp*definition.value);
      else this.buffs[drop.kind]={remaining:definition.duration,duration:definition.duration,value:definition.value};
      this.audioCue('heal');this.notifyLoot({kind:'powerup',text:definition.name});return;
    }
    if(["gold","heal","loot"].includes(drop.kind)) this.audioCue(drop.kind);
    if(drop.kind === "heal") this.effect(this.player.x,this.player.y,28,"#8fcb87","heal",.7);
    if (drop.kind === "xp") {
      this.player.xp += drop.value;
      this.notifyLoot({kind:"xp",value:drop.value,text:`+${drop.value} XP`});
      this.checkLevel();
    }
    if (drop.kind === "gold") {this.player.gold += drop.value;this.notifyLoot({kind:"gold",value:drop.value,text:`+${drop.value} gold`});}
    if (drop.kind === "heal") {
      this.player.hp = Math.min(this.player.maxHp,this.player.hp+drop.value*(1+(this.aosBonuses.EnhancePotions||0)/100));
      this.notifyLoot({kind:"heal",text:"Greater heal potion",value:drop.value});
    }
    if (drop.kind === "loot" && drop.item) {
      this.acquireItem(drop.item);
    }
  }

  checkLevel() {
    if(this.pendingSpellSupers?.length)return;
    if (this.player.xp < this.player.nextXp || this.status !== "playing")
      return;
    this.player.xp -= this.player.nextXp;
    this.player.level++;
    this.levelRerolls=0;
    this.player.nextXp = Math.round(18 * Math.pow(this.player.level, 1.3));
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 12);
    this.audioCue("levelup");
    this.status = "levelup";
    this.rollChoices();
    // A fully mastered build converts the level into gold instead of an empty menu.
    if(!this.choices.length){this.player.gold+=MASTERED_LEVEL_GOLD;this.notifyLoot({kind:'gold',value:MASTERED_LEVEL_GOLD,text:`Every improvement mastered: +${MASTERED_LEVEL_GOLD} gold`});this.status='playing';this.checkLevel();}
  }

  get learningSpells(){return this.player.level%5===0;}

  rollChoices() {
    if(this.learningSpells){this.choices=mixedChoiceDraw(newSpellChoices(this),3,()=>this.random()).map(choice=>decorateUpgrade(this,choice));return;}
    const passives=UPGRADES.filter(u=>!['nova','chain'].includes(u.id)&&(u.id!=='multishot'||this.attackKind==='melee'||this.heroUpgradeBonus('multishot')<5));
    const unlearned=passives.filter(u=>!this.upgrades[u.id]);
    const pool=[...(unlearned.length?unlearned:passives).map(u=>({...u,icon:passiveIcon(u.id)})),...spellChoices(this),...globalSpellChoices(this,SPELLS)];
    this.choices=mixedChoiceDraw(pool,3,()=>this.random(),choice=>choice.type==='spell'?'spell':choice.type==='global'?'global':'passive').map(choice=>({...choice,level:choice.type==='spell'?choice.level:(this.upgrades[choice.id]||0)+1}));
    this.ensurePassiveChoice();
    this.choices=this.choices.map(choice=>decorateUpgrade(this,choice));
  }

  ensurePassiveChoice() {
    if(this.learningSpells||!this.choices.length)return;
    const passives=UPGRADES.filter(u=>!["nova","chain"].includes(u.id)&&(u.id!=="multishot"||this.attackKind==="melee"||this.heroUpgradeBonus('multishot')<5));
    const unlearned=passives.filter(u=>!this.upgrades[u.id]);
    const candidates=unlearned.length?unlearned:passives;
    if(this.choices.some(c=>c.type!=='spell'&&candidates.some(u=>u.id===c.id)))return;
    const choice=this.pick(candidates);
    this.choices[this.choices.length-1]={...choice,icon:passiveIcon(choice.id),level:(this.upgrades[choice.id]||0)+1};
  }

  chooseUpgrade(index,replaceId=null) {
    if (this.status !== "levelup" || this.pendingSpellSupers?.length || !this.choices[index]) return false;
    const choice=this.choices[index],id=choice.id;
    if(choice.type==='spell'||id.startsWith('spell:')){
      if(!(this.learningSpells?newSpellChoices(this):spellChoices(this)).some(offer=>offer.id===choice.id))return false;
      const result=applySpellOffer(this,choice,replaceId);
      if(!result.ok)return result.requiresReplacement?result:false;
      this.refreshWeapons();this.choices=[];this.status='playing';this.checkLevel();return true;
    }
    if(choice.type==='global'){
      if(this.learningSpells||!globalSpellChoices(this,SPELLS).some(c=>c.id===id)||!applyGlobalUpgrade(this,choice))return false;
      this.choices=[];this.status='playing';this.checkLevel();return true;
    }
    if(this.learningSpells)return false;
    if(!this.applyPassiveUpgrade(choice))return false;
    this.choices = [];
    this.status = "playing";
    this.checkLevel();
    return true;
  }

  get shopUpgradeChoices(){
    return [...spellChoices(this),...globalSpellChoices(this,SPELLS),...UPGRADES.filter(c=>HERO_UPGRADE_IDS.includes(c.id)&&(c.id!=='multishot'||this.attackKind==='melee'||this.heroUpgradeBonus('multishot')<5)).map(c=>({...c,type:'passive',icon:passiveIcon(c.id)}))];
  }
  applyPassiveUpgrade(choice){
    const id=choice.id;if(!HERO_UPGRADE_IDS.includes(id))return false;
    const rarity=UPGRADE_RARITIES.find(r=>r.id===(choice.rarity||'common'));if(!rarity)return false;
    const bonus=rarity.statBonus;if(choice.bonus!==undefined&&choice.bonus!==bonus)return false;
    this.heroStatUpgrades??={};this.heroStatUpgrades[id]=Math.round((this.heroUpgradeBonus(id)+bonus)*10000)/10000;
    this.upgrades[id]=(this.upgrades[id]||0)+1;
    if(id==='vitality'){const gain=this.baseMaxHp*bonus;this.player.maxHp+=gain;this.player.hp=Math.min(this.player.maxHp,this.player.hp+gain);}
    if(id==='speed')this.player.speed+=(this.attackKind==='arrow'?165:150)*bonus;
    this.refreshWeapons();
    return true;
  }

  skipNewSpell(){
    if(this.status!=='levelup'||!this.learningSpells||this.pendingSpellSupers?.length)return false;
    this.choices=[];this.status='playing';this.checkLevel();return true;
  }

  reroll() {
    if (this.status !== "levelup" || this.pendingSpellSupers?.length || !this.choices.length || this.player.gold < this.levelRerollPrice) return false;
    this.player.gold -= this.levelRerollPrice;
    this.levelRerolls++;
    this.rollChoices();
    return true;
  }

  makeItem(source, slot=source.slot, tier = 0) {
    const props=sourceProperties(source),stats=props.stats;
    const aosMode=!!source.slot||Object.keys(props.aosAttributes).length>0;
    const fixed=artifactItem(source),predefined=!!source.fixedProperties?.length;
    const min=Number(stats.MinDamage??stats.AosMinDamage??stats.damageMin??0),max=Number(stats.MaxDamage??stats.AosMaxDamage??stats.damageMax??stats.damage??source.damage??10);
    const resist=Object.values(props.resistances).reduce((a,v)=>a+v,0);
    const item={uid:this.nextId++,id:source.id,name:source.name,itemId:source.itemId,slot:source.slot||slot,tier:fixed||predefined?0:tier,hue:Number.isInteger(source.hue)?source.hue:0,
      power:slot==='weapon'?(aosMode?Math.max(1,Math.round((min+max)/2)):Math.round(max*.3+tier*5)):0,
      defense:slot!=='weapon'?(aosMode?resist:Math.round(Number(stats.ArmorBase||stats.armorBase||stats.armor||source.armor||3)*.3+tier*2)):0,
      serverLayer:source.serverLayer,allowMale:source.stats?.AllowMaleWearer!==false,allowFemale:source.stats?.AllowFemaleWearer!==false,price:25+tier*30,source:source.source||null,aosMode,artifact:fixed,predefined,rarity:fixed?'artifact':predefined?'magic':tier>=2?'rare':tier?'magic':'normal',twoHanded:!!source.twoHanded,damageTypes:source.damageTypes||{},...props};
    if(!fixed&&!predefined&&tier>0&&this.catalog.aosAffixRules?.families){
      const family=aosFamily({...source,slot:item.slot});
      const pack=['AosPoor','AosAverage','AosRich','AosFilthyRich','AosSuperBoss'][Math.min(4,tier)];
      const budget=this.pick(this.catalog.aosAffixRules.lootPacks[pack]);
      const pool=combatAffixRules(this.catalog.aosAffixRules.families[family]||[],item).filter(rule=>activeProperty(rule.key)),count=Math.min(pool.length,budget.maxProperties);
      item.lootBudget={pack,...budget};
      item.rolledProperties=[];
      for(let i=0;i<count&&pool.length;i++){
        const a=pool.splice(Math.floor(this.random()*pool.length),1)[0];
        const value=rollAosProperty(a,budget,()=>this.random());
        item[a.target][a.key]=a.target==='resistances'?(item.resistances[a.key]||0)+value:value;item.rolledProperties.push({...a,value});
        const group=key=>/^Hit(?:Physical|Elemental|Fire|Cold|Poison|Energy)Area$/.test(key)?'area':/^Hit(?:MagicArrow|Harm|Fireball|Lightning)$/.test(key)?'spell':['UseBestSkill','MageWeapon'].includes(key)?'skill':key;
        if(family==='weapon')for(let k=pool.length-1;k>=0;k--)if(group(pool[k].key)===group(a.key))pool.splice(k,1);
        if(a.key==='SpellChanneling')item.aosAttributes.CastSpeed=(item.aosAttributes.CastSpeed||0)-1;
      }
      item.name=(tier>=2?'Rare ':'Magic ')+source.name;
    }
    if(aosMode&&slot==='weapon'&&!Number.isFinite(stats.MaxDamage)&&!Number.isFinite(stats.AosMaxDamage))item.power=0;
    if(aosMode&&slot!=='weapon')item.defense=Object.values(itemResistances(item)).reduce((a,v)=>a+v,0);
    for(const roll of source.propertyRanges||[])if(roll.values?.length&&item[roll.target])item[roll.target][roll.key]=this.pick(roll.values);
    if(source.itemIds?.length>1)item.itemId=this.pick(source.itemIds);
    if(!fixed&&source.hueIds?.length>1)item.hue=this.pick(source.hueIds);
    applyWeaponIdentity(item);
    if(!fixed&&!predefined&&tier>0)rollSpellPower(item,aosFamily({...source,slot:item.slot}),tier,{random:()=>this.random(),spells:SPELLS.map(s=>s.id),learned:(this.spellLoadout||[]).map(s=>s.id),granted:item.grantedSpell});
    item.price=Math.max(item.price,Math.round(20+itemScore(item)*2+(fixed?500:0)));
    return item;
  }

  makeLootItem(source,slot,tier){
    let item=this.makeItem(source,slot,tier);
    if(hasGameplayStats(item))return item;
    // Preserve literal fixed items; cosmetic-only fixed entries are not loot.
    if(item.artifact||item.predefined)return null;
    const rules=combatAffixRules(this.catalog.aosAffixRules?.families?.[aosFamily({...source,slot})]||[],item).filter(rule=>rule.max>0&&hasGameplayStats({[rule.target]:{[rule.key]:rule.max}}));
    if(!rules.length)return null;
    item=this.makeItem(source,slot,Math.max(1,tier));
    if(!hasGameplayStats(item)){
      const rule=this.pick(rules),step=rule.step||1;
      const value=Math.max(step,rule.min);
      item[rule.target][rule.key]=value;
      item.rolledProperties??=[];
      const previous=item.rolledProperties.findIndex(p=>p.target===rule.target&&p.key===rule.key);
      if(previous>=0)item.rolledProperties.splice(previous,1);
      if(item.rolledProperties.length>=(item.lootBudget?.maxProperties||1)){
        const removed=item.rolledProperties.pop();
        if(removed){delete item[removed.target][removed.key];if(source[removed.target]?.[removed.key]!==undefined)item[removed.target][removed.key]=source[removed.target][removed.key];}
      }
      item.rolledProperties.push({...rule,value});
      if(rule.target==='resistances')item.defense=Object.values(itemResistances(item)).reduce((a,v)=>a+v,0);
      item.price=Math.max(item.price,Math.round(20+itemScore(item)*2));
    }
    return item;
  }

  dropLoot(enemy) {
    const slotOf=source=>source.slot||((this.catalog.weapons||[]).includes(source)?'weapon':'armor');
    const all=(this.catalog.items?.length?this.catalog.items:[...(this.catalog.weapons||[]),...(this.catalog.armor||[])]).filter(source=>lootSourceEligible(source,slotOf(source),this.catalog.aosAffixRules?.families));
    const uniques=all.filter(i=>artifactItem(i)&&i.lootEligible!==false),ordinary=all.filter(i=>!artifactItem(i)&&i.lootEligible!==false);
    const rarity=lootRarity(this.random(),{leader:lootLeader(enemy),luck:this.aosBonuses.Luck||0,magicFind:(this.difficulty==='hard'?1:0)+this.zoneScale.magicFind});
    const pool=rarity==='artifact'&&uniques.length?uniques:ordinary;if(!pool.length)return;
    // Pick the slot before the class so large weapon/hat catalogs cannot crowd
    // out jewelry or less common clothing slots. Rarity is rolled independently.
    const slots=[...new Set(pool.map(slotOf))],slot=this.pick(slots);
    const source=this.pick(pool.filter(source=>slotOf(source)===slot));
    const tier=rarity==='normal'?0:Math.min(4,Math.floor(zoneCombatTime(this)/this.duration*3)+(rarity==='magic'?1:2));
    const item=this.makeLootItem(source,slot,tier);if(!item)return;
    if(!item.artifact&&!item.predefined){item.rarity=rarity==='artifact'?'rare':rarity==='normal'&&item.tier>0?'magic':rarity;item.name=item.name.replace(/^(?:Magic|Rare) /,item.rarity==='rare'?'Rare ':'Magic ');}
    this.pickups.push({
      id: this.nextId++,
      x: enemy.x,
      y: enemy.y - 10,
      z:this.elevationAt?.(enemy.x,enemy.y,this.time)??enemy.z??0,
      kind: "loot",
      item,
      color: "#d9a5ff",
      radius: 9,
    });
  }

  refreshShop() {
    this.shop = [];
    for (const slot of ["weapon", "armor"]) {
      const pool = (this.catalog[slot === "weapon" ? "weapons" : "armor"] || []).filter(i=>i.lootEligible!==false);
      if (pool.length)
        this.shop.push(
          this.makeItem(
            this.pick(pool),
            slot,
            1 + Math.floor((this.time / this.duration) * 3),
          ),
        );
    }
    if(this.catalog.items?.length){const pool=this.catalog.items.filter(i=>!["weapon","armor"].includes(i.slot)&&!artifactItem(i)&&i.lootEligible!==false);for(let n=0;n<2&&pool.length;n++){const source=this.pick(pool);this.shop.push(this.makeItem(source,source.slot,1+Math.floor(zoneCombatTime(this)/this.duration*3)));}}
    this.shop.push({
      uid: this.nextId++,
      id: "greater-heal",
      name: "Greater Heal Potion",
      slot: "potion",
      price: 20,
      healing: 65,
    });
  }

  equip(index) {
    const item = this.inventory[index];
    if (!item || !(item.slot in this.equipment) || ["dead","victory"].includes(this.status)) return false;
    if((this.player.sex==='female'&&item.allowFemale===false)||(this.player.sex!=='female'&&item.allowMale===false)){this.notifyLoot({kind:'notice',text:'That item does not fit this body.'});return false;}
    for(const worn of this.wornItems)if(worn.uid!==item.uid&&item.serverLayer&&worn.serverLayer===item.serverLayer)this.equipment[worn.slot]=null;
    if(item.slot==='weapon'&&item.twoHanded)this.equipment.offhand=null;
    if(item.slot==='offhand'&&this.equipped('weapon')?.twoHanded)this.equipment.weapon=null;
    this.equipment[item.slot] = item.uid;
    this.refreshEquipmentStats();
    this.audioCue("equip");
    return true;
  }

  unequip(index) {
    const item = this.inventory[index];
    if (!item || this.equipment[item.slot] !== item.uid) return false;
    this.equipment[item.slot] = null;
    this.refreshEquipmentStats();
    this.audioCue("equip");
    return true;
  }

  buy(index) {
    const item = this.shop[index];
    if (
      !item ||
      this.player.gold < item.price ||
      ["dead", "victory"].includes(this.status)
    )
      return false;
    this.audioCue("gold");
    this.player.gold -= item.price;
    if (item.slot === "potion") {
      this.audioCue("heal");
      this.effect(this.player.x,this.player.y,28,"#8fcb87","heal",.7);
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + item.healing,
      );
    } else this.acquireItem(item);
    this.shop.splice(index, 1);
    return true;
  }

  discard(index){
    const item=this.inventory[index];if(!item||['dead','victory'].includes(this.status))return false;
    for(const slot of Object.keys(this.equipment))if(this.equipment[slot]===item.uid)this.equipment[slot]=null;
    this.inventory.splice(index,1);this.refreshEquipmentStats();return true;
  }

  sell(index) {
    const item = this.inventory[index];
    if (
      !item ||
      Object.values(this.equipment).includes(item.uid) ||
      ["dead", "victory"].includes(this.status)
    )
      return false;
    this.player.gold += Math.max(1, Math.floor(item.price * 0.5));
    this.inventory.splice(index, 1);
    return true;
  }

  pause() {
    if (this.status === "playing") this.status = "paused";
    else if (this.status === "paused") this.status = "playing";
    return this.status;
  }

  snapshot() {
    const { catalog, ...state } = this;
    return { version: 1, ...copy(state) };
  }

  static restore(catalog, snapshot) {
    validateSnapshot(snapshot,catalog);
    const game = new Game(catalog, {
      seed: snapshot.seed,
      archetype: snapshot.archetype,
      duration: snapshot.duration,
      difficulty: snapshot.difficulty||"normal",
      legacyBonuses: snapshot.legacyBonuses||{},
      autoequip: snapshot.autoequip??true,
    });
    const state = copy(snapshot);
    const playerDefaults = game.player;
    // Only restore data fields owned by the simulation, never instance methods.
    for (const key of Object.keys(game))
      if (key !== "catalog" && Object.hasOwn(state, key))
        game[key] = state[key];
    // Legacy runs retain their existing world instead of receiving a new route.
    if(snapshot.routeVersion===undefined)game.routeVersion=1;
    if(snapshot.areaRoute===undefined)game.areaRoute=[];
    if(snapshot.zoneRun===undefined)game.zoneRun=null;
    game.player = { ...playerDefaults, ...state.player };
    game.equipment={...Object.fromEntries([...new Set([...EQUIPMENT_SLOTS,...(catalog.equipmentSlots||[]).map(s=>s.id)])].map(k=>[k,null])),...state.equipment};
    if((snapshot.gearVersion||0)<2){
      const oldRng=game.rng,oldNext=game.nextId;
      const migrate=item=>{const source=(catalog.items||[]).find(i=>i.id===item.id);return source?{...game.makeItem(source,source.slot,0),uid:item.uid,itemId:item.itemId??source.itemId}:item;};
      game.inventory=game.inventory.map(migrate);game.shop=game.shop.map(migrate);for(const p of game.pickups)if(p.kind==='loot')p.item=migrate(p.item);
      game.rng=oldRng;game.nextId=oldNext;game.ensureStarterClothing();
    }
    game.gearVersion=2;
    if(!snapshot.weaponIdentityVersion)for(const item of [...game.inventory,...game.shop,...game.pickups.filter(p=>p.kind==='loot').map(p=>p.item).filter(Boolean)])applyWeaponIdentity(item);
    game.weaponIdentityVersion=1;
    if(!snapshot.starterClothingVersion){
      const robe=game.equipped('robe');
      // The old plain starter robe obscures armor. Keep it in the pack;
      // named, enchanted and artifact robes remain the player's equipment.
      if(robe?.id==='robe'&&!robe.artifact&&!robe.predefined&&!robe.tier){
        game.equipment.robe=null;game.ensureStarterClothing();
      }
    }
    game.starterClothingVersion=1;
    if(snapshot.encounterVersion===undefined){
      game.bossesSpawned=bossSchedule(game.duration).slice(0,-1).filter(mark=>mark<=game.time);
      game.championMarks=championSchedule(game.duration).filter(mark=>mark<=game.time);
    }
    initSpellState(game);
    if(game.zoneRun){game.zoneRun.pressureElapsed??=0;}
    if(game.zoneRun&&!game.zoneRun.flowVersion){game.zoneRun.flowVersion=2;if(game.zoneRun.phase==='spellshop'){game.zoneRun.phase='cleared';game.zoneSpellOffers=[];}}
    if(game.status==='levelup'){
      const available=new Set((game.learningSpells?newSpellChoices(game):[...spellChoices(game),...globalSpellChoices(game,SPELLS),...UPGRADES]).map(choice=>choice.id));
      if(snapshot.spellLearningVersion!==2||game.choices.length!==3||game.choices.some(choice=>!available.has(choice.id)))game.rollChoices();
      else game.ensurePassiveChoice();
    }
    game.spellLearningVersion=2;
    if(game.zoneRun?.phase==='spellshop'){const before=game.zoneSpellOffers.length;game.zoneSpellOffers=game.zoneSpellOffers.filter(c=>[...game.shopUpgradeChoices].some(s=>s.id===c.id));if(game.zoneSpellOffers.length!==before||game.zoneSpellOffers.length!==Math.min(5,game.shopUpgradeChoices.length))rollZoneSpells(game);}
    for (const enemy of game.enemies) {
      const source=catalog.monsters?.find(m=>m.id===enemy.type);
      if(snapshot.monsterStatsVersion===undefined&&source){
        const ratio=Math.max(0,Math.min(1,enemy.hp/enemy.maxHp)),native=nativeMonsterStats(source,()=>game.random());
        const hpFactor=enemy.captain?(enemy.packChampion?3.5:5):enemy.elite?2.2:1;
        const paragon=enemy.modifier==='paragon'?(catalog.enemyModifiers||[]).find(m=>m.id==='paragon')?.adaptation:null;
        enemy.serverStats=native;enemy.maxHp=native.hits*game.difficultySettings.health*hpFactor*(paragon?.hpMultiplier||1);enemy.hp=enemy.maxHp*ratio;
        enemy.damage=native.damage*game.difficultySettings.damage*(enemy.captain?1.2:1)*(paragon?.damageMultiplier||1);
        enemy.resistances=native.resistances;enemy.maxMana=native.mana??enemy.maxMana??0;enemy.mana=Math.min(enemy.mana||0,enemy.maxMana);
      }
      if(!enemy.equipment?.length&&isEquipmentBody(enemy.body))enemy.equipment=generateEnemyEquipment(enemy.type,enemy.body,()=>game.random(),catalog.enemyEquipment);
      if(!enemy.behavior)initMonsterBehavior(game,enemy,catalog.monsters?.find(m=>m.id===enemy.type)||{id:enemy.type,ranged:enemy.ranged});
      enemy.hue ??= 0;
      enemy.partialHue ??= !!(enemy.hue & 0x8000);
    }
    if(snapshot.monsterStatsVersion===undefined)game.enemies=game.enemies.filter(enemy=>{
      const source=catalog.monsters?.find(m=>m.id===enemy.type);
      return enemy.final||!source||(!source.adaptation?.requiresContext&&(!source.adaptation?.bossOnly||(enemy.boss&&bossAvailable(source,game.time,game.duration))));
    });
    // Subtract the stored contribution, including legacy STR-derived health,
    // then add only supported hit-point bonuses. Vitality gains remain intact.
    game.choices=game.choices.map(offer=>normalizeUpgradeOffer(game,offer));
    game.zoneSpellOffers=game.zoneSpellOffers.map(offer=>normalizeUpgradeOffer(game,offer));
    migrateZonePacing(game);
    initWaveChampions(game);
    game.refreshEquipmentStats();
    return game;
  }
}

function validateSnapshot(state,catalog={}) {
  const validSlots=new Set([...EQUIPMENT_SLOTS,...(catalog.equipmentSlots||[]).map(s=>s.id)]);
  const fail = () => {
    throw new Error("Unsupported or invalid survivor save.");
  };
  const number = (value, low = -1e9, high = 1e9) =>
    Number.isFinite(value) && value >= low && value <= high;
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(state) || state.version !== 1 || !object(state.player)) fail();
  if(!validZoneState(state,catalog))fail();
  if(state.spellLearningVersion!==undefined&&![1,2].includes(state.spellLearningVersion))fail();
  if(state.levelRerolls!==undefined&&(!Number.isInteger(state.levelRerolls)||!number(state.levelRerolls,0,100000)))fail();
  if(state.areaRoute!==undefined){
    if(!Array.isArray(state.areaRoute))fail();
    if(state.areaRoute.length){
      if(state.areaRoute.length!==Math.min(catalog.areaCount||(state.routeVersion===2?difficultyAreaCount(catalog.areas||[],state.difficulty):6),catalog.areas?.length||0)||new Set(state.areaRoute.map(area=>area?.id)).size!==state.areaRoute.length)fail();
      if(state.routeVersion!==undefined&&![1,2].includes(state.routeVersion))fail();
      if(state.routeVersion===2&&JSON.stringify(state.areaRoute.map(({sourceCoverage,...area})=>area))!==JSON.stringify(chooseProgressiveRoute(catalog.areas,state.areaRoute.length,state.seed)))fail();
      let threat=-Infinity;
      for(const [index,area] of state.areaRoute.entries()){
        const source=catalog.areas?.find(candidate=>candidate.id===area?.id);
        const facetIndex=source?.facets.indexOf(area.facet)??-1;
        if(!source||facetIndex<0||source.zoneIds[facetIndex]!==area.zoneId||area.stage!==index+1||(state.routeVersion!==2&&source.typicalThreat<threat)||area.typicalThreat!==source.typicalThreat)fail();
        threat=source.typicalThreat;
      }
    }
  }
  if (
    !["playing", "paused", "levelup", "dead", "victory"].includes(state.status)
  )
    fail();
  if (
    !number(state.rng, 0, 0xffffffff) ||
    !Number.isInteger(state.rng) ||
    !number(state.seed, 0, 0xffffffff)
  )
    fail();
  if (
    !number(state.duration, 10, 86400) ||
    !number(state.time, 0, 1e7) ||
    !number(state.nextId, 1, 1e9) ||
    !number(state.kills, 0)
  )
    fail();
  if (
    typeof state.archetype !== "string" ||
    !["magic", "arrow", "melee"].includes(state.attackKind)
  )
    fail();
  const p = state.player;
  if(p.sex!==undefined&&!["male","female"].includes(p.sex))fail();
  for (const key of [
    "x",
    "y",
    "hp",
    "maxHp",
    "speed",
    "level",
    "xp",
    "nextXp",
    "gold",
    "armor",
    "radius",
  ])
    if (!number(p[key])) fail();
  if (
    p.hp < 0 ||
    p.hp > p.maxHp ||
    p.maxHp <= 0 ||
    p.maxHp > 1e6 ||
    p.speed < 0 ||
    p.speed > 10000 ||
    !Number.isInteger(p.level) ||
    p.level < 1 ||
    p.level > 10000 ||
    p.xp < 0 ||
    p.nextXp <= 0 ||
    p.gold < 0 ||
    p.radius <= 0
  )
    fail();
  const limits = {
    enemies: 100000,
    projectiles: 10000,
    pickups: 20000,
    effects: 20000,
    inventory: 5000,
    choices: 5,
    shop: 10,
    weapons: 10,
    bossesSpawned: 5,
  };
  for (const [key, limit] of Object.entries(limits))
    if (!Array.isArray(state[key]) || state[key].length > limit) fail();
  if (state.status === "levelup" && state.choices.length !== (state.spellLearningVersion===1&&state.player.level%5===0?5:3)) fail();
  if (
    !object(state.equipment) ||
    !object(state.upgrades) ||
    !object(state.lastDirection)
  )
    fail();
  if (
    !number(state.lastDirection.x, -1, 1) ||
    !number(state.lastDirection.y, -1, 1)
  )
    fail();
  if (
    state.dashDirection &&
    (!number(state.dashDirection.x, -1, 1) ||
      !number(state.dashDirection.y, -1, 1))
  )
    fail();
  if (state.dashTime !== undefined && !number(state.dashTime, 0, 0.18)) fail();
  if(state.regenDelay!==undefined&&!number(state.regenDelay,0,2))fail();
  if(state.lifeLeechClock!==undefined&&!number(state.lifeLeechClock,0,.5))fail();
  if(state.weaponSpellClock!==undefined&&!number(state.weaponSpellClock,0,3600))fail();
  if(state.weaponIdentityVersion!==undefined&&state.weaponIdentityVersion!==1)fail();
  if (p.dashCooldown !== undefined && !number(p.dashCooldown, 0, 3)) fail();
  for (const key of [
    "spawnClock",
    "attackClock",
    "novaClock",
    "chainClock",
    "shopClock",
    "hitClock",
  ])
    if (!number(state[key])) fail();
  if (
    state.viewport &&
    (!number(state.viewport.width, 1, 10000) ||
      !number(state.viewport.height, 1, 10000))
  )
    fail();
  for (const key of ["enemies", "projectiles", "pickups", "effects"]) {
    for (const entity of state[key]) {
      if (
        !object(entity) ||
        !number(entity.x) ||
        !number(entity.y) ||
        (entity.z!==undefined&&!number(entity.z,-1024,1024)) ||
        !number(entity.radius, 0, 10000)
      )
        fail();
      if (
        key === "enemies" &&
        (!number(entity.hp) ||
          !number(entity.maxHp, 1) ||
          !number(entity.speed, 0, 10000) ||
          !number(entity.damage, 0) ||
          (entity.splashRadius!==undefined&&!number(entity.splashRadius,0,100)) ||
          !number(entity.xp, 0) ||
          !number(entity.cooldown))
      )
        fail();
      if (
        key === "enemies" &&
        ((entity.hue !== undefined &&
          (!Number.isInteger(entity.hue) || !number(entity.hue, 0, 0xffff))) ||
          (entity.baseHue !== undefined &&
            (!Number.isInteger(entity.baseHue) ||
              !number(entity.baseHue, 0, 0xffff))) ||
          (entity.partialHue !== undefined &&
            typeof entity.partialHue !== "boolean") ||
          (entity.basePartialHue !== undefined &&
            typeof entity.basePartialHue !== "boolean") ||
          (entity.modifier !== undefined && entity.modifier !== "paragon"))
      )
        fail();
      if (
        key === "projectiles" &&
        (!number(entity.vx) ||
          !number(entity.vy) ||
          !number(entity.life, 0) ||
          !number(entity.damage, 0) ||
          (entity.splashRadius!==undefined&&!number(entity.splashRadius,0,100)) ||
          (!entity.hostile && !Array.isArray(entity.hits)))
      )
        fail();
      if (
        key === "pickups" &&
        (!["xp", "gold", "heal", "loot", "ore", ...Object.keys(POWERUPS)].includes(entity.kind) ||
          (entity.kind !== "loot" && !number(entity.value, 0)))
      )
        fail();
      if (
        key === "effects" &&
        (!number(entity.life, 0) || !number(entity.maxLife, 0))
      )
        fail();
    }
  }
  for (const item of [
    ...state.inventory,
    ...state.shop,
    ...state.pickups
      .filter((pickup) => pickup.kind === "loot")
      .map((pickup) => pickup.item),
  ]) {
    if (
      !object(item) ||
      !number(item.uid, 1) ||
      !(validSlots.has(item.slot)||item.slot==='potion') ||
      !number(item.price, 0) ||
      typeof item.name !== "string"
    )
      fail();
    if (
      item.slot !== "potion" &&
      (!number(item.power, 0) || !number(item.defense, 0))
    )
      fail();
    if(item.hue!==undefined&&(!Number.isInteger(item.hue)||!number(item.hue,0,65535)))fail();
    if(item.itemId!==undefined&&(!Number.isInteger(item.itemId)||!number(item.itemId,0,0x1ffff)))fail();
    if(item.grantedSpell!==undefined&&(item.slot!=='weapon'||!SPELLS.some(s=>s.id===item.grantedSpell)))fail();
    if(!validSpellLevels(item)||Object.keys(item.spellLevels||{}).some(id=>!SPELLS.some(s=>s.id===id)))fail();
    if(item.weaponTrait!==undefined&&(item.slot!=='weapon'||!Object.hasOwn(WEAPON_TRAITS,item.weaponTrait)))fail();
    if(item.weaponIdentityVersion!==undefined&&item.weaponIdentityVersion!==1)fail();
    for(const field of ['aosAttributes','weaponAttributes','armorAttributes','resistances','weaponBonuses'])if(item[field]!==undefined){if(!object(item[field])||Object.keys(item[field]).length>128||Object.values(item[field]).some(v=>!number(v,-1000,10000)))fail();}
  }
  for (const choice of state.choices)
    if (
      !object(choice) ||
      !UPGRADES.some((upgrade) => upgrade.id === choice.id) && !GLOBAL_SPELL_UPGRADES.some(def=>choice.id==='global:'+def.key) && !MAGERY_BOOK.some(spell=>(spell.available||RETIRED_SPELLS.has(spell.id))&&(choice.id==='spell:'+spell.id||choice.id==='spell:'+spell.id+':'+choice.upgradeKind))
    )
      fail();
  const uids = new Set(state.inventory.map((item) => item.uid));
  for(const [slot,uid]of Object.entries(state.equipment)){
    if(!validSlots.has(slot)||(uid!==null&&!uids.has(uid)))fail();
    if(uid!==null&&state.inventory.find(i=>i.uid===uid)?.slot!==slot)fail();
  }
  if(!validSpellState(state)||!validGoldOre(state))fail();
  for(const enemy of state.enemies){
    for(const key of ['mana','maxMana'])if(enemy[key]!==undefined&&!number(enemy[key],0,10000))fail();
    for(const key of ['castClock','breathClock','contactPoisonClock'])if(enemy[key]!==undefined&&!number(enemy[key],-1e9,60))fail();
    if(enemy.arrival!==undefined&&!number(enemy.arrival,0,5))fail();
    for(const flag of ['captain','elite','packChampion'])if(enemy[flag]!==undefined&&typeof enemy[flag]!=='boolean')fail();
    if(enemy.behavior!==undefined){const b=enemy.behavior;if(!object(b)||['caster','archer','breath'].some(k=>typeof b[k]!=='boolean')||!(b.poison===null||['Lesser','Regular','Greater','Deadly','Lethal'].includes(b.poison))||!number(b.poisonChance,0,1)||!number(b.magery,0,1000)||!number(b.mana,0,100000))fail();}
  }
  for(const key of ['mana','maxMana'])if(state.player[key]!==undefined&&!number(state.player[key],0,100000))fail();
  if(state.player.poison!==undefined&&state.player.poison!==null){const poison=state.player.poison;if(!object(poison)||!Number.isInteger(poison.level)||!number(poison.level,1,5)||!number(poison.tick,-1,2)||!number(poison.damage,0,100))fail();}
  if(state.player.poisonUntil!==undefined&&!number(state.player.poisonUntil,0,1000000))fail();
  if(state.legacyBonuses!==undefined){if(!object(state.legacyBonuses)||Object.keys(state.legacyBonuses).some(id=>!["power","vitality","magnet"].includes(id)))fail();for(const id of ["power","vitality","magnet"])if(!Number.isInteger(state.legacyBonuses[id])||!number(state.legacyBonuses[id],0,5))fail();}
  if(state.difficulty!==undefined&&!Object.hasOwn(DIFFICULTIES,state.difficulty))fail();
  if(state.autoequip!==undefined&&typeof state.autoequip!=='boolean')fail();
  if(state.shopRestocks!==undefined&&(!Number.isInteger(state.shopRestocks)||!number(state.shopRestocks,0,100000)))fail();
  if(state.encounterVersion!==undefined&&state.encounterVersion!==1)fail();
  if(state.monsterStatsVersion!==undefined&&state.monsterStatsVersion!==1)fail();
  if(state.enemyGlobalCastClock!==undefined&&!number(state.enemyGlobalCastClock,0,2))fail();
  if(state.pendingEnemyCasts!==undefined&&(!Array.isArray(state.pendingEnemyCasts)||state.pendingEnemyCasts.length>2||state.pendingEnemyCasts.some(cast=>!object(cast)||!number(cast.id,1,1e9)||!number(cast.ownerId,1,1e9)||!number(cast.x)||!number(cast.y)||!number(cast.remaining,0,2)||!number(cast.delay,.1,2)||!number(cast.radius,1,80)||!number(cast.damage,0,1e6)||!['harm','lightning','mind-blast','explosion','flame-strike'].includes(cast.spellId)||cast.kind!==cast.spellId||!['Cold','Energy','Fire'].includes(cast.element))))fail();
  for(const enemy of state.enemies)if(enemy.serverStats!==undefined){
    const stats=enemy.serverStats;
    if(!object(stats)||['str','dex','int','hits','damage','damageMin','damageMax'].some(key=>!number(stats[key],0,1e6))||!(stats.mana===null||number(stats.mana,0,10000))||!object(stats.resistances)||Object.keys(stats.resistances).length>10||Object.values(stats.resistances).some(value=>!number(value,0,1000)))fail();
  }
  const validOutfit=outfit=>Array.isArray(outfit)&&outfit.length<=32&&outfit.every(item=>object(item)&&number(item.itemId,0,65535)&&Number.isInteger(item.itemId)&&number(item.hue,0,65535)&&Number.isInteger(item.hue)&&typeof item.slot==='string'&&(validSlots.has(item.slot)||['hair','beard'].includes(item.slot)));
  for(const entity of [...state.enemies,...(state.corpses||[])])if(entity.equipment!==undefined&&!validOutfit(entity.equipment))fail();
  if(state.championMarks!==undefined&&(!Array.isArray(state.championMarks)||state.championMarks.length>2048||new Set(state.championMarks).size!==state.championMarks.length||state.championMarks.some(mark=>!number(mark,0,state.duration))))fail();
  if(state.buffs!==undefined){if(!object(state.buffs)||Object.keys(state.buffs).length>4)fail();for(const [id,buff]of Object.entries(state.buffs))if(!POWERUPS[id]||id==='heal-percent'||!object(buff)||!number(buff.remaining,0,POWERUPS[id].duration)||buff.duration!==POWERUPS[id].duration||!number(buff.value,0,POWERUPS[id].value))fail();}
  for(const drop of state.pickups)if(drop.life!==undefined&&!number(drop.life,0,180))fail();
  if(state.autosell!==undefined&&!['off','inferior','common'].includes(state.autosell))fail();
  if(state.gearHpBonus!==undefined&&!number(state.gearHpBonus,-1000,10000))fail();
  if(state.corpses!==undefined){if(!Array.isArray(state.corpses)||state.corpses.length>180)fail();for(const c of state.corpses)if(!object(c)||!number(c.x)||!number(c.y)||(c.z!==undefined&&!number(c.z,-1024,1024))||!number(c.body,0,65535)||!number(c.life,0,35)||!number(c.maxLife,0,35)||!number(c.hue,0,65535)||!number(c.dx)||!number(c.dy))fail();}

  for (const [id, level] of Object.entries(state.upgrades))
    if (
      !UPGRADES.some((upgrade) => upgrade.id === id) ||
      !number(level, 0, 10000) ||
      !Number.isInteger(level)
    )
      fail();
  // Reject non-finite nested values and prototype-shaped fields before copying.
  let count = 0;
  const visit = (value, depth = 0) => {
    if (++count > 10000000 || depth > 16) fail();
    if (typeof value === "number" && !number(value, -1e12, 1e12)) fail();
    if (typeof value === "string" && value.length > 10000) fail();
    if (value && typeof value === "object")
      for (const key of Object.keys(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail();
        visit(value[key], depth + 1);
      }
  };
  visit(state);
}

export default Game;
