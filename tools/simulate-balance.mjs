import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Game} from '../game/core.mjs';
import {createLocationMap} from '../game/location-map.mjs';
import {settleBiome} from '../game/map-navigation.mjs';
import {chooseSpell,SPELLS} from '../game/spell-system.mjs';
import {chooseSuperUpgrade,superUpgradeOptions} from '../game/spell-upgrades.mjs';
import {enterZoneSpellShop,finishZoneSpellShop,advanceZone} from '../game/zone-run.mjs';
import {itemScore} from '../game/equipment.mjs';
import {findPath} from '../game/pathfinding.mjs';
import {observeCombat} from './balance-telemetry.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const list=(key,fallback)=>String(args[key]||fallback).split(',');
const catalog=JSON.parse(await readFile('game/data/catalog.json','utf8'));
catalog.areas=JSON.parse(await readFile('game/data/areas.json','utf8')).areas;catalog.zoneMode=true;delete catalog.areaCount;
const maps=JSON.parse(await readFile('game/assets/mobile-locations/manifest.json','utf8')),cache=new Map();
const round=n=>Number(n.toFixed(3)),dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const dt=1/Number(args.hz||60),mode=args.mode||'campaign',out=args.output||'research/balance';
const horizon=Number(args.seconds||420),maxAreas=Number(args.areas||3),wallBudget=Number(args['wall-seconds']||90);
const sourceHashes={};for(const file of ['core','combat-types','spell-upgrades','spell-system','zone-progression','zone-pacing','zone-run','map-navigation','location-map','location-height','pathfinding'])sourceHashes[file]=createHash('sha256').update(await readFile(`game/${file}.mjs`)).digest('hex');
sourceHashes.simulator=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
sourceHashes.telemetry=createHash('sha256').update(await readFile(new URL('./balance-telemetry.mjs',import.meta.url))).digest('hex');
async function attach(g,terrain){
 if(terrain==='open'){
  g.player.x=g.player.y=0;g.isPassable=g.elevationAt=g.clearSight=g.enemyWaypoint=g.blockedActor=g.canTraverse=null;
  g.spawnLocation=(_area,radius,boss,opts={})=>{const angle=Number.isFinite(opts.spawnAngle)?opts.spawnAngle:g.random()*Math.PI*2,r=Math.max(radius+50,140+g.random()*100);return {x:g.player.x+Math.cos(angle)*r,y:g.player.y+Math.sin(angle)*r};};return;
 }
 const id=g.currentArea().id;
 if(!cache.has(id)){const manifest=JSON.parse(await readFile('game/'+maps.areas[id].src,'utf8'));cache.set(id,createLocationMap(manifest,{}));if(cache.size>6)cache.delete(cache.keys().next().value);}
 const map=cache.get(id),spawn=map.manifest.regions[0].spawn;
 Object.assign(g.player,map.nearestPlayable(spawn.x,spawn.y));
 g.elevationAt=map.elevationAt;g.isPassable=map.isPlayable;g.nearestPassable=map.nearestPlayable;g.areaAt=map.areaAt;
 g.spawnLocation=(_area,radius,boss,opts={})=>map.randomSpawn(()=>g.random(),g.player,radius,boss,{...g.viewport,angle:opts.spawnAngle,spread:opts.spawnSpread});
 settleBiome(g,map,{cancelCasts:false});
}
const spellPriority=['fire-field','chain-lightning','greater-heal','earthquake','meteor-swarm','heal','energy-bolt','arch-protection','flame-strike','magic-reflection'];
function value(g,c,build){
 const need=g.player.hp/g.player.maxHp,defense=build==='defense';
 if(!c.upgradeKind&&c.type==='spell'){let n=spellPriority.indexOf(c.spellId);if(defense&&['heal','greater-heal','arch-protection'].includes(c.spellId))n-=15;return 60-(n<0?25:n)*2;}
 if(c.type==='spell')return ({damage:23,area:19,haste:20,duration:7,targets:20}[c.upgradeKind]||0)+(g.spellLoadout.find(i=>i.id===c.spellId)?.upgradeCount<5?2:0);
 if(c.type==='global')return ({physical:g.attackKind==='melee'?18:7,elemental:17,area:18,haste:19,duration:8,potency:12}[c.globalKey]||0);
 return ({power:18,haste:21,vitality:need<.55?40:14,speed:7,magnet:g.heroUpgradeBonus('magnet')<.5?20:5,multishot:22,regen:need<.7?30:15,armor:12}[c.id]||0)+(defense&&['regen','armor','vitality'].includes(c.id)?18:0);
}
function resolveRewards(g,build){
 for(let n=0;n<100;n++){
  if(g.pendingSpellSupers?.length){const p=g.pendingSpellSupers[0],item=g.spellLoadout.find(i=>i.id===p.spellId),s=SPELLS.find(s=>s.id===p.spellId);chooseSuperUpgrade(g,superUpgradeOptions(s,item)[1].id,SPELLS);continue;}
  if(g.status!=='levelup')break;
  const choices=g.choices.map((c,i)=>({i,v:value(g,c,build)})).sort((a,b)=>b.v-a.v);
  let ok=false;for(const c of choices){if(g.choices[c.i].requiresReplacement)continue;if(g.chooseUpgrade(c.i)){ok=true;break;}}
  if(!ok){g.skipNewSpell();break;}
 }
}
function equipBest(g){
 for(const item of [...g.inventory]){
  if(!item.slot||item.slot==='robe')continue;const old=g.equipped(item.slot);
  const score=i=>itemScore(i)+(g.attackKind==='magic'&&i.grantedSpell?40:0);
  if(!old||score(item)>score(old))g.equip(g.inventory.indexOf(item));
 }
}
function shop(g,build){
 enterZoneSpellShop(g);equipBest(g);
 const potion=g.shop.findIndex(i=>i.slot==='potion');if(g.player.hp<g.player.maxHp*.6&&potion>=0)g.buy(potion);
 for(let n=0;n<100;n++){
  resolveRewards(g,build);const offers=g.zoneSpellOffers.map((c,i)=>({i,v:value(g,c,build),cost:g.zoneUpgradePrice(c)})).filter(c=>c.cost<=g.player.gold).sort((a,b)=>b.v-a.v);
  if(!offers.length||!g.buyZoneSpell(offers[0].i))break;
 }
 finishZoneSpellShop(g);advanceZone(g);
}
function steer(g,motion){
 if(motion==='stand')return {x:0,y:0};
 const p=g.player,near=g.enemies.filter(e=>e.hp>0&&dist(p,e)<330),drops=g.pickups.filter(d=>d.kind==='xp'||d.kind==='loot'||d.kind==='gold'),goal=drops.sort((a,b)=>dist(a,p)-dist(b,p))[0];
 const origin={x:p.x,y:p.y},drift=g.time*.19;
 let best={x:Math.cos(drift),y:Math.sin(drift)},top=-Infinity;
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8,x=Math.cos(a),y=Math.sin(a),point={x:p.x+x*55,y:p.y+y*55};
  if(!g.canWalk(p,point.x,point.y,p.radius*.5))continue;
  let score=goal?(dist(origin,goal)-dist(point,goal))*.3:Math.cos(a-drift)*3;
  for(const e of near){const d=dist(point,e)-e.radius-p.radius;score-=Math.max(0,(g.attackKind==='melee'?40:100)-d)**2/70;}
  if(g.attackKind==='melee'&&near.length)score+=Math.max(0,95-Math.min(...near.map(e=>dist(point,e))))*.25;
  for(const cast of g.pendingEnemyCasts)score-=Math.max(0,cast.radius+35-dist(point,cast))*10;
  if(score>top){top=score;best={x,y};}
 }
 return best;
}
function stressBuild(g,index,build){
 const levels=1+index*7,budget=index*10,defense=build==='defense';
 const spells=defense?['heal','greater-heal','arch-protection',...spellPriority.filter(s=>!['heal','greater-heal','arch-protection','magic-reflection'].includes(s))]:spellPriority;
 for(const id of spells.slice(0,Math.min(10,Math.floor(levels/5))))chooseSpell(g,id);
 for(let n=0;n<budget;n++){
  const id=(defense?['regen','vitality','armor','regen','vitality','armor','power','haste','multishot','magnet']:['power','haste','multishot','vitality','regen','armor','power','haste','magnet','speed'])[n%10];
  g.applyPassiveUpgrade({id,rarity:['common','uncommon','rare','epic','uncommon'][n%5]});
 }
 for(let n=0;n<index*5;n++){g.dropLoot({captain:true,x:g.player.x,y:g.player.y,radius:12});const chest=g.pickups.pop();if(chest?.item)g.acquireItem(chest.item);}
 equipBest(g);g.player.level=levels;g.player.nextXp=Math.round(18*Math.pow(levels,1.3));g.player.hp=g.player.maxHp;
 return {estimatedLevels:levels,legalPassiveCards:budget,generatedLeaderChests:index*5};
}
const stats=g=>({level:g.player.level,hp:round(g.player.hp),maxHp:round(g.player.maxHp),regen:round(g.baseRegeneration),regenNow:round(g.regeneration),resistances:g.resistances,armor:g.armor,damageBonuses:{Physical:g.damageBonus('Physical').total,Elemental:g.damageBonus('Elemental').total},attackInterval:round(g.attackInterval),passives:g.heroStatUpgrades,spells:g.spellLoadout.map(s=>({id:s.id,improvements:s.upgradeCount||0})),gold:g.player.gold});
async function simulate(config){
 const {seed,archetype,difficulty,motion,terrain,build,index=0}=config,g=new Game(catalog,{seed,archetype,difficulty});g.setViewport(960,700);g.zoneRun.index=index;
 const assigned=mode==='stress'?stressBuild(g,index,build):null;await attach(g,terrain);
 const totals=observeCombat(g),start=performance.now(),initial=stats(g),areas=[],positions=new WeakMap();let input={},nextSteer=0,nextSample=0,reason='horizon',areaStart=g.time,wallAbort=false;
 const snapshot=()=>({index:g.zoneRun.index+1,area:g.currentArea().name,seconds:round(g.time-areaStart),killed:g.zoneRun.killed,spawned:g.zoneRun.spawned,bossSpawned:g.zoneRun.bossSpawned,bossKilled:g.zoneRun.bossKilled,bossHp:g.enemies.find(e=>e.zoneBoss&&e.hp>0)?.hp??null,monsterTarget:g.zoneScale.targetHp,monsterDamage:g.zoneScale.targetDamage,...stats(g)});
 while(g.time<horizon&&g.status!=='dead'&&g.status!=='victory'){
  resolveRewards(g,build);if(g.status!=='playing'){reason='reward-blocked';break;}
  if(g.zoneRun.phase==='cleared'&&(mode!=='stress'||g.zoneRun.gateRemaining<15)){
   areas.push(snapshot());if(mode==='stress'||areas.length>=maxAreas){reason='cleared';break;}
   shop(g,build);if(g.status==='victory')break;await attach(g,terrain);areaStart=g.time;continue;
  }
  if(g.time>=nextSteer){input=steer(g,motion);nextSteer=g.time+.2;}
  const before=g.player.hp,damage=totals.damageTaken;g.update(dt,input);
  totals.healing+=Math.max(0,g.player.hp-before+totals.damageTaken-damage);
  if(g.enemies.some(e=>e.hp>0&&dist(e,g.player)<e.radius+g.player.radius+3))totals.contactSeconds+=dt;
  totals.maxAlive=Math.max(totals.maxAlive,g.enemies.length);
  if(g.time>=nextSample){
   equipBest(g);for(const e of g.enemies){const old=positions.get(e);if(old&&g.time-old.time>=4){totals.enemySamples++;if(!e.behavior.caster&&!e.behavior.archer&&dist(e,g.player)>e.radius+g.player.radius+8&&dist(old,e)<6)totals.stalledSamples++;positions.set(e,{x:e.x,y:e.y,time:g.time});}else if(!old)positions.set(e,{x:e.x,y:e.y,time:g.time});}
   nextSample=g.time+1;if(performance.now()-start>wallBudget*1000){reason='wall-budget';wallAbort=true;break;}
  }
 }
 if(g.status==='dead')reason=g.zoneRun.gateExpired?'gate-expired':'dead';if(g.status==='victory')reason='victory';
 if(!areas.length||areas.at(-1).index!==g.zoneRun.index+1)areas.push(snapshot());
 const diagnostics=[];
 if(args.diagnostics&&terrain==='native')for(const e of g.enemies.filter(e=>e.hp>0&&dist(e,g.player)>40).slice(0,8)){
  const pass=Object.assign((x,y)=>g.canStand(x,y,e.radius*.5),{canTraverse:g.canTraverse});
  const waypoint=g.enemyWaypoint?.(e,g.player),wp=waypoint||g.player,d=dist(e,wp),nx=e.x+(wp.x-e.x)/Math.max(1,d)*e.speed/60,ny=e.y+(wp.y-e.y)/Math.max(1,d)*e.speed/60;
  diagnostics.push({type:e.type,speed:e.speed,moving:e.moving,waypoint,walks:g.canWalk(e,nx,ny,e.radius*.5),x:e.x,y:e.y,radius:e.radius,distance:dist(e,g.player),player:{x:g.player.x,y:g.player.y},goalFits:pass(g.player.x,g.player.y),path12:findPath(e,g.player,pass,{step:12,limit:6000})?.length??null,path8:findPath(e,g.player,pass,{step:8,limit:24000})?.length??null});
 }
 return {...config,assigned,reason,wallAbort,seconds:round(g.time),wallSeconds:round((performance.now()-start)/1000),initial,final:stats(g),kills:g.kills,areas,diagnostics,metrics:{...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,round(v)])),incomingDps:round(totals.damageTaken/Math.max(1,g.time)),healingPerSecond:round(totals.healing/Math.max(1,g.time)),outgoingDps:round(totals.damageDealt/Math.max(1,g.time)),stalledFraction:round(totals.stalledSamples/Math.max(1,totals.enemySamples))}};
}
const runs=[];await mkdir(out,{recursive:true});
if(mode==='navigation'){
 const g=new Game(catalog,{seed:712,difficulty:'hard',archetype:'warrior'}),rows=[],originalEffect=g.effect.bind(g);
 for(let index=0;index<g.areaRoute.length;index++){
  g.zoneRun.index=index;g.zoneRun.phase='spellshop';g.enemies=[];g.time=0;g.spawnClock=g.attackClock=g.weaponSpellClock=99999;await attach(g,'native');
  let recoveries=0;g.effect=(...args)=>{if(args[4]==='teleport')recoveries+=.5;originalEffect(...args);};
  const start=performance.now(),probes=[];
  for(const radius of [14,22.4])for(let n=0;n<4;n++){
   const point=g.spawnLocation(g.currentArea(),radius,false);if(!point)continue;
   const e={...point,id:probes.length+1,type:'navigation-probe',radius,hp:1e6,maxHp:1e6,speed:90,damage:0,xp:0,cooldown:999,behavior:{caster:false,archer:false,breath:false,poison:null},mana:0,maxMana:0,castClock:999,breathClock:999};g.enemies.push(e);probes.push(e);
  }
  let timeout=false;for(let n=0;n<60*Number(args.seconds||35)&&g.enemies.length;n++){
   g.update(1/60);g.enemies=g.enemies.filter(e=>dist(e,g.player)>e.radius+g.player.radius+3);
   if(n%60===0&&performance.now()-start>wallBudget*1000){timeout=true;break;}
  }
  const row={area:g.currentArea().name,id:g.currentArea().id,probes:probes.length,reached:probes.length-g.enemies.length,recoveries,remaining:g.enemies.map(e=>({radius:e.radius,distance:round(dist(e,g.player)),x:e.x,y:e.y})),seconds:round(g.time),wallSeconds:round((performance.now()-start)/1000),timeout};rows.push(row);console.log(JSON.stringify(row));
  await writeFile(`${out}/navigation.json`,JSON.stringify({sourceHashes,note:'Eight common/large melee movement probes per native area. No damage or combat conclusions. Bounded 35-second detour test; remaining probes are investigated, not automatically declared unreachable.',rows},null,2)+'\n');
 }
 process.exit(0);
}
for(const seed of list('seeds','712').map(Number))for(const difficulty of list('difficulties','easy,normal,hard'))for(const archetype of list('classes','mage,warrior,archer'))for(const motion of list('motions','stand,kite'))for(const terrain of list('terrain','open'))for(const build of list('builds','balanced'))for(const index of (mode==='stress'?list('checkpoints','5,10,20').map(n=>n-1):[0])){
 const length=difficulty==='easy'?20:difficulty==='normal'?35:catalog.areas.length;if(index>=length)continue;
 const result=await simulate({seed,difficulty,archetype,motion,terrain,build,index});runs.push(result);console.log(JSON.stringify({run:runs.length,...Object.fromEntries(['difficulty','archetype','motion','terrain','build','index','reason','seconds','wallSeconds','kills'].map(k=>[k,result[k]])),level:result.final.level,hp:result.final.hp,regen:result.final.regen,stalled:result.metrics.stalledFraction}));
 await writeFile(`${out}/runs.json`,JSON.stringify({mode,dt,sourceHashes,notes:['Campaign rewards, loot, XP and shops use actual game rules. Bots are heuristics, not skilled human players.','Gate travel is abstracted after a kill; no free healing or gold is given. Mining is omitted.','Open terrain isolates combat; native uses actual map heights, line of sight, spawn rules and enemy navigation.','Stress builds are explicitly synthetic upper-bound allocations, not claimed reachable campaign checkpoints.','Healing metric covers active-play regeneration, spells and pickups; reward-menu vitality gains are excluded.','Wall-budget runs are incomplete and must never count as successful survival.'],runs},null,2)+'\n');
}
const columns=['seed','difficulty','archetype','motion','terrain','build','index','reason','seconds','kills','level','hp','maxHp','regen','incomingDps','healingPerSecond','outgoingDps','stalledFraction'];
await writeFile(`${out}/runs.csv`,columns.join(',')+'\n'+runs.map(r=>columns.map(k=>r[k]??r.final[k]??r.metrics[k]??'').join(',')).join('\n')+'\n');
