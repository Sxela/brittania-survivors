// BaseCreature.HitsMax returns explicit SetHits, otherwise Str (AoS).
// Normal difficulty preserves those ranges without time/role HP compression.
export function statRange(value,fallback=0){
 const values=(Array.isArray(value)?value:[value]).filter(Number.isFinite);
 return values.length?[Math.min(...values),Math.max(...values)]:[fallback,fallback];
}
export function rollStat(value,random,fallback=0){
 const [min,max]=statRange(value,fallback);return Math.floor(min)+Math.floor(random()*(Math.floor(max)-Math.floor(min)+1));
}
export function nativeMonsterStats(source,random){
 const stats=source.stats||{},design=source.adaptation||{};
 const str=rollStat(stats.str,random,30),dex=rollStat(stats.dex,random,50),int=rollStat(stats.int,random,0);
 const hits=Math.max(1,stats.hits?rollStat(stats.hits,random):stats.str?str:design.hp||24);
 const [damageMin,damageMax]=statRange(stats.damage,design.damage||7);
 const damage=rollStat([damageMin,damageMax],random);
 return {str,dex,int,hits,damage,damageMin,damageMax,mana:stats.mana?rollStat(stats.mana,random):stats.int?int:null,
  resistances:Object.fromEntries(Object.entries(source.resistances||{}).map(([key,value])=>[key,rollStat(value,random)])),
  source:source.source?.path||null,resolvedHits:!!(stats.hits||stats.str)};
}
export function waveCreature(source){return !source.adaptation?.bossOnly&&!source.adaptation?.requiresContext;}
export function bossAvailable(source,time,duration){
 return !source.adaptation?.requiresContext&&time>=((source.adaptation?.bossSpawnAt??0)/600)*duration;
}
