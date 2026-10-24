export const MINING_RANGE=66,MINING_STRIKE_SECONDS=3,MINING_STRIKES=4;
import {withGoldFind} from './spell-levels.mjs';
export function placeGoldOre(game,points,key){
 if(game.oreAreaKey===key)return 0;
 const placed=[],offset=(game.seed>>>0)%Math.max(1,points.length);
 for(let i=0;i<points.length&&placed.length<4;i++){
  const p=points[(i+offset)%points.length];
  if(game.canStand&&!game.canStand(p.x,p.y,(game.player.radius||14)*.5))continue;
  if(Math.hypot(p.x-game.player.x,p.y-game.player.y)<140||placed.some(a=>Math.hypot(a.x-p.x,a.y-p.y)<220))continue;
  const ore={id:game.nextId++,kind:'ore',x:p.x,y:p.y,z:game.elevationAt?.(p.x,p.y,game.time)??0,radius:18,value:Math.round(10*(game.zoneScale?.gold||1)),strikes:MINING_STRIKES,progress:0,mining:false};
  placed.push(ore);game.pickups.push(ore);
 }
 if(placed.length)game.oreAreaKey=key;
 return placed.length;
}
export function syncGoldOre(game){
 for(const ore of game.pickups.filter(p=>p.kind==='ore')){
  const z=game.elevationAt?.(ore.x,ore.y,game.time);
  if(Number.isFinite(z)){if(Number.isFinite(ore.z)&&Math.abs(z-ore.z)>2){ore.progress=0;ore.mining=false;}ore.z=z;}
 }
}
export function tickGoldOre(game,dt,moved){
 syncGoldOre(game);
 const ores=game.pickups.filter(p=>p.kind==='ore'&&!p.collected),player=game.player;
 let target=null,nearest=MINING_RANGE;
 if(!moved&&player.hp>0)for(const ore of ores){
  const d=Math.hypot(ore.x-player.x,ore.y-player.y),z=game.elevationAt?.(player.x,player.y,game.time);
  if(d<=nearest&&(game.canTraverse?game.canTraverse(player,ore):!Number.isFinite(z)||!Number.isFinite(ore.z)||Math.abs(z-ore.z)<=2)&&(!game.clearSight||game.clearSight(player,ore))){target=ore;nearest=d;}
 }
 for(const ore of ores){ore.mining=ore===target;if(ore!==target)ore.progress=0;}
 if(!target)return;
 target.progress+=dt;
 if(target.progress+1e-8<MINING_STRIKE_SECONDS)return;
 const gold=withGoldFind(game,target.value);
 target.progress=0;target.strikes--;game.player.gold+=gold;
 game.audioCue('gold');game.notifyLoot({kind:'gold',text:'Mined '+gold+' gold',value:gold});game.effect(target.x,target.y,18,'#e7c56b','hit',.3);
 if(target.strikes<=0)target.collected=true;
}
export function validGoldOre(state){
 if(state.oreAreaKey!==undefined&&state.oreAreaKey!==null&&(typeof state.oreAreaKey!=='string'||state.oreAreaKey.length>160))return false;
 return (state.pickups||[]).filter(p=>p.kind==='ore').every(p=>Number.isInteger(p.strikes)&&p.strikes>=1&&p.strikes<=MINING_STRIKES&&Number.isFinite(p.progress)&&p.progress>=0&&p.progress<MINING_STRIKE_SECONDS&&typeof p.mining==='boolean'&&Number.isFinite(p.value)&&p.value>0&&p.value<=1000000);
}
