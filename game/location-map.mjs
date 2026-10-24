import {locationHeights,locationTraversal,connectedLocationCells} from './location-height.mjs';
import {staticDepth,transparencyCircle,obstructsCharacter,isTreeScenery,overlaysCharacter} from './world-layers.mjs';
// A finite location: native coordinates, terrain, and decorations are never tiled.
import {applyHue,hueIdentity} from './hues.mjs';
import {staticPlacement,Z_SCALE,isFloorSurface} from './static-placement.mjs';
import {mapCell,mapPoint} from './map-regions.mjs';

// Saved actors use coordinates relative to the exported map origin. A larger
// crop changes that origin, but must not move actors on the original UO map.
export function relocateLocationSave(game,savedMap,region){
 if(savedMap?.areaId!==region.areaId)return false;
 const old=savedMap.origin||(savedMap.version===3?region.expansionAudit?.previousBounds:null);
 if(!old||![old.sourceX,old.sourceY,region.sourceX,region.sourceY].every(Number.isFinite))return false;
 const offset=mapPoint(old.sourceX-region.sourceX,old.sourceY-region.sourceY);
 if(!offset.x&&!offset.y)return false;
 const move=p=>{if(!p||typeof p!=='object')return;for(const [x,y] of [['x','y'],['x2','y2']])if(Number.isFinite(p[x])&&Number.isFinite(p[y])){p[x]+=offset.x;p[y]+=offset.y;}};
 move(game.player);move(game.zoneRun?.gate);
 for(const key of ['enemies','projectiles','pickups','corpses','spellFields','effects','pendingEnemyCasts','audioEvents','championMarks'])for(const p of game[key]||[])move(p);
 return true;
}

export function createLocationMap(manifest,images,{palettes={},areaId,facet,assetStore}={}){
 const regions=manifest?.regions||[];
 const region=regions.find(r=>(!areaId||r.areaId===areaId)&&(!facet||r.facet===facet||r.sourceFacet===facet))||regions.find(r=>r.areaId===areaId)||regions[0];
 if(!region)throw new Error('A native location is required');
 const width=region.width,height=region.height;
 // A clear floor behind a wall is a legal teleport landing, even if it is
 // disconnected from the original spawn. Legacy banks retain their old bounds.
 const physical=region.physicalPassable?new Set(region.physicalPassable.filter(i=>Number.isInteger(i)&&i>=0&&i<width*height)):null;
 const blocked=new Set(physical?Array.from({length:width*height},(_,i)=>i).filter(i=>!physical.has(i)):region.blocked||[]);
 const validIndex=i=>Number.isInteger(i)&&i>=0&&i<width*height&&!blocked.has(i);
 let main=[...new Set(region.mainPassable||Array.from({length:width*height},(_,i)=>i))].filter(validIndex),playable=physical||new Set(main);
 const image=key=>images instanceof Map?images.get(key):images?.[key],hued=new Map();
 let hueBytes=0;
 const inside=(a,b)=>a>=0&&b>=0&&a<width&&b<height;
 const indexAt=(x,y)=>{const {a,b}=mapCell(x,y);return inside(a,b)?a*height+b:-1;};
 const pointAt=i=>mapPoint(Math.floor(i/height)+.5,i%height+.5);
 const heights=locationHeights(region),elevationAt=heights.elevationAt,canTraverse=locationTraversal(region,heights,validIndex);
 const canOccupySegment=locationTraversal(region,heights,validIndex,{ignoreHeight:true});
 const connected=connectedLocationCells(region,main,canTraverse),reachable=new Set(connected);
 if(!physical)for(const i of main)if(!reachable.has(i)){blocked.add(i);playable.delete(i);}
 main=connected;
 let currentComponent=new Set(main);
 function ensurePlayerComponent(player){
  if(!physical||!player||currentComponent.has(indexAt(player.x,player.y))||!isPlayable(player.x,player.y))return;
  const cell=mapCell(player.x,player.y);
  main=connectedLocationCells({...region,spawn:{tileX:cell.a,tileY:cell.b}},[...physical],canTraverse);
  currentComponent=new Set(main);indexSpawnCells();cachedGate=null;
 }
 const placements=[...(region.statics||[]),...(region.backdropStatics||[])].map(item=>({item,placement:staticPlacement(mapPoint(item.x,item.y),item),floor:isFloorSurface(item)}));
 // Group connected upper surfaces so cutaway affects only the building
 // covering the character, along with furniture supported by those surfaces.
 const floorsByCell=new Map(),surfaces=[];
 for(const {item,floor} of placements)if(floor||item.roof){
  const key=item.x+','+item.y,node={x:item.x,y:item.y,z:item.z||0,roof:!!item.roof,group:-1};
  if(!floorsByCell.has(key))floorsByCell.set(key,[]);
  floorsByCell.get(key).push(node);surfaces.push(node);
 }
 let surfaceGroup=0;
 for(const start of surfaces){
  if(start.group!==-1)continue;
  start.group=surfaceGroup++;const queue=[start];
  for(let n=0;n<queue.length;n++){
   const node=queue[n];
   for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])
    for(const next of floorsByCell.get((node.x+dx)+','+(node.y+dy))||[])
     if(next.group===-1&&next.roof===node.roof&&Math.abs(next.z-node.z)<=(node.roof?8:2)){
      next.group=start.group;queue.push(next);
     }
  }
 }
 // Query visible art bounds instead of visiting the entire original town on
 // every frame. Index the sprite's full bounds, including elevated roofs.
 const staticBuckets=new Map(),BUCKET=512;
 for(const entry of placements){const p=entry.placement;
  for(let x=Math.floor(p.left/BUCKET);x<=Math.floor((p.left+p.width)/BUCKET);x++)
   for(let y=Math.floor(p.top/BUCKET);y<=Math.floor((p.top+p.height)/BUCKET);y++){
    const key=x+','+y;if(!staticBuckets.has(key))staticBuckets.set(key,[]);staticBuckets.get(key).push(entry);
   }
 }
 const sightBlocked=new Set();
 for(const {item} of placements){
  if(!inside(item.x,item.y))continue;
  const i=item.x*height+item.y,eye=(region.walkZ?.[i]??region.tiles[i]?.[1]??0)+14;
  // Art includes the isometric footprint and can be much taller than the
  // physical tile. In particular NoShoot floor tiles are zero-height supports,
  // not walls stretching up through the occupants' eye level.
  const top=item.z+Math.max(0,item.height||0);
  if((item.flags&0x3010)&&item.z<=eye&&top>=eye)sightBlocked.add(i);
 }
 function isPassable(x,y){const i=indexAt(x,y);return i>=0&&!blocked.has(i);}
 function isPlayable(x,y){return playable.has(indexAt(x,y));}
 function isSightPassable(x,y){const i=indexAt(x,y);return i>=0&&!sightBlocked.has(i);}
 function nearest(x,y,indices,check){
  let best=null,distance=Infinity;
  for(const i of indices){const p=pointAt(i),d=(p.x-x)**2+(p.y-y)**2;if(d<distance&&(!check||check(p.x,p.y))){best=p;distance=d;}}
  return best;
 }
 function nearestPlayable(x,y,time=0,canOccupy=null){
  if(isPlayable(x,y)&&(!canOccupy||canOccupy(x,y)))return {x,y};
  const cells=physical?[...physical]:main;
  return nearest(x,y,cells,canOccupy)||nearest(x,y,cells)||{...(region.spawn||mapPoint(width/2,height/2))};
 }
 function nearestPassable(x,y){
  if(isPassable(x,y))return {x,y};
  const all=[];for(let i=0;i<width*height;i++)if(validIndex(i))all.push(i);
  return nearest(x,y,all)||nearestPlayable(x,y);
 }
 function canStand(p,radius){
  if(!isPlayable(p.x,p.y))return false;
  const r=Math.max(0,Number(radius)||0)*.5;
  return [[r,0],[-r,0],[0,r],[0,-r],[r*.707,r*.707],[-r*.707,r*.707],[r*.707,-r*.707],[-r*.707,-r*.707]].every(([dx,dy])=>isPlayable(p.x+dx,p.y+dy));
 }
 // Index spawn cells in projected screen space, including native elevation.
 // A large location never requires a full-map scan for each new monster.
 const spawnBuckets=new Map(),SPAWN_BUCKET=256;
 function indexSpawnCells(){spawnBuckets.clear();
 for(const i of main){const p=pointAt(i),sy=p.y-elevationAt(p.x,p.y)*Z_SCALE;
  const key=Math.floor(p.x/SPAWN_BUCKET)+','+Math.floor(sy/SPAWN_BUCKET);
  if(!spawnBuckets.has(key))spawnBuckets.set(key,[]);spawnBuckets.get(key).push({...p,sy});
 }
 }
 indexSpawnCells();
 function randomSpawn(random=Math.random,player=region.spawn||{x:0,y:0},radius=12,boss=false,viewport={width:960,height:600}){
  ensurePlayerComponent(player);
  if(!main.length)return null;
  const w=Math.max(1,viewport.width),h=Math.max(1,viewport.height),cy=player.y-elevationAt(player.x,player.y)*Z_SCALE;
  const side=Math.min(w*.2,Math.max(32,radius)),head=Math.min(h*.45,Math.max(boss?180:90,radius+30)),bottom=Math.min(h*.15,Math.max(32,radius*.5));
  const left=player.x-w/2+side,right=player.x+w/2-side,top=cy-h/2+head,end=cy+h/2-bottom;
  const minimum=Math.max(60,radius*.5+(player.radius||12)+18),preferred=Math.max(minimum,Math.min(boss?200:viewport.spread?Math.min(w,h)*viewport.spread:140,Math.min(w,h)*.45));
  const candidates=[];
  for(let x=Math.floor(left/SPAWN_BUCKET);x<=Math.floor(right/SPAWN_BUCKET);x++)
   for(let y=Math.floor(top/SPAWN_BUCKET);y<=Math.floor(end/SPAWN_BUCKET);y++)
    for(const p of spawnBuckets.get(x+','+y)||[])
     if(p.x>=left&&p.x<=right&&p.sy>=top&&p.sy<=end&&Math.hypot(p.x-player.x,p.y-player.y)>=minimum)candidates.push(p);
  const roll=()=>Math.max(0,Math.min(.999999999,Number(random())||0));
  for(let tries=0;tries<Math.min(64,candidates.length);tries++){
   const p=candidates[Math.floor(roll()*candidates.length)];
   if(Math.hypot(p.x-player.x,p.y-player.y)>=preferred&&(!Number.isFinite(viewport.angle)||Math.cos(Math.atan2(p.sy-cy,p.x-player.x)-viewport.angle)>.5)&&canStand(p,radius))return {x:p.x,y:p.y};
  }
  // Small rooms may need closer spawns, but never an offscreen fallback.
  const start=Math.floor(roll()*candidates.length);
  for(let n=0;n<candidates.length;n++){const p=candidates[(start+n)%candidates.length];if(canStand(p,radius))return {x:p.x,y:p.y};}
  return null;
 }
 let cachedGate=null;
 function gatePoint(player=null){
  const fixed=!player;if(fixed&&cachedGate)return {...cachedGate};
  player=player||region.spawn||mapPoint(width/2,height/2);
  ensurePlayerComponent(player);
  const target={x:player.x+120,y:player.y};
  const point=nearest(target.x,target.y,main,(x,y)=>canStand({x,y},16))||nearest(target.x,target.y,main)||{...player};
  if(fixed)cachedGate=point;return {...point};
 }
 function drawGround(ctx,camera,w,h){
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
  let loaded=false;
  for(const chunk of [...(region.backdropGrounds||[]),...(region.grounds||[])]){const im=image(chunk.image);if(!im)continue;loaded=true;
   const cw=chunk.width||im.width,ch=chunk.height||im.height;
   if(chunk.left+cw<camera.x||chunk.left>camera.x+w||chunk.top+ch<camera.y||chunk.top>camera.y+h)continue;
   ctx.drawImage(im,chunk.left-camera.x,chunk.top-camera.y);
  }
  ctx.restore();return loaded;
 }
 function hueImage(key,value){
  const base=image(key),id=hueIdentity(value);if(!base||!id.id||!palettes[id.id]||typeof document==='undefined')return base;
  const cacheKey=key+':'+value;if(hued.has(cacheKey)){const cached=hued.get(cacheKey);hued.delete(cacheKey);hued.set(cacheKey,cached);return cached;}
  const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height;const g=canvas.getContext('2d');
  if(base.bitmap)g.drawImage(base.bitmap,base.sx,base.sy,base.width,base.height,0,0,base.width,base.height);else g.drawImage(base,0,0);
  const pixels=g.getImageData(0,0,canvas.width,canvas.height);applyHue(pixels.data,palettes[id.id],id.partial);g.putImageData(pixels,0,0);
  const bytes=canvas.width*canvas.height*4;
  if(bytes<=32*1024*1024){while(hueBytes+bytes>32*1024*1024&&hued.size){const oldest=hued.keys().next().value,entry=hued.get(oldest);hueBytes-=entry.width*entry.height*4;hued.delete(oldest);}hued.set(cacheKey,canvas);hueBytes+=bytes;}
  return canvas;
 }
 function decorations(camera,w,h,time=0,hero=null){
  const result=[],heroZ=hero?elevationAt(hero.x,hero.y):0,heroY=hero?hero.y-heroZ*Z_SCALE:0;
  const heroCell=hero?mapCell(hero.x,hero.y):null;
  const hiddenGroups=new Set(heroCell?(floorsByCell.get(heroCell.a+','+heroCell.b)||[]).filter(surface=>surface.z>heroZ+14).map(surface=>surface.group):[]);
  const visible=new Set();
  for(let x=Math.floor((camera.x-30)/BUCKET);x<=Math.floor((camera.x+w+30)/BUCKET);x++)
   for(let y=Math.floor((camera.y-30)/BUCKET);y<=Math.floor((camera.y+h+30)/BUCKET);y++)
    for(const entry of staticBuckets.get(x+','+y)||[])visible.add(entry);
  const hiddenTrees=new Set(),treeBases=new Map(),drawnStumps=new Set();
  for(const {item,placement:p,floor} of visible)if(isTreeScenery(item)){
   const key=item.x+','+item.y,base=treeBases.get(key);
   if(!base||item.z<base.z)treeBases.set(key,item);
   if(overlaysCharacter(p,hero,heroZ,staticDepth(mapPoint(item.x,item.y),item,floor)))hiddenTrees.add(key);
  }
  for(const {item,placement:p,floor} of visible){
   const treeKey=item.x+','+item.y;
   if(isTreeScenery(item)&&hiddenTrees.has(treeKey)){
    if(!drawnStumps.has(treeKey)){
     drawnStumps.add(treeKey);const stump=image('tree-stump'),base=treeBases.get(treeKey),point=mapPoint(item.x,item.y);
     if(stump){const placement=staticPlacement(point,{z:base.z,classicArt:true,bounds:[stump.width-1,stump.height-1,0,0]});
      result.push({x:point.x,y:staticDepth(point,base),item:{...base,name:'stump'},region:region.name,draw(g,cam=camera){g.drawImage(stump,placement.left-cam.x,placement.top-cam.y);}});
     }
    }
    continue;
   }
   if(/^no\s*draw$/i.test(item.name||''))continue;
   if(hiddenGroups.size&&(floorsByCell.get(item.x+','+item.y)||[]).some(surface=>hiddenGroups.has(surface.group)&&surface.z>heroZ+14&&item.z>=surface.z))continue;
   const {x,y,left,top,width:pw,height:ph,depth,flat}=p;
   if(left+pw<camera.x-30||left>camera.x+w+30||top+ph<camera.y-30||top>camera.y+h+30)continue;
   const im=hueImage(item.image,item.hue);if(!im)continue;
   const drawDepth=staticDepth(mapPoint(item.x,item.y),item,floor);
   result.push({x,y:drawDepth,item,region:region.name,draw(g,cam=camera){
    const drawArt=()=>{
     if(flat){g.beginPath();g.moveTo(x-cam.x,y-cam.y);g.lineTo(x+22-cam.x,y+22-cam.y);g.lineTo(x-cam.x,y+44-cam.y);g.lineTo(x-22-cam.x,y+22-cam.y);g.closePath();g.clip();if(im.bitmap)g.drawImage(im.bitmap,im.sx,im.sy,im.width,im.height,left-cam.x,top-cam.y,44,44);else g.drawImage(im,left-cam.x,top-cam.y,44,44);}
     else g.drawImage(im.bitmap||im,im.sx||0,im.sy||0,Math.min(pw,im.width),Math.min(ph,im.height),left-cam.x,top-cam.y,pw,ph);
    };
    const reveal=obstructsCharacter(item,p,hero,heroZ,drawDepth)&&(!floor||item.z>heroZ+2);
    if(reveal){
     const circle=transparencyCircle(hero,heroZ),cx=circle.x-cam.x,cy=circle.y-cam.y;
     // Preserve the building outside the character-centred reveal circle.
     g.save();g.beginPath();g.rect(left-cam.x-1,top-cam.y-1,pw+2,ph+2);g.moveTo(cx+circle.radius,cy);g.arc(cx,cy,circle.radius,0,Math.PI*2);g.clip('evenodd');drawArt();g.restore();
     g.save();g.beginPath();g.arc(cx,cy,circle.radius,0,Math.PI*2);g.clip();g.globalAlpha*=.15;drawArt();g.restore();
    }else {g.save();drawArt();g.restore();}
    if(item.light){g.save();g.globalCompositeOperation='screen';const glow=g.createRadialGradient(x-cam.x,y-ph*.55-cam.y,0,x-cam.x,y-ph*.55-cam.y,70);glow.addColorStop(0,'#ffca6745');glow.addColorStop(1,'#ffbf5000');g.fillStyle=glow;g.fillRect(x-70-cam.x,y-ph*.55-70-cam.y,140,140);g.restore();}
   }});
  }
  return result;
 }
 const selectedManifest={...manifest,regions:[region]};
 return {manifest:selectedManifest,stageAt:()=>0,areaAt:()=>region.areaId,regionName:()=>region.name,update:(camera,w,h)=>assetStore?.update(camera,w,h),reset:()=>{},
  snapshot:()=>({version:4,areaId:region.areaId,origin:{sourceX:region.sourceX??0,sourceY:region.sourceY??0}}),restore:()=>{},
  isPassable,isPlayable,isSightPassable,nearestPassable,nearestPlayable,nearestMainPassable:nearestPlayable,
  elevationAt,canTraverse,canOccupySegment,screenElevationAt:(x,y)=>elevationAt(x,y)*Z_SCALE,drawGround,decorations,randomSpawn,gatePoint,
  nativeRadar:()=>({image:image(region.radar),originX:region.radarOriginX??height-1,originY:region.radarOriginY||0}),
  get loadingGround(){return assetStore?.loadingGround||false;},
  get performanceStats(){return {...(assetStore?.stats||{groundBytes:0,groundHits:0,groundMisses:0,groundReadbacks:0,groundEntries:0}),hueBytes};}};
}
