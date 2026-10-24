// Original EC 64x64 sectors. Positions and decorations retain source layout;
// isometric projection and terrain diffuse-layer compositing are adaptations.
import { applyHue, hueIdentity } from './hues.mjs';
import { staticPlacement, Z_SCALE, isFloorSurface } from './static-placement.mjs';
import {BiomeTerrain,PATCH_TILES} from './biome-terrain.mjs';
const SIZE=64, HALF_W=22, HALF_H=22;
export const BIOME_SECONDS=100;
export const biomeStage=(time,count=6)=>Math.max(0,Math.min(count-1,Math.floor(time/BIOME_SECONDS)));
const mod=(a,n)=>(a%n+n)%n;
export function mapCell(x,y){const a=x/44+y/44,b=y/44-x/44;return {a:Math.floor(a),b:Math.floor(b)};}
export function mapPoint(a,b){return {x:(a-b)*HALF_W,y:(a+b)*HALF_H};}

export function createMapRegions(manifest,images,{palettes={}}={}){
 const regions=manifest?.regions||[],chunks=new Map(),legacy=new Map(),hued=new Map(),groundCache=new Map(),geometry=new Map(),blocked=regions.map(r=>new Set(r.blocked));
 let groundBytes=0,groundHits=0,groundMisses=0,groundReadbacks=0;
 const GROUND_BUDGET=64*1024*1024;
 const playable=regions.map(r=>r.mainPassable?new Set(r.mainPassable):null);
 const nativeHeights=regions.map(r=>[...new Set(r.tiles.map(t=>t[1]))].filter(z=>z!==0).sort((a,b)=>Math.abs(a)-Math.abs(b)));
 const staticCells=new Set(),staticPatches=regions.map(region=>{
  const groups=new Map();
  for(const item of region.statics){
   const cell=Math.floor(item.x/PATCH_TILES)*16+Math.floor(item.y/PATCH_TILES);
   if(!groups.has(cell))groups.set(cell,[]);
   groups.get(cell).push({item,placement:staticPlacement(mapPoint(item.x,item.y),item),floor:isFloorSurface(item)});staticCells.add(cell);
  }
  return groups;
 });
 // RunUO Map.LineOfSight checks Window|NoShoot (0x1000|0x2000).
 // Wall 0x10 also blocks this ground-level ray approximation. Wet/Impassable
 // alone never blocks sight. Elevated roofs and low floors stay below/above
 // the approximate native eye height (14 z units).
 const sightBlocked=regions.map(region=>{
  const cells=new Set();
  for(const item of region.statics){
   if(!(item.flags&0x3010))continue;
   const index=item.x*SIZE+item.y,eye=region.tiles[index][1]+14,height=(item.bounds?.[1]||0)/2;
   if(item.z<=eye&&item.z+height>=eye)cells.add(index);
  }
  return cells;
 });
 const image=k=>images instanceof Map?images.get(k):images?.[k];
 const stageAt=time=>Math.max(0,Math.min(Math.max(1,regions.length)-1,Math.floor(time/(manifest?.stageSeconds||BIOME_SECONDS))));
 function groundGeometry(index,a,b){
  const key=index+':'+a+','+b;if(geometry.has(key))return geometry.get(key);
  const region=regions[index],polygons=[];
  const elevation=(x,y)=>region.tiles[Math.min(63,x)*64+Math.min(63,y)][1]*Z_SCALE;
  for(let x=a;x<a+PATCH_TILES;x++)for(let y=b;y<b+PATCH_TILES;y++)polygons.push([[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([u,v])=>{const p=mapPoint(u,v);return {x:p.x,y:p.y-elevation(u,v)};}));
  const points=polygons.flat(),result={polygons,left:Math.floor(Math.min(...points.map(p=>p.x))),right:Math.ceil(Math.max(...points.map(p=>p.x))),top:Math.floor(Math.min(...points.map(p=>p.y))),bottom:Math.ceil(Math.max(...points.map(p=>p.y)))};
  geometry.set(key,result);return result;
 }
 const footprintCache=new Map();
 const cropCache=new Map();
 function groundCrop(a,b){
  const key=a+','+b;if(cropCache.has(key))return cropCache.get(key);
  // All blended sources need the same complete screen footprint. Cutting each
  // source along its own raised outline leaves holes between unlike slopes.
  // Pixels still come verbatim from the native, already elevated sector image.
  const corners=[[a,b],[a+PATCH_TILES,b],[a+PATCH_TILES,b+PATCH_TILES],[a,b+PATCH_TILES]].map(([x,y])=>mapPoint(x,y));
  const center=mapPoint(a+PATCH_TILES/2,b+PATCH_TILES/2),polygon=corners.map(p=>({x:p.x+Math.sign(p.x-center.x),y:p.y+Math.sign(p.y-center.y)}));
  const crop={polygons:[polygon],left:Math.min(...polygon.map(p=>p.x))-1,right:Math.max(...polygon.map(p=>p.x))+1,top:Math.min(...polygon.map(p=>p.y))-1,bottom:Math.max(...polygon.map(p=>p.y))+1};
  cropCache.set(key,crop);return crop;
 }
 function patchBounds(a,b){
  const la=mod(a,16)*PATCH_TILES,lb=mod(b,16)*PATCH_TILES,id=la+','+lb;
  if(!footprintCache.has(id)){
   const boxes=regions.map((region,index)=>{
    const ground=groundGeometry(index,la,lb),box={left:ground.left-24,right:ground.right+24,top:ground.top-24,bottom:ground.bottom+24};
    for(const item of region.statics)if(item.x>=la&&item.x<la+PATCH_TILES&&item.y>=lb&&item.y<lb+PATCH_TILES){const p=staticPlacement(mapPoint(item.x,item.y),item);box.left=Math.min(box.left,p.left);box.right=Math.max(box.right,p.left+p.width);box.top=Math.min(box.top,p.top);box.bottom=Math.max(box.bottom,p.top+p.height);if(item.light){box.left=Math.min(box.left,p.x-70);box.right=Math.max(box.right,p.x+70);box.top=Math.min(box.top,p.y-p.height*.55-70);box.bottom=Math.max(box.bottom,p.y-p.height*.55+70);}}
    return box;
   });
   footprintCache.set(id,{left:Math.min(...boxes.map(b=>b.left)),right:Math.max(...boxes.map(b=>b.right)),top:Math.min(...boxes.map(b=>b.top)),bottom:Math.max(...boxes.map(b=>b.bottom))});
  }
  const box=footprintCache.get(id),origin=mapPoint(Math.floor(a/16)*SIZE,Math.floor(b/16)*SIZE);
  return {left:origin.x+box.left,right:origin.x+box.right,top:origin.y+box.top,bottom:origin.y+box.bottom};
 }
 const terrain=new BiomeTerrain(regions.length,patchBounds,(a,b,stage)=>legacy.get(Math.floor(a/16)+','+Math.floor(b/16))??stage);
 function regionAt(cx,cy,time=0){
  const key=cx+','+cy;
  if(!chunks.has(key))chunks.set(key,{cx,cy,index:legacy.get(key)??stageAt(time)});
  if(chunks.size>256)chunks.delete(chunks.keys().next().value);
  return chunks.get(key);
 }
 function patchAt(a,b,time=0){return terrain.at(Math.floor(a/PATCH_TILES),Math.floor(b/PATCH_TILES),stageAt(time));}
 function lookup(x,y,time){const p=mapCell(x,y),cx=Math.floor(p.a/SIZE),cy=Math.floor(p.b/SIZE),sector=regionAt(cx,cy,time),patch=patchAt(p.a,p.b,time);return {...p,cx,cy,chunk:{...sector,index:patch.index},patch,index:mod(p.a,SIZE)*SIZE+mod(p.b,SIZE)};}
 // Simulation probes need a region and tile, without allocating sector records
 // or changing the visible-chunk registry for every point on a sight ray.
 function cellAt(x,y,time){const a=Math.floor(x/44+y/44),b=Math.floor(y/44-x/44);return {region:patchAt(a,b,time).index,index:mod(a,SIZE)*SIZE+mod(b,SIZE)};}
 let activeEntities=[];
 function update(camera,w,h,time=0,entities=null){if(entities)activeEntities=entities;return terrain.update({left:camera.x,top:camera.y,right:camera.x+w,bottom:camera.y+h},stageAt(time),activeEntities);}
 function isPassable(x,y,time=0){if(!regions.length)return true;const p=cellAt(x,y,time);return !blocked[p.region].has(p.index);}
 function isPlayable(x,y,time=0){if(!regions.length)return true;const p=cellAt(x,y,time);return !blocked[p.region].has(p.index)&&(!playable[p.region]||playable[p.region].has(p.index));}
 function isSightPassable(x,y,time=0){if(!regions.length)return true;const p=cellAt(x,y,time);return !sightBlocked[p.region].has(p.index);}
 function elevationAt(x,y,time=0){if(!regions.length)return 0;const p=cellAt(x,y,time);return regions[p.region].tiles[p.index][1];}
 function screenElevationAt(x,y,time=0){return elevationAt(x,y,time)*Z_SCALE;}
 function nearestPassable(x,y,time=0){
  if(isPassable(x,y,time))return {x,y};
  const p=mapCell(x,y);
  for(let radius=1;radius<32;radius++)for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++){
   if(Math.abs(dx)!==radius&&Math.abs(dy)!==radius)continue;
   const q=mapPoint(p.a+dx+.5,p.b+dy+.5);if(isPassable(q.x,q.y,time))return q;
  }
  return {x,y};
 }
 function nearestPlayable(x,y,time=0,canOccupy=null){
  if(isPlayable(x,y,time)&&(!canOccupy||canOccupy(x,y)))return {x,y};
  const p=lookup(x,y,time),cells=playable[p.chunk.index];
  if(!cells)return nearestPassable(x,y,time);
  let nearest=null,distance=Infinity;
  for(let index=0;index<4096;index++){
   const q=mapPoint(p.cx*64+Math.floor(index/64)+.5,p.cy*64+index%64+.5),d=(q.x-x)**2+(q.y-y)**2;
   if(d<distance&&isPlayable(q.x,q.y,time)&&(!canOccupy||canOccupy(q.x,q.y))){nearest=q;distance=d;}
  }
  return nearest||{x,y};
 }
 function visible(camera,w,h,time){
  const corners=[mapCell(camera.x-500,camera.y-500),mapCell(camera.x+w+500,camera.y-500),mapCell(camera.x-500,camera.y+h+500),mapCell(camera.x+w+500,camera.y+h+500)];
  const minx=Math.floor(Math.min(...corners.map(p=>p.a))/SIZE),maxx=Math.floor(Math.max(...corners.map(p=>p.a))/SIZE),miny=Math.floor(Math.min(...corners.map(p=>p.b))/SIZE),maxy=Math.floor(Math.max(...corners.map(p=>p.b))/SIZE),list=[];
  for(const [key,c]of chunks){if(c.cx<minx-1||c.cx>maxx+1||c.cy<miny-1||c.cy>maxy+1)chunks.delete(key);}
  for(let x=minx;x<=maxx;x++)for(let y=miny;y<=maxy;y++)list.push(regionAt(x,y,time));
  return list;
 }
 function clipGround(ctx,shape,dx,dy){
  ctx.beginPath();for(const polygon of shape.polygons){polygon.forEach((p,i)=>i?ctx.lineTo(p.x+dx,p.y+dy):ctx.moveTo(p.x+dx,p.y+dy));ctx.closePath();}ctx.clip();
 }
 function drawPatch(ctx,patch,camera,time){
  const a=mod(patch.a,16)*PATCH_TILES,b=mod(patch.b,16)*PATCH_TILES,origin=mapPoint(Math.floor(patch.a/16)*SIZE,Math.floor(patch.b/16)*SIZE);let coverage=0;
  for(let index=0;index<patch.weights.length;index++){
   const weight=patch.weights[index];if(weight<1e-6)continue;
   const base=image(regions[index].ground);if(!base)continue;
   const shape=groundCrop(a,b),key=index+':'+a+','+b;
   let cached=groundCache.get(key);
   if(cached){groundHits++;groundCache.delete(key);groundCache.set(key,cached);}
   if(!cached&&typeof document!=='undefined'){
    groundMisses++;
    const canvas=document.createElement('canvas');canvas.width=shape.right-shape.left;canvas.height=shape.bottom-shape.top;
    const g=canvas.getContext('2d');clipGround(g,shape,-shape.left,-shape.top);g.drawImage(base,-1408-shape.left,-32-shape.top);
    // Native sector borders can move outside their flat footprint with z.
    // Keep their original pixels, filling only exposed border holes from the
    // same native ground image at its recorded elevation offsets.
    let exposed=regions[index].groundPatchBorderFill?.[(a/PATCH_TILES)*16+b/PATCH_TILES];
    // Legacy manifests can still be opened. Current shipped maps contain the
    // exact source-alpha result computed offline, so gameplay never reads back.
    if(exposed===undefined&&g.getImageData){
     groundReadbacks++;
     const pixels=g.getImageData(0,0,canvas.width,canvas.height).data,center=mapPoint(a+PATCH_TILES/2,b+PATCH_TILES/2),radius=PATCH_TILES*22-2;
     exposed=false;
     for(let y=0;y<canvas.height&&!exposed;y++)for(let x=0;x<canvas.width;x++)if(!pixels[(y*canvas.width+x)*4+3]&&Math.abs(shape.left+x+.5-center.x)+Math.abs(shape.top+y+.5-center.y)<radius){exposed=true;break;}
    }
    if(exposed){g.globalCompositeOperation='destination-over';for(const z of nativeHeights[index])g.drawImage(base,-1408-shape.left,-32-shape.top+z*Z_SCALE);g.globalCompositeOperation='source-over';}
    cached={canvas,shape,bytes:canvas.width*canvas.height*4};groundCache.set(key,cached);groundBytes+=cached.bytes;
   }
   coverage+=weight;ctx.save();ctx.globalAlpha*=weight/coverage;
   if(cached)ctx.drawImage(cached.canvas,origin.x+shape.left-camera.x,origin.y+shape.top-camera.y);
   else {clipGround(ctx,shape,origin.x-camera.x,origin.y-camera.y);ctx.drawImage(base,origin.x-1408-camera.x,origin.y-32-camera.y);}
   ctx.restore();
  }
 }
 function drawGround(ctx,camera,w,h,time=0){
  if(!regions.length)return false;
  update(camera,w,h,time);visible(camera,w,h,time);
  ctx.fillStyle='#39432c';ctx.fillRect(0,0,w,h);
  const view={left:camera.x,top:camera.y,right:camera.x+w,bottom:camera.y+h};
  const patches=[...terrain.patches.values()].filter(p=>{const b=patchBounds(p.a,p.b);return b.right>=view.left&&b.left<=view.right&&b.bottom>=view.top&&b.top<=view.bottom;}).sort((a,b)=>a.a+a.b-b.a-b.b);
  for(const patch of patches)drawPatch(ctx,patch,camera,time);
  // Keep the whole visible working set pinned. A fixed 256-entry FIFO could
  // evict the first visible patch before reaching the end of the same frame,
  // then rebuild every patch again on every subsequent frame of a large view.
  if(groundBytes>GROUND_BUDGET){
   const visibleKeys=new Set();
   for(const patch of patches)for(let index=0;index<patch.weights.length;index++)if(patch.weights[index]>=1e-6)
    visibleKeys.add(index+':'+mod(patch.a,16)*PATCH_TILES+','+mod(patch.b,16)*PATCH_TILES);
   for(const [key,cached] of groundCache){
    if(groundBytes<=GROUND_BUDGET)break;
    if(visibleKeys.has(key))continue;
    groundBytes-=cached.bytes;groundCache.delete(key);
   }
  }
  return true;
 }
 function hueImage(key,value){
  const base=image(key),id=hueIdentity(value);if(!base||!id.id||!palettes[id.id]||typeof document==='undefined')return base;
  const cacheKey=key+':'+value;if(hued.has(cacheKey))return hued.get(cacheKey);
  const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height;const g=canvas.getContext('2d');g.drawImage(base,0,0);const pixels=g.getImageData(0,0,canvas.width,canvas.height);applyHue(pixels.data,palettes[id.id],id.partial);g.putImageData(pixels,0,0);hued.set(cacheKey,canvas);return canvas;
 }
 function decorations(camera,w,h,time=0,hero=null){
  const result=[];
  const heroZ=hero?elevationAt(hero.x,hero.y,time):0,heroY=hero?hero.y-heroZ*Z_SCALE:0;
  for(const c of visible(camera,w,h,time)){
   const origin=mapPoint(c.cx*SIZE,c.cy*SIZE);
   for(const cell of staticCells){
    const regionIndex=patchAt(c.cx*SIZE+Math.floor(cell/16)*PATCH_TILES,c.cy*SIZE+(cell%16)*PATCH_TILES,time).index,region=regions[regionIndex];
    for(const {item,placement:p,floor} of staticPatches[regionIndex].get(cell)||[]){
    // Native stacked storeys remain in the source data. Cut away upper floors
    // while the player is underneath, as with the original client's interiors.
    if(hero&&floor&&item.z>heroZ+14)continue;
    const {flat,width,height}=p,x=origin.x+p.x,y=origin.y+p.y,left=origin.x+p.left,top=origin.y+p.top,depth=origin.y+p.depth;
    if(left+width<camera.x-30||left>camera.x+w+30||top+height<camera.y-30||top>camera.y+h+30)continue;
    const im=hueImage(item.image,item.hue);if(!im)continue;
    result.push({x,y:depth,item,region:region.name,draw(g,cam=camera){
     const faded=hero&&height>65&&hero.x>left-16&&hero.x<left+width+16&&heroY>top&&heroY<top+height+25;
     g.save();if(faded)g.globalAlpha*=item.roof?.18:.35;
     if(flat){g.beginPath();g.moveTo(x-cam.x,y-cam.y);g.lineTo(x+22-cam.x,y+22-cam.y);g.lineTo(x-cam.x,y+44-cam.y);g.lineTo(x-22-cam.x,y+22-cam.y);g.closePath();g.clip();g.drawImage(im,left-cam.x,top-cam.y,44,44);}
     else g.drawImage(im,0,0,Math.min(width,im.width),Math.min(height,im.height),left-cam.x,top-cam.y,width,height);
     g.restore();
     if(item.light){g.save();g.globalCompositeOperation='screen';const glow=g.createRadialGradient(x-cam.x,y-height*.55-cam.y,0,x-cam.x,y-height*.55-cam.y,70);glow.addColorStop(0,'#ffca6745');glow.addColorStop(1,'#ffbf5000');g.fillStyle=glow;g.fillRect(x-70-cam.x,y-height*.55-70-cam.y,140,140);g.restore();}
    }});
   }}
  }
  return result;
 }
 function reset(){chunks.clear();legacy.clear();terrain.reset();groundCache.clear();groundBytes=groundHits=groundMisses=groundReadbacks=0;radarCache.clear();activeEntities=[];}
 function snapshot(){return {version:2,chunks:[...chunks.values()].map(c=>[c.cx,c.cy,c.index]),patches:terrain.snapshot()};}
 function restore(saved){
  reset();const rows=Array.isArray(saved)?saved:saved?.chunks;if(!Array.isArray(rows))return;
  for(const row of rows.slice(-256))if(Array.isArray(row)&&row.length===3&&row.every(Number.isSafeInteger)&&row[2]>=0&&row[2]<regions.length){chunks.set(row[0]+','+row[1],{cx:row[0],cy:row[1],index:row[2]});if(Array.isArray(saved))legacy.set(row[0]+','+row[1],row[2]);}
  if(saved?.version===2)terrain.restore(saved.patches);
 }
 const radarCache=new Map();
 function radarSector(cx,cy,time=0){
  const key=cx+','+cy+':'+stageAt(time)+':'+terrain.revision;
  if(!radarCache.has(key)){
   const indices=[];for(let a=0;a<16;a++)for(let b=0;b<16;b++)indices.push(terrain.peek(cx*16+a,cy*16+b,stageAt(time)).index);
   radarCache.set(key,{key:cx+','+cy+':'+indices.join(''),indices});while(radarCache.size>64)radarCache.delete(radarCache.keys().next().value);
  }
  return radarCache.get(key);
 }
 function drawMinimap(ctx,x,y,w,h,hero,time=0){
  if(!regions.length)return false;
  const p=lookup(hero.x,hero.y,time),c=p.chunk,region=regions[c.index],im=image(region.ground);if(!im)return false;
  ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle='#17201a';ctx.fillRect(x,y,w,h);ctx.drawImage(im,x,y,w,h);
  const local=mapPoint(mod(p.a,64)+.5,mod(p.b,64)+.5),px=x+(local.x+1408)/2816*w,py=y+(local.y+32)/2880*h;ctx.fillStyle='#fff0b1';ctx.fillRect(px-2,py-2,4,4);ctx.restore();return true;
 }
 return {get performanceStats(){return {groundBytes,groundHits,groundMisses,groundReadbacks,groundEntries:groundCache.size};},stageAt,update,terrain,radarSector,drawGround,decorations,isPassable,isPlayable,isSightPassable,nearestPassable,nearestPlayable,nearestMainPassable:nearestPlayable,elevationAt,screenElevationAt,reset,snapshot,restore,drawMinimap,regionName:(x,y,time=0)=>regions[lookup(x,y,time).chunk.index]?.name||'',areaAt:(x,y,time=0)=>regions[lookup(x,y,time).chunk.index]?.areaId||null,manifest};
}
