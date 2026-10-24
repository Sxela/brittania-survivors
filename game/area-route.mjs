// Area selection uses a private RNG so route draws cannot change combat or loot.
export function chooseAreaRoute(pool = [], count = 6, seed = 1) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Area count must be a positive integer.');
  if (!Array.isArray(pool)) throw new TypeError('Area pool must be an array.');
  const ordered = [...pool].sort((a,b) => a.typicalThreat-b.typicalThreat || a.maximumThreat-b.maximumThreat || String(a.id).localeCompare(String(b.id)));
  if (new Set(ordered.map(a=>a.id)).size !== ordered.length) throw new Error('Duplicate area identity.');
  let state = (Number(seed) >>> 0) ^ 0xa4eaf123;
  const random = () => {
    let t = state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  count = Math.min(count,ordered.length);
  return Array.from({length:count},(_,index)=>{
    const first = Math.floor(index*ordered.length/count), last = Math.floor((index+1)*ordered.length/count);
    const area = ordered[first+Math.floor(random()*(last-first))];
    const facetIndex = Math.floor(random()*area.facets.length);
    return {id:area.id,name:area.name,facet:area.facets[facetIndex],zoneId:area.zoneIds[facetIndex],
      stage:index+1,biome:area.biome,typicalThreat:area.typicalThreat,maximumThreat:area.maximumThreat};
  });
}

export function stageIndex(time,duration,count) {
  if (!count) return -1;
  return Math.max(0,Math.min(count-1,Math.floor(Math.max(0,time)/Math.max(1,duration)*count)));
}

export function areaForTime(route,time,duration) {
  return route?.[stageIndex(time,duration,route?.length||0)] || null;
}
