export const MINING_TILE_RANGE=1,MINING_STRIKE_SECONDS=3,MINING_STRIKES=1,ORES_PER_CLUSTER=4;
import {withGoldFind} from './spell-levels.mjs';
import {GOLD_DROP_CHANCE,ORDINARY_GOLD_RETAINED,monsterGoldBase} from './reward-rules.mjs';
import {waveSizeAt} from './zone-pacing.mjs';
import {mapCell} from './map-regions.mjs';
export function oreInMeleeRange(player,ore){
 const a=mapCell(player.x,player.y),b=mapCell(ore.x,ore.y);
 return Math.max(Math.abs(a.a-b.a),Math.abs(a.b-b.b))<=MINING_TILE_RANGE;
}
export const isPickaxe=item=>!!item&&(/pickaxe/i.test(item.id||item.catalogId||item.name||'')||[0xe85,0xe86].includes(item.itemId));
export function miningBonuses(game){
 const pickaxe=isPickaxe(game.equipped?.('weapon'));
 const skill=(game.wornItems||[]).flatMap(item=>item.skillBonuses||[]).filter(s=>s.skill==='Mining').reduce((sum,s)=>sum+Math.max(0,Number(s.value)||0),0);
 return {speed:1+(pickaxe ? .2 : 0)+Math.min(2,skill/100),yield:pickaxe?1.25:1};
}
export function areaOreBudget(game){
 const plan=game.zonePlan;
 const waves=plan?.bossAt?Math.floor(plan.bossAt/plan.waveEvery)+1:0;
 const payoutAt=seconds=>monsterGoldBase(game,{},game.zoneRun?((game.zoneRun.index+Math.min(1,seconds/Math.max(1,plan.bossAt)))/Math.max(1,game.areaRoute?.length||1)*game.duration):game.time);
 let lost=waves?4*payoutAt(plan.bossAt):0;
 for(let wave=0;wave<waves;wave++)lost+=(waveSizeAt(plan,wave)+2)*payoutAt(wave*plan.waveEvery);
 // Preserve the old four deposits, then move the lost expected monster gold
 // into ore. Leaders retain their rewards; Gold Find is applied only at payout.
 return Math.ceil(160*(game.zoneScale?.gold||1)+lost*GOLD_DROP_CHANCE*(1-ORDINARY_GOLD_RETAINED));
}
export function placeGoldOre(game,points,key){
 if(game.oreAreaKey===key)return 0;
 const placed=[],centers=[],candidates=[...points],random=()=>game.random?.()??.5;
 for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 const limit=Math.min(24,8+Math.floor((game.zoneRun?.index||0)/2));
 for(let i=0;i<candidates.length&&centers.length<limit;i++){
  const p=candidates[i];
  if(game.canStand&&!game.canStand(p.x,p.y,18))continue;
  if(Math.hypot(p.x-game.player.x,p.y-game.player.y)<110||centers.some(a=>Math.hypot(a.x-p.x,a.y-p.y)<180))continue;
  const z=game.elevationAt?.(p.x,p.y,game.time)??0,clusterId=game.nextId;
  const offsets=[[44,0],[0,44],[-44,0],[0,-44],[44,44],[-44,44],[-44,-44],[44,-44]];
  const rotation=Math.floor(random()*offsets.length),positions=[p,...offsets.map((_,n)=>{const [dx,dy]=offsets[(n+rotation)%offsets.length];return {x:p.x+dx,y:p.y+dy};})];
  let count=0;
  for(const point of positions){
   if(count>=ORES_PER_CLUSTER)break;
   if(game.canStand&&!game.canStand(point.x,point.y,18))continue;
   const height=game.elevationAt?.(point.x,point.y,game.time)??z;
   if(game.canTraverse?!game.canTraverse({...p,z},{...point,z:height}):Math.abs(height-z)>2)continue;
   if(game.clearSight&&!game.clearSight(p,point))continue;
   if(placed.some(a=>Math.hypot(a.x-point.x,a.y-point.y)<36))continue;
   const ore={id:game.nextId++,clusterId,kind:'ore',...point,z:height,radius:18,value:1,hp:1,maxHp:1,strikes:MINING_STRIKES,progress:0,mining:false,rockVariant:placed.length%3};
   placed.push(ore);game.pickups.push(ore);count++;
  }
  if(count)centers.push(p);
 }
 if(placed.length){
  const weights=placed.map(()=>.5+random()),sum=weights.reduce((a,b)=>a+b,0),budget=Math.max(placed.length,Math.round(areaOreBudget(game)/MINING_STRIKES));
  const values=weights.map(w=>Math.max(1,1+Math.floor((budget-placed.length)*w/sum)));
  let remaining=budget-values.reduce((a,b)=>a+b,0);for(let i=0;remaining>0;i=(i+1)%values.length,remaining--)values[i]++;
  placed.forEach((ore,i)=>ore.value=values[i]);game.oreAreaKey=key;
 }
 return placed.length;
}
export function syncGoldOre(game){
 for(const ore of game.pickups.filter(p=>p.kind==='ore')){
  // Older saves keep their remaining reward when converted to one strike.
  if(ore.strikes>1){ore.value*=ore.strikes;ore.strikes=1;}
  if(ore.hp===undefined)ore.hp=1;
  if(ore.maxHp===undefined)ore.maxHp=1;
  const z=game.elevationAt?.(ore.x,ore.y,game.time);
  if(Number.isFinite(z)){if(Number.isFinite(ore.z)&&Math.abs(z-ore.z)>2){ore.progress=0;ore.mining=false;}ore.z=z;}
 }
}
export function tickGoldOre(game,dt){
 syncGoldOre(game);
 const ores=game.pickups.filter(p=>p.kind==='ore'&&!p.collected),player=game.player;
 let target=null,nearest=Infinity;
 if(player.hp>0)for(const ore of ores){
  const d=Math.hypot(ore.x-player.x,ore.y-player.y),z=game.elevationAt?.(player.x,player.y,game.time);
  if(ore.hp>0&&oreInMeleeRange(player,ore)&&(game.canTraverse?game.canTraverse(player,ore):!Number.isFinite(z)||!Number.isFinite(ore.z)||Math.abs(z-ore.z)<=2)&&(!game.clearSight||game.clearSight(player,ore))){
   // Keep the current rock while circling it, even if another becomes closer.
   if(ore.mining){target=ore;break;}
   if(d<nearest){target=ore;nearest=d;}
  }
 }
 for(const ore of ores)ore.mining=ore===target;
 if(!target)return;
 target.progress+=dt*miningBonuses(game).speed;
 if(target.progress+1e-8<MINING_STRIKE_SECONDS)return;
 const gold=withGoldFind(game,Math.round(target.value*miningBonuses(game).yield));
 target.progress=0;target.hp=Math.max(0,target.hp-1);
 if(target.hp>0)return;
 target.strikes=0;game.player.gold+=gold;
 game.audioCue('gold');game.notifyLoot({kind:'gold',text:'Mined '+gold+' gold',value:gold});game.effect(target.x,target.y,18,'#e7c56b','hit',.3);
 if(target.strikes<=0)target.collected=true;
}
export function validGoldOre(state){
 if(state.oreAreaKey!==undefined&&state.oreAreaKey!==null&&(typeof state.oreAreaKey!=='string'||state.oreAreaKey.length>160))return false;
 return (state.pickups||[]).filter(p=>p.kind==='ore').every(p=>((p.hp===undefined&&p.maxHp===undefined)||Number.isFinite(p.hp)&&Number.isFinite(p.maxHp)&&p.maxHp>=1&&p.maxHp<=1000000&&p.hp>0&&p.hp<=p.maxHp)&&(p.clusterId===undefined||Number.isInteger(p.clusterId)&&p.clusterId>=1&&p.clusterId<=1e9)&&(p.rockVariant===undefined||Number.isInteger(p.rockVariant)&&p.rockVariant>=0&&p.rockVariant<3)&&Number.isInteger(p.strikes)&&p.strikes>=1&&p.strikes<=4&&Number.isFinite(p.progress)&&p.progress>=0&&p.progress<MINING_STRIKE_SECONDS&&typeof p.mining==='boolean'&&Number.isFinite(p.value)&&p.value>0&&p.value*p.strikes<=4000000);
}
