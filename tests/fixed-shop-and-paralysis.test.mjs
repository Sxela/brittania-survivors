import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {rollZoneSpells,buyZoneSpell} from '../game/zone-run.mjs';
import {UPGRADE_RARITIES} from '../game/spell-upgrades.mjs';
import {chooseSpell,tickSpellSystem,spellBlocksMovement,spellCooldown} from '../game/spell-system.mjs';
import {canOpenLootChest} from '../game/loot-chests.mjs';
import {mapPoint} from '../game/map-regions.mjs';
import {rarityRank,rarestFirst} from '../game/reward-rules.mjs';
const rat={id:'rat',className:'Rat',name:'Rat',body:238,stats:{hits:[2000,2000],damage:[2,2]},adaptation:{hp:2000,damage:2,xp:1,speed:20,radius:12}};
const area={id:'rats',name:'Rats',combatClasses:['Rat'],facets:['Trammel'],zoneIds:['rats'],typicalThreat:1,maximumThreat:1};
const catalog={monsters:[rat],areas:[area],zoneMode:true};
function fixture(){const g=new Game(catalog,{seed:22});g.autosell='off';g.autoequip=false;g.player.gold=100000;return g;}

test('equipment and upgrade lists share rarest-first ordering, including level rewards and resumed offers',()=>{
 const items=['common','magic','epic','rare','legendary','artifact','uncommon'].map(rarity=>({rarity}));
 assert.deepEqual(items.sort(rarestFirst).map(i=>i.rarity),['artifact','legendary','epic','rare','magic','uncommon','common']);
 let mixed=0;
 for(let seed=1;seed<=40;seed++){
  const g=new Game({}, {seed});g.player.level=3;g.status='levelup';g.rollChoices();const ranks=g.choices.map(rarityRank);
  assert.deepEqual(ranks,[...ranks].sort((a,b)=>b-a));if(new Set(ranks).size>1)mixed++;
  assert.deepEqual(Game.restore({},g.snapshot()).choices.map(c=>c.id),g.choices.map(c=>c.id));
 }
 assert(mixed>0);
});

test('end-of-area cards keep all five positions across purchases and reload, rarest first, and reroll only after full purchase or request',()=>{
 let g=fixture();g.zoneRun.phase='spellshop';g.zoneRun.bossSpawned=g.zoneRun.bossKilled=true;rollZoneSpells(g);
 const initial=structuredClone(g.zoneSpellOffers),ranks=initial.map(o=>UPGRADE_RARITIES.findIndex(r=>r.id===o.rarity));assert.equal(initial.length,5);assert.deepEqual(ranks,[...ranks].sort((a,b)=>b-a));
 assert(buyZoneSpell(g,0));assert.equal(buyZoneSpell(g,0),false);assert.equal(g.zoneSpellOffers[0].purchased,true);
 assert.deepEqual(g.zoneSpellOffers.slice(1),initial.slice(1));g=Game.restore(catalog,g.snapshot());assert.equal(g.zoneSpellOffers[0].purchased,true);assert.deepEqual(g.zoneSpellOffers.map(o=>o.id),initial.map(o=>o.id));
 for(let i=1;i<5;i++)assert(buyZoneSpell(g,i));assert.equal(g.zoneSpellOffers.length,5);assert(g.zoneSpellOffers.every(o=>!o.purchased));
 const previous=g.zoneSpellOffers;assert(g.rerollZoneSpells());assert.notEqual(g.zoneSpellOffers,previous);
});
test('equipment shop keeps sold slots until its five items are bought, without duplicate owned identifiers',()=>{
 let g=fixture();const ids=g.shop.map(i=>i.uid);assert.equal(ids.length,5);assert(g.buy(0));assert.equal(g.shop[0].sold,true);assert.equal(g.buy(0),false);assert.deepEqual(g.shop.slice(1).map(i=>i.uid),ids.slice(1));
 g=Game.restore(catalog,g.snapshot());assert.equal(g.shop[0].sold,true);for(let i=1;i<5;i++)assert(g.buy(i));assert(g.shop.every(i=>!i.sold));
 const all=[...g.shop,...g.inventory].map(i=>i.uid);assert.equal(new Set(all).size,all.length);
});
test('loot automatically collects on each adjacent original tile, with no pickup beyond it or across walls/floors',()=>{
 for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){
  const g=fixture();Object.assign(g.player,mapPoint(10.5,10.5));const p=mapPoint(10.5+a,10.5+b),item={uid:g.nextId++,id:'ring',name:'Ring',slot:'ring',price:20,power:0,defense:0};
  const chest={id:g.nextId++,kind:'loot',...p,z:0,item};g.pickups=[chest];assert(canOpenLootChest(g,chest));g.spawnClock=999;g.update(.01);assert(!g.pickups.includes(chest));assert(g.inventory.some(i=>i.uid===item.uid));
 }
 const g=fixture(),chest={kind:'loot',...mapPoint(12.5,10.5),item:{}};Object.assign(g.player,mapPoint(10.5,10.5));assert(!canOpenLootChest(g,chest));Object.assign(chest,mapPoint(11.5,10.5));g.clearSight=()=>false;assert(!canOpenLootChest(g,chest));g.clearSight=()=>true;g.elevationAt=()=>20;chest.z=0;assert(!canOpenLootChest(g,chest));
});
test('passable paralysis field freezes normal mobs for its remaining life despite damage, with boss cap and immunity after expiry',()=>{
 const g=fixture();g.spawnLocation=()=>({x:80,y:0});const enemy=g.spawnEnemy(rat,false,false,{zoneEncounter:true});enemy.arrival=0;
 assert(chooseSpell(g,'paralyze-field').ok);tickSpellSystem(g,.01);const f=g.spellFields.find(f=>f.kind==='paralyze-field');
 assert(f.life<=4);assert.equal(spellBlocksMovement(g,enemy.x,enemy.y,12),false);assert(g.canStand(enemy.x,enemy.y,12));
 assert(Math.abs(enemy.spellFrozenUntil-g.time-f.life)<1e-8);const until=enemy.spellParalyzedUntil;g.hurtEnemy(enemy,1);assert.equal(enemy.spellParalyzedUntil,until);
 const immunity=enemy.spellFieldImmunityUntil;g.time=until+.01;f.life=3;f.tick=0;tickSpellSystem(g,.01);assert.equal(enemy.spellParalyzedUntil,until);assert(immunity>g.time);
 g.time=immunity+.01;enemy.boss=true;f.tick=0;tickSpellSystem(g,.01);assert(enemy.spellFrozenUntil-g.time<=1);
 assert(spellCooldown('paralyze-field',100,{id:'paralyze-field',rank:100,statUpgrades:{haste:18}})>=8);
});
test('frozen enemies cannot move toward the player or inflict contact damage until expiry',()=>{
 const g=new Game({monsters:[rat]},{seed:3});g.enemies=[];g.spawnClock=g.attackClock=g.novaClock=g.chainClock=9999;g.isPassable=()=>true;
 const enemy=g.spawnEnemy(rat);enemy.arrival=0;enemy.x=g.player.x+1;enemy.y=g.player.y;enemy.damage=100;enemy.spellFrozenUntil=enemy.spellParalyzedUntil=1;enemy.castClock=999;
 const hp=g.player.hp,x=enemy.x,y=enemy.y;g.update(.1);assert.equal(g.player.hp,hp);assert.equal(enemy.x,x);assert.equal(enemy.y,y);assert.equal(enemy.moving,false);
 g.time=1.1;g.update(.1);assert(g.player.hp<hp);
});
test('direct Paralyze covers a visible area, stops at walls and cannot chain immediately',()=>{
 const g=fixture();g.spawnLocation=()=>({x:80,y:0});const enemies=[0,75,180].map(dx=>{const e=g.spawnEnemy(rat,false,false,{zoneEncounter:true});e.x+=dx;e.arrival=0;return e;});
 chooseSpell(g,'paralyze');tickSpellSystem(g,.01);assert(enemies[0].spellParalyzedUntil>g.time);assert(enemies[1].spellParalyzedUntil>g.time);assert.equal(enemies[2].spellParalyzedUntil,undefined);
 const until=enemies[0].spellParalyzedUntil;g.spellLoadout[0].cooldown=0;tickSpellSystem(g,.01);assert.equal(enemies[0].spellParalyzedUntil,until);g.hurtEnemy(enemies[0],1);assert.equal(enemies[0].spellParalyzedUntil,0);
 const blocked=g.spawnEnemy(rat,false,false,{zoneEncounter:true});blocked.arrival=0;blocked.x=90;blocked.y=40;g.clearSight=(a,b)=>b!==blocked;g.time+=10;g.spellLoadout[0].cooldown=0;tickSpellSystem(g,.01);assert.equal(blocked.spellParalyzedUntil,undefined);
 assert(spellCooldown('paralyze',100,{id:'paralyze',rank:100,statUpgrades:{haste:18}})>=5);
});
