import {rarestFirst} from './reward-rules.mjs';
import {rollWaveSize} from './zone-pacing.mjs';
import {globalSpellChoices,applyGlobalUpgrade,GLOBAL_SPELL_UPGRADES,HERO_UPGRADE_IDS,UPGRADE_RARITIES} from './spell-upgrades.mjs';
import {decorateUpgrade} from './spell-upgrades.mjs';
import {mixedChoiceDraw} from './choice-draw.mjs';
import {spellChoices,applySpellOffer,SPELLS,RETIRED_SPELLS} from './spell-system.mjs';
import {waveCreature,bossAvailable} from './monster-stats.mjs';
import {enemyCasterSpawnAllowed} from './monster-behavior.mjs';

export const MOONGATE_SECONDS=30;

export function createZoneRun(game,index=0){
  return {version:4,flowVersion:2,pressureElapsed:0,waveIndex:0,waveRemaining:0,waveSpawned:0,waveChampionVersion:1,championWaves:[],champions:0,index,phase:'combat',spawned:0,killed:0,quota:0,bossSpawned:false,bossKilled:false,rerolls:0};
}

export function zoneProgress(game){
  const zone=game.zoneRun;if(!zone)return null;
  return {...zone,plan:game.zonePlan,total:game.areaRoute.length,remaining:Math.max(0,(game.zonePlan?.bossAt||0)-(zone.pressureElapsed||0)),
    gateRemaining:zone.gateRemaining??MOONGATE_SECONDS,
    alive:game.enemies.filter(enemy=>enemy.hp>0&&enemy.zoneIndex===zone.index).length,
    boss:game.enemies.find(enemy=>enemy.hp>0&&enemy.zoneIndex===zone.index&&enemy.zoneBoss)||null};
}

export function zoneCombatTime(game){
  if(!game.zoneRun)return game.time;
  const zone=game.zoneRun,fraction=Math.min(1,(zone.pressureElapsed||0)/Math.max(1,game.zonePlan?.bossAt||1));
  return (zone.index+fraction)/game.areaRoute.length*game.duration;
}

export function zonePressure(game){
 const zone=game.zoneRun,seconds=zone?.pressureElapsed||0,evacuation=zone?.bossKilled?Math.max(0,zone.waveIndex-(zone.bossKilledWave??zone.waveIndex)):0;
 return {hp:1+Math.min(3,seconds/120)+evacuation*.25,damage:1+Math.min(1.5,seconds/240)+evacuation*.15,speed:1+Math.min(.5,seconds/600)+evacuation*.08,interval:Math.max(.03,.2/(1+evacuation*.2))};
}
export function applyZonePressure(game,enemy){
 if(!game.zoneRun)return;
 const pressure=zonePressure(game);enemy.pressureStats={speed:enemy.speed,damage:enemy.damage};
 enemy.hp*=pressure.hp;enemy.maxHp=enemy.hp;enemy.damage*=pressure.damage;enemy.speed=Math.min(135,enemy.speed*pressure.speed);
}
export function promoteZoneBoss(enemy){
 if(enemy.zoneBossStatsVersion===2)return;
 if(enemy.zoneBossStatsVersion===1){
  enemy.hp*=.5;enemy.maxHp*=.5;enemy.zoneBossStatsVersion=2;return;
 }
 enemy.zoneBossStatsVersion=2;enemy.hp*=7.5;enemy.maxHp*=7.5;enemy.damage*=2.5;
 if(enemy.pressureStats){enemy.pressureStats.damage*=2.5;enemy.pressureStats.speed*=1.2;enemy.speed=Math.min(135,enemy.pressureStats.speed);}
}
export function migrateZonePacing(game){
 const zone=game.zoneRun;if(!zone)return;
 if(zone.version>=4){for(const enemy of game.enemies)if(enemy.zoneBoss)promoteZoneBoss(enemy);return;}
 const elapsed=zone.bossSpawned?game.zonePlan.bossAt:game.zonePlan.bossAt*Math.min(.9,(zone.killed||0)/Math.max(1,zone.quota));
 zone.pressureElapsed=elapsed;zone.waveIndex=elapsed?Math.floor(elapsed/30)+1:0;zone.waveRemaining=0;zone.waveSpawned=0;zone.champions??=0;zone.version=4;zone.quota=0;
 for(const enemy of game.enemies){if(!enemy.pressureStats)applyZonePressure(game,enemy);if(enemy.zoneBoss)promoteZoneBoss(enemy);}
 if(zone.bossKilled&&zone.phase==='combat'){zone.phase='cleared';game.enemies=[];game.projectiles=[];game.pendingEnemyCasts=[];game.spellFields=[];}
}
export function zoneUpgradePrice(game,offer){
 const rarity=UPGRADE_RARITIES.find(r=>r.id===(offer?.rarity||'common'));
 const factor={common:1,uncommon:1.5,rare:2,epic:3,legendary:4}[rarity?.id]||1;
 return Math.ceil(game.zoneSpellPrice*factor);
}
export function initWaveChampions(game){
 const zone=game.zoneRun;if(!zone||zone.waveChampionVersion===1)return;
 zone.waveChampionVersion=1;zone.championWaves=[];
 // Older saves do not replay historical leaders. Cover the current horde once.
 if(zone.phase==='combat'&&zone.waveIndex>0){
  const leader=game.enemies.find(e=>e.hp>0&&e.zoneIndex===zone.index&&e.captain);
  if(leader)leader.waveNumber=zone.waveIndex;else zone.championWaves.push(zone.waveIndex);
 }
}
export function tickZoneRun(game,dt){
 const zone=game.zoneRun;
 if(!zone||!['combat','cleared'].includes(zone.phase)||game.status!=='playing')return;
 if(zone.phase==='cleared'){
  zone.gateRemaining=Math.max(0,(zone.gateRemaining??MOONGATE_SECONDS)-Math.max(0,dt));
  if(zone.gateRemaining<=1e-8){zone.gateRemaining=0;zone.gateExpired=true;game.player.hp=0;game.status='dead';return;}
 }
 if(!game.spawnLocation)return;
 if(zone.bossKilled){zone.bossKilledAt??=zone.pressureElapsed||0;zone.bossKilledWave??=zone.waveIndex;}
 zone.pressureElapsed=Math.min(86400,(zone.pressureElapsed||0)+Math.max(0,dt));
 const pressure=zonePressure(game);
 const alive=game.enemies.filter(enemy=>enemy.hp>0&&enemy.zoneIndex===zone.index);
 for(const enemy of alive)if(enemy.pressureStats){enemy.speed=Math.min(zone.bossKilled?145:135,enemy.pressureStats.speed*pressure.speed);enemy.damage=enemy.pressureStats.damage*pressure.damage;}
 game.spawnClock-=dt;
 const plan=game.zonePlan;
 const local=game.areaMonsters();
 initWaveChampions(game);
 // Each scheduled horde carries its own leader, including boss/reinforcement
 // waves. Keep failed placements queued; never consume their guarantee.
 let due=plan.bossAt?Math.floor(zone.pressureElapsed/plan.waveEvery)+1:1;
 if(zone.bossKilled){
  let elapsed=zone.pressureElapsed-zone.bossKilledAt,waves=0,interval=10;
  while(elapsed+1e-8>=interval){elapsed-=interval;waves++;interval=Math.max(4,10/(1+waves*.25));}
  due=zone.bossKilledWave+waves;
 }
 if(due>zone.waveIndex){
  for(let wave=zone.waveIndex;wave<due;wave++){const count=plan.bossAt||zone.bossKilled?rollWaveSize(plan,wave,()=>game.random())+(zone.bossKilled?5*(wave-zone.bossKilledWave+1):0):0;zone.waveRemaining+=count;zone.lastWaveSize=count;zone.championWaves.push(wave+1);}
  zone.waveIndex=due;zone.waveSpawned=0;
  game.notifyLoot({kind:'notice',text:zone.bossSpawned?'Reinforcements!':`Horde ${due} approaches`});
 }
 if(zone.championWaves.length){
  const wave=zone.championWaves.at(-1),champion=game.spawnChampionEncounter(wave-1);
  if(!champion)return;
  champion.waveNumber=wave;for(const e of game.enemies)if(e.escortOf===champion.id)e.waveNumber=wave;
  zone.championWaves.pop();zone.champions=(zone.champions||0)+1;
 }
 if(zone.pressureElapsed>=plan.bossAt&&!zone.bossSpawned){
  const available=local.filter(monster=>bossAvailable(monster,zoneCombatTime(game),game.duration)),pool=available.length?available:local;
  const bosses=pool.filter(monster=>monster.adaptation?.bossOnly||monster.adaptation?.boss);
  const mean=value=>Array.isArray(value)?value.reduce((a,b)=>a+b,0)/value.length:Number(value)||1;
  const strength=monster=>mean(monster.stats?.hits||monster.stats?.str||monster.adaptation?.hp)*mean(monster.stats?.damage||monster.adaptation?.damage);
  const candidates=bosses.length?bosses:pool,strongest=Math.max(...candidates.map(strength));
  const source=game.pick(candidates.filter(monster=>strength(monster)===strongest));
  if(source){const boss=game.spawnEnemy(source,true,false,{zoneEncounter:true});if(boss){
   boss.zoneBoss=true;zone.bossSpawned=true;promoteZoneBoss(boss);
   if(boss.pressureStats)boss.speed=Math.min(135,boss.pressureStats.speed*pressure.speed);
   if(plan.bossAt){const ordinary=local.filter(waveCreature),eligible=ordinary.filter(m=>enemyCasterSpawnAllowed(m,zoneCombatTime(game))),escorts=eligible.length?eligible:ordinary;
    for(let n=0;n<4&&escorts.length;n++)game.spawnEnemy(game.pick(escorts),false,false,{zoneEncounter:true,zoneRole:'escort'});
   }
  }}
 }
 if(!zone.waveRemaining||game.spawnClock>0)return;
 const ordinary=local.filter(waveCreature),eligible=ordinary.filter(monster=>enemyCasterSpawnAllowed(monster,zoneCombatTime(game))),pool=eligible.length?eligible:ordinary,source=pool.length?game.pick(pool):null;
 if(source){const angle=(zone.waveSpawned*.61803398875+(zone.waveIndex||0)*.17)*Math.PI*2;
  if(game.spawnEnemy(source,false,false,{zoneEncounter:true,zoneRole:zone.bossSpawned?'reinforcement':'wave',spawnAngle:angle,spawnSpread:plan.spread})){
   zone.spawned++;zone.waveRemaining--;zone.waveSpawned++;game.spawnClock=zonePressure(game).interval/(1+plan.progress)/Math.max(.5,game.difficultySettings.population);
  }else game.spawnClock=.25;
 }

}

export function zoneEnemyKilled(game,enemy){
  const zone=game.zoneRun;if(!zone||!['combat','cleared'].includes(zone.phase)||enemy.zoneIndex!==zone.index)return;
  if(zone.bossKilled){if(!enemy.zoneBoss&&(!enemy.zoneRole||['wave','reinforcement'].includes(enemy.zoneRole)))zone.killed++;return;}
  if(enemy.zoneBoss)zone.bossKilled=true;
  else if(zone.version===1||!enemy.zoneRole||enemy.zoneRole==='wave'||enemy.zoneRole==='reinforcement')zone.killed=zone.version>=4?zone.killed+1:Math.min(zone.quota,zone.killed+1);
  if(!zone.bossKilled)return;
  // Keep the native horde active while the moongate offers an escape.
  zone.phase='cleared';zone.bossKilledAt=zone.pressureElapsed;zone.bossKilledWave=zone.waveIndex;zone.gateRemaining=MOONGATE_SECONDS;
  game.notifyLoot({kind:'notice',text:'Moongate open / evacuate within 30 seconds'});
  game.zoneSpellOffers=[];
}

export function rollZoneSpells(game){
  game.zoneSpellOffers=mixedChoiceDraw(game.shopUpgradeChoices,5,()=>game.random()).map(choice=>decorateUpgrade(game,choice)).sort(rarestFirst);
  game.zoneRun.fixedShopVersion=1;
  return game.zoneSpellOffers;
}
export function rerollZoneSpells(game){
  if(game.zoneRun?.phase!=='spellshop'||game.pendingSpellSupers?.length||game.player.gold<game.zoneSpellRerollPrice)return false;
  if(!game.shopUpgradeChoices.length)return false;
  game.player.gold-=game.zoneSpellRerollPrice;game.zoneRun.rerolls++;rollZoneSpells(game);return true;
}
export function buyZoneSpell(game,index,replaceId=null){
  const offer=game.zoneSpellOffers[index];
  const price=zoneUpgradePrice(game,offer);
  if(game.zoneRun?.phase!=='spellshop'||game.pendingSpellSupers?.length||!offer||offer.purchased||game.player.gold<price)return false;
  if(!game.shopUpgradeChoices.some(choice=>choice.id===offer.id))return false;
  const result=offer.type==='passive'?{ok:game.applyPassiveUpgrade(offer)}:offer.type==='global'?{ok:applyGlobalUpgrade(game,offer)}:applySpellOffer(game,offer,replaceId);
  if(!result.ok)return result.requiresReplacement?result:false;
  game.player.gold-=price;offer.purchased=true;game.refreshWeapons();
  if(game.zoneSpellOffers.every(item=>item.purchased))rollZoneSpells(game);
  return true;
}
export function finishZoneSpellShop(game){
  if(game.zoneRun?.phase!=='spellshop')return false;
  game.zoneRun.phase='ready';game.zoneSpellOffers=[];return true;
}
export function enterZoneSpellShop(game){
 if(game.zoneRun?.phase!=='cleared'||game.status!=='playing'||(game.zoneRun.gateRemaining??MOONGATE_SECONDS)<=0)return false;
 // Crossing the gate ends combat; the upgrade break is safe.
 for(const enemy of game.enemies){enemy.hp=0;enemy.deathHandled=true;}
 game.enemies=[];game.projectiles=[];game.pendingEnemyCasts=[];game.spellFields=[];
 game.player.poison=null;game.player.poisonUntil=0;
 game.zoneRun.phase='spellshop';game.zoneRun.waveRemaining=0;game.zoneRun.championWaves=[];
 rollZoneSpells(game);return true;
}
export function advanceZone(game){
  if(game.zoneRun?.phase!=='ready'||game.status!=='playing')return false;
  if(game.zoneRun.index+1>=game.areaRoute.length){game.status='victory';return true;}
  const next=game.zoneRun.index+1;
  game.enemies=[];game.projectiles=[];game.pendingEnemyCasts=[];game.pickups=[];game.corpses=[];game.effects=[];game.spellFields=[];
  game.zoneRun=createZoneRun(game,next);game.spawnClock=.5;game.player.x=0;game.player.y=0;
  return true;
}

export function validZoneState(state,catalog){
  const zone=state.zoneRun;
  if(zone==null)return state.zoneSpellOffers===undefined||Array.isArray(state.zoneSpellOffers)&&!state.zoneSpellOffers.length;
  const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
  if(!catalog.zoneMode||!state.areaRoute?.length||![1,2,3,4].includes(zone.version)||!integer(zone.index,0,state.areaRoute.length-1)||!['combat','spellshop','cleared','ready'].includes(zone.phase))return false;
  if(!integer(zone.quota,0,1000)||!integer(zone.spawned,0,zone.version>=4?1000000:zone.quota)||!integer(zone.killed,0,zone.spawned)||!integer(zone.rerolls,0,100000)||typeof zone.bossSpawned!=='boolean'||typeof zone.bossKilled!=='boolean')return false;
  if(zone.version>=2&&!integer(zone.champions,0,zone.version>=4?100000:2))return false;
  if(zone.version>=4&&(!integer(zone.waveIndex,0,100000)||!integer(zone.waveRemaining,0,1000000)||!integer(zone.waveSpawned,0,1000000)))return false;
  if(zone.waveChampionVersion!==undefined&&(zone.waveChampionVersion!==1||!Array.isArray(zone.championWaves)||zone.championWaves.length>100000||new Set(zone.championWaves).size!==zone.championWaves.length||zone.championWaves.some(w=>!integer(w,1,zone.waveIndex))))return false;
  if(zone.pressureElapsed!==undefined&&(!Number.isFinite(zone.pressureElapsed)||zone.pressureElapsed<0||zone.pressureElapsed>86400))return false;
  if(zone.bossKilledAt!==undefined&&(!Number.isFinite(zone.bossKilledAt)||zone.bossKilledAt<0||zone.bossKilledAt>zone.pressureElapsed))return false;
  if(zone.bossKilledWave!==undefined&&!integer(zone.bossKilledWave,0,zone.waveIndex))return false;
  if(zone.gateRemaining!==undefined&&(!Number.isFinite(zone.gateRemaining)||zone.gateRemaining<0||zone.gateRemaining>MOONGATE_SECONDS))return false;
  if(zone.gateExpired!==undefined&&typeof zone.gateExpired!=='boolean')return false;
  if(zone.gateArmed!==undefined&&typeof zone.gateArmed!=='boolean')return false;
  if(zone.gate!==undefined&&(!['cleared','spellshop','ready'].includes(zone.phase)||!zone.gate||!Number.isFinite(zone.gate.x)||!Number.isFinite(zone.gate.y)||Math.abs(zone.gate.x)>1e7||Math.abs(zone.gate.y)>1e7))return false;
  if(zone.version<4&&zone.bossSpawned&&(zone.killed!==zone.quota||zone.spawned!==zone.quota))return false;
  if(zone.bossKilled&&!zone.bossSpawned||zone.phase!=='combat'&&!zone.bossKilled||zone.version===1&&zone.phase==='combat'&&zone.bossKilled)return false;
  if(!Array.isArray(state.zoneSpellOffers)||state.zoneSpellOffers.length>5||zone.phase!=='spellshop'&&state.zoneSpellOffers.length)return false;
  if(zone.fixedShopVersion!==undefined&&zone.fixedShopVersion!==1)return false;
  if(state.zoneSpellOffers.some(offer=>offer.purchased!==undefined&&typeof offer.purchased!=='boolean'))return false;
  const ids=new Set();
  for(const offer of state.zoneSpellOffers){if(!offer||!(offer.type==='passive'?HERO_UPGRADE_IDS.includes(offer.id):offer.type==='global'?GLOBAL_SPELL_UPGRADES.some(d=>offer.id==='global:'+d.key):offer.type==='spell'&&(SPELLS.some(spell=>spell.id===offer.spellId)||RETIRED_SPELLS.has(offer.spellId))&&(offer.id==='spell:'+offer.spellId||offer.id==='spell:'+offer.spellId+':'+offer.upgradeKind))||ids.has(offer.id))return false;ids.add(offer.id);}
  if(!Array.isArray(state.enemies))return false;
  for(const enemy of state.enemies)if(!enemy||enemy.zoneIndex!==zone.index||enemy.areaId!==state.areaRoute[zone.index].id||enemy.zoneBoss!==undefined&&typeof enemy.zoneBoss!=='boolean'||enemy.zoneRole!==undefined&&!['wave','champion','escort','reinforcement'].includes(enemy.zoneRole))return false;
  if(state.enemies.some(e=>e.pressureStats&&(!Number.isFinite(e.pressureStats.damage)||e.pressureStats.damage<0||e.pressureStats.damage>1e9||!Number.isFinite(e.pressureStats.speed)||e.pressureStats.speed<0||e.pressureStats.speed>1000)))return false;
  return true;
}
