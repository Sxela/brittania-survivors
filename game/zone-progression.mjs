import {waveCreature,statRange} from './monster-stats.mjs';

export function difficultyAreaCount(pool,difficulty='normal'){
 return Math.min(pool.length,difficulty==='easy'?20:difficulty==='hard'?pool.length:35);
}

export function chooseProgressiveRoute(pool,count,seed){
 const ordered=[...pool].sort((a,b)=>a.typicalThreat-b.typicalThreat||a.maximumThreat-b.maximumThreat||String(a.id).localeCompare(String(b.id)));
 let state=(Number(seed)>>>0)^0xa4eaf123;
 const random=()=>{let t=state+=0x6d2b79f5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
 count=Math.min(count,ordered.length);const brackets=Math.min(8,count),route=[];
 for(let bracket=0;bracket<brackets;bracket++){
  const candidates=ordered.slice(Math.floor(bracket*ordered.length/brackets),Math.floor((bracket+1)*ordered.length/brackets));
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  const selected=candidates.slice(0,Math.floor((bracket+1)*count/brackets)-Math.floor(bracket*count/brackets));
  for(const area of selected){const facet=Math.floor(random()*area.facets.length);route.push({id:area.id,name:area.name,facet:area.facets[facet],zoneId:area.zoneIds[facet],stage:route.length+1,biome:area.biome,typicalThreat:area.typicalThreat,maximumThreat:area.maximumThreat,bracket});}
 }
 return route;
}

export function buildZoneProgression(route,catalog){
 let previousHp=0,previousDamage=0,previousXp=0;
 const median=values=>{values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length/2)]:1;};
 const mean=value=>{const range=statRange(value,1);return (range[0]+range[1])/2;};
 return route.map((area,index)=>{
  const source=catalog.areas.find(a=>a.id===area.id),classes=new Set(source?.combatClasses||[]);
  const local=(catalog.monsters||[]).filter(m=>classes.has(m.className)||classes.has(m.sourceName));
  const ordinary=local.filter(waveCreature),pool=ordinary.length?ordinary:local;
  const hp=median(pool.map(m=>mean(m.stats?.hits||m.stats?.str||m.adaptation?.hp))),damage=median(pool.map(m=>mean(m.stats?.damage||m.adaptation?.damage))),xp=median(pool.map(m=>m.adaptation?.xp||5));
  const targetHp=Math.max(hp*(1+index*.07),Math.ceil(previousHp*1.08)+Number(index>0)),targetDamage=Math.max(damage*(1+index*.04),previousDamage*1.05+Number(index>0)*.1),targetXp=Math.max(xp*(1+index*.1),Math.ceil(previousXp*1.08)+Number(index>0));
  previousHp=targetHp;previousDamage=targetDamage;previousXp=targetXp;
  return {hp:targetHp/Math.max(1,hp),damage:targetDamage/Math.max(1,damage),xp:targetXp/Math.max(1,xp),gold:1+index*.2,loot:Math.min(.04,index*.0005),magicFind:index*.04,targetHp,targetDamage,targetXp};
 });
}
