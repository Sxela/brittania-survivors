// Adapted from allods2-rea/survivors/biomes.mjs: retain visible ground,
// blend actual textures offscreen, and never regress as the camera approaches.
export const PATCH_TILES=4;
export const BIOME_BLEND_DISTANCE=384;
export const MAX_BIOME_PATCHES=2400;
const key=(a,b)=>`${a},${b}`;
const progress=weights=>weights.reduce((sum,w,i)=>sum+w*i,0);
export const patchCell=(x,y)=>({a:Math.floor((x+y)/44/PATCH_TILES),b:Math.floor((y-x)/44/PATCH_TILES)});
const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

export class BiomeTerrain {
  constructor(count,bounds,initial){this.count=count;this.bounds=bounds;this.initial=initial;this.patches=new Map();this.revision=0;this.last=null;}
  solid(index){return Array.from({length:this.count},(_,i)=>i===index?1:0);}
  at(a,b,stage){
    const id=key(a,b);let patch=this.patches.get(id);
    if(!patch){const index=this.initial?.(a,b,stage)??stage;patch={a,b,index,weights:this.solid(index),revision:++this.revision};this.patches.set(id,patch);}
    // Sight rays and collision probes often read the same patch many times.
    // It is already the newest LRU entry until another patch is touched.
    if(this.recent!==patch){this.patches.delete(id);this.patches.set(id,patch);this.recent=patch;}
    while(this.patches.size>MAX_BIOME_PATCHES)this.patches.delete(this.patches.keys().next().value);
    return patch;
  }
  peek(a,b,stage){return this.patches.get(key(a,b))||{a,b,index:this.initial?.(a,b,stage)??stage,weights:this.solid(this.initial?.(a,b,stage)??stage),revision:0};}
  update(view,stage,entities=[]){
    if(!this.count)return [];
    const protectedKeys=new Set();
    for(const entity of entities){
      const radius=Math.max(24,entity.radius||0)+24;
      for(const x of [entity.x-radius,entity.x,entity.x+radius])for(const y of [entity.y-radius,entity.y,entity.y+radius]){
        const cell=patchCell(x,y);protectedKeys.add(key(cell.a,cell.b));
      }
    }
    const signature=[stage,Math.floor(view.left/8),Math.floor(view.top/8),view.right-view.left,view.bottom-view.top,...[...protectedKeys].sort()].join(':');
    if(this.last===signature)return [];
    this.last=signature;
    const margin=BIOME_BLEND_DISTANCE+400;
    const corners=[patchCell(view.left-margin,view.top-margin),patchCell(view.right+margin,view.top-margin),patchCell(view.left-margin,view.bottom+margin),patchCell(view.right+margin,view.bottom+margin)];
    const minA=Math.min(...corners.map(p=>p.a)),maxA=Math.max(...corners.map(p=>p.a)),minB=Math.min(...corners.map(p=>p.b)),maxB=Math.max(...corners.map(p=>p.b));
    const previous=new Map(this.patches),target=this.solid(stage),changes=[];
    for(let a=minA;a<=maxA;a++)for(let b=minB;b<=maxB;b++){
      const id=key(a,b),old=previous.get(id),patch=this.at(a,b,stage),bounds=this.bounds(a,b);
      // Bounds include every possible native roof, prop and elevated land cell.
      if(overlaps(bounds,view)||protectedKeys.has(id))continue;
      const distance=Math.hypot(Math.max(view.left-bounds.right,bounds.left-view.right,0),Math.max(view.top-bounds.bottom,bounds.top-view.bottom,0));
      const near=patchCell(Math.max(view.left+.01,Math.min(view.right-.01,(bounds.left+bounds.right)/2)),Math.max(view.top+.01,Math.min(view.bottom-.01,(bounds.top+bounds.bottom)/2)));
      const base=previous.get(key(near.a,near.b))?.weights||target,t=Math.min(1,distance/BIOME_BLEND_DISTANCE),blend=t*t*(3-2*t);
      const desired=base.map((w,i)=>w*(1-blend)+target[i]*blend);
      if(old&&progress(old.weights)>progress(desired)+1e-8)continue;
      if(desired.every((w,i)=>Math.abs(w-patch.weights[i])<1e-6))continue;
      patch.weights=desired;patch.index=desired.indexOf(Math.max(...desired));patch.revision=++this.revision;changes.push(patch);
    }
    return changes;
  }
  reset(){this.patches.clear();this.revision=0;this.last=null;this.recent=null;}
  snapshot(){return [...this.patches.values()].map(p=>[p.a,p.b,...p.weights]);}
  restore(rows){
    this.reset();if(!Array.isArray(rows))return;
    for(const row of rows.slice(-MAX_BIOME_PATCHES)){
      if(!Array.isArray(row)||row.length!==this.count+2||!row.slice(0,2).every(Number.isSafeInteger))continue;
      const weights=row.slice(2);if(!weights.every(w=>Number.isFinite(w)&&w>=0&&w<=1)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-6)continue;
      this.patches.set(key(row[0],row[1]),{a:row[0],b:row[1],weights,index:weights.indexOf(Math.max(...weights)),revision:++this.revision});
    }
  }
}
