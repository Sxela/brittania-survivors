import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,GAME_DEFAULTS} from '../game/core.mjs';
// These mechanics tests interact with creatures on the tick they spawn.
GAME_DEFAULTS.enemyArrival=0;
import {tickZoneRun} from '../game/zone-run.mjs';
const rat={id:'rat',className:'Rat',name:'Rat',body:238,stats:{hits:[20,20],damage:[2,2]},adaptation:{hp:20,damage:2,xp:1,speed:20,radius:12}};
const catalog={monsters:[rat],items:[{id:'sword',name:'Sword',slot:'weapon',itemId:1,stats:{MinDamage:5,MaxDamage:8}}],areas:[{id:'rats',name:'Rats',combatClasses:['Rat'],facets:['Trammel'],zoneIds:['rats'],typicalThreat:1,maximumThreat:1}],zoneMode:true};
function fixture(){const g=new Game(catalog,{seed:22});g.spawnLocation=()=>({x:300,y:300});g.autosell='off';g.autoequip=false;return g;}

test('every timed wave has its own champion, including boss and reinforcement waves',()=>{
 const g=fixture();for(let wave=1;wave<=6;wave++){g.zoneRun.pressureElapsed=(wave-1)*30;tickZoneRun(g,0);assert.equal(g.enemies.filter(e=>e.captain&&e.waveNumber===wave).length,1);assert.equal(g.zoneRun.champions,wave);for(let i=0;i<5;i++)tickZoneRun(g,0);assert.equal(g.enemies.filter(e=>e.captain&&e.waveNumber===wave).length,1,'same wave cannot replay a champion');if(wave>=5)assert.ok(g.enemies.some(e=>e.zoneBoss));}
 assert.equal(g.zoneRun.championWaves.length,0);assert.deepEqual(Game.restore(catalog,g.snapshot()).zoneRun,g.zoneRun);
});

test('failed champion placement retries across saves, and the boss waits for its wave champion',()=>{
 const g=fixture();let fail=true;g.spawnLocation=(a,r,b,o)=>fail&&o.zoneRole==='champion'?null:{x:300,y:300};tickZoneRun(g,0);assert.deepEqual(g.zoneRun.championWaves,[1]);assert.equal(g.zoneRun.champions,0);
 const restored=Game.restore(catalog,g.snapshot());restored.spawnLocation=g.spawnLocation;fail=false;tickZoneRun(restored,0);assert.equal(restored.zoneRun.champions,1);assert.equal(restored.enemies.filter(e=>e.captain).length,1);
 restored.zoneRun.pressureElapsed=120;fail=true;tickZoneRun(restored,0);assert.equal(restored.zoneRun.bossSpawned,false);assert.ok(restored.zoneRun.championWaves.includes(5));fail=false;tickZoneRun(restored,0);assert.equal(restored.zoneRun.bossSpawned,true);assert.equal(restored.enemies.filter(e=>e.captain&&e.waveNumber===5).length,1);
 for(let i=0;i<5;i++)tickZoneRun(restored,0);assert.equal(restored.zoneRun.champions,5);assert.deepEqual(restored.enemies.filter(e=>e.captain).map(e=>e.waveNumber).sort(),[1,2,3,4,5]);
});

test('older timed saves cover the current wave without replaying historical champions',()=>{
 const g=fixture();tickZoneRun(g,0);g.zoneRun.pressureElapsed=30;tickZoneRun(g,0);const old=g.snapshot();delete old.zoneRun.waveChampionVersion;delete old.zoneRun.championWaves;for(const e of old.enemies)delete e.waveNumber;
 const resumed=Game.restore(catalog,old);resumed.spawnLocation=g.spawnLocation;const before=resumed.enemies.filter(e=>e.captain).length;tickZoneRun(resumed,0);assert.equal(resumed.enemies.filter(e=>e.captain).length,before);resumed.zoneRun.pressureElapsed=60;tickZoneRun(resumed,0);assert.equal(resumed.enemies.filter(e=>e.captain&&e.waveNumber===3).length,1);
 const bad=resumed.snapshot();bad.zoneRun.championWaves=[4,4];assert.throws(()=>Game.restore(catalog,bad));
});

test('ordinary mobs, elite escorts and paragons drop no chests, while every killed boss/champion drops exactly one',()=>{
 const g=new Game({...catalog,zoneMode:false},{seed:66});g.enemies=[];g.pickups=[];g.autosell='off';g.autoequip=false;g.elevationAt=()=>17;
 const kill=flags=>{const e=g.spawnEnemy(rat,!!flags.boss);Object.assign(e,flags,{x:30,y:0});const before=g.pickups.filter(p=>p.kind==='loot').length;g.hurtEnemy(e,1e9);g.hurtEnemy(e,1e9);g.enemies=[];return g.pickups.filter(p=>p.kind==='loot').length-before;};
 for(const flags of [{},{elite:true},{modifier:'paragon'},{elite:true,escortOf:99}])for(let n=0;n<50;n++)assert.equal(kill(flags),0);
 for(const flags of [{boss:true},{captain:true},{captain:true,packChampion:true},{boss:true,final:true}])for(let n=0;n<30;n++)assert.equal(kill(flags),1);
 assert.ok(g.pickups.filter(p=>p.kind==='loot').every(p=>p.item&&p.z===17));assert.equal(g.inventory.filter(i=>i.slot==='weapon').length,0,'boss items remain inside unopened chests');
});
