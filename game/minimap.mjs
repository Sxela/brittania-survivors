// Original Classic radar art, native aperture, radar colors, and 1:22 world scale.

// Each original radar cell occupies two integer pixels. Copy those pixels
// directly; antialiased polygon clips leave a visible grid between patches.
export function composeRadarPixels(sources,indices){
  const pixels=new Uint8ClampedArray(128*128*4);
  for(let a=0;a<64;a++)for(let b=0;b<64;b++){
    const source=sources[indices[(a>>2)*16+(b>>2)]];if(!source)continue;
    const x=a-b+63,y=a+b;
    for(let row=0;row<2;row++){const offset=((y+row)*128+x)*4;for(let channel=0;channel<4;channel++)pixels[offset+channel]=source[offset+channel];}
  }
  return pixels;
}

export function radarPoint(entity,hero,manifest){
  const scale=manifest.worldPixelsPerRadarPixel||22;
  return {x:manifest.center.x+(entity.x-hero.x)/scale,y:manifest.center.y+(entity.y-hero.y)/scale};
}

export function radarContains(point,manifest){
  const row=manifest.aperture.rows.find(row=>row[0]===Math.floor(point.y));
  return !!row&&point.x>=row[1]&&point.x<row[1]+row[2];
}

export function radarChunks(mapRegions,hero,time,manifest){
  const a=(hero.x+hero.y)/44,b=(hero.y-hero.x)/44;
  const current=mapRegions.stageAt?.(time)??Math.max(0,Math.min(manifest.regions.length-1,Math.floor(time/100)));
  const state=mapRegions.radarSector?[]:mapRegions.snapshot?.()||[];
  const saved=new Map((Array.isArray(state)?state:state.chunks||[]).map(([x,y,index])=>[`${x},${y}`,index]));
  const chunks=[];
  // The 141px native aperture spans at most three 64-tile sectors per axis.
  for(let x=Math.floor(a/64)-2;x<=Math.floor(a/64)+2;x++)for(let y=Math.floor(b/64)-2;y<=Math.floor(b/64)+2;y++){
    const index=saved.get(`${x},${y}`)??current;
    if(manifest.regions[index])chunks.push({x,y,index});
  }
  return chunks;
}

export function createNativeMinimap(manifest,images){
  const image=key=>images instanceof Map?images.get(key):images[key];
  const cache=new Map(),sourcePixels=[];
  function sectorImage(map,chunk,time){
    if(!map.radarSector||typeof document==='undefined')return image(manifest.regions[chunk.index].image);
    const state=map.radarSector(chunk.x,chunk.y,time);if(cache.has(state.key))return cache.get(state.key);
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const g=canvas.getContext('2d');g.imageSmoothingEnabled=false;
    for(let i=0;i<manifest.regions.length;i++)if(!sourcePixels[i]){const source=image(manifest.regions[i].image);if(source){g.clearRect(0,0,128,128);g.drawImage(source,0,0);sourcePixels[i]=g.getImageData(0,0,128,128).data;}}
    const pixels=g.createImageData(128,128);pixels.data.set(composeRadarPixels(sourcePixels,state.indices));g.putImageData(pixels,0,0);
    cache.set(state.key,canvas);while(cache.size>32)cache.delete(cache.keys().next().value);return canvas;
  }
  function draw(ctx,mapRegions,game){
    const hero=game?.player;if(!hero)return;
    const {width,height,center,aperture}=manifest;
    ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=false;
    const frame=image(manifest.frame);if(frame)ctx.drawImage(frame,0,0);
    ctx.save();ctx.beginPath();
    // Preserve the exact original pixel aperture, including its stepped edge.
    for(const [y,x,width]of aperture.rows)ctx.rect(x,y,width,1);
    ctx.clip();ctx.fillStyle='#080808';ctx.fillRect(0,0,width,height);
    const scale=manifest.worldPixelsPerRadarPixel||22;
    const native=mapRegions.nativeRadar?.();
    if(native?.image)ctx.drawImage(native.image,center.x-(native.originX||0)-hero.x/scale,center.y-(native.originY||0)-hero.y/scale);
    else for(const chunk of radarChunks(mapRegions,hero,game.time,manifest)){
      const sector=sectorImage(mapRegions,chunk,game.time);if(!sector)continue;
      ctx.drawImage(sector,center.x+(chunk.x-chunk.y)*64-63-hero.x/scale,center.y+(chunk.x+chunk.y)*64-hero.y/scale);
    }
    const dot=(entity,color,size)=>{const p=radarPoint(entity,hero,manifest);if(!radarContains(p,manifest))return;ctx.fillStyle=color;ctx.fillRect(Math.floor(p.x-size/2),Math.floor(p.y-size/2),size,size);};
    for(const drop of game.pickups||[])dot(drop,drop.kind==='xp'?'#8bdeb0':['gold','ore'].includes(drop.kind)?'#efd063':drop.kind==='heal'?'#ef8b83':'#bca2eb',2);
    for(const enemy of game.enemies||[])if(enemy.hp>0){const p=radarPoint(enemy,hero,manifest);if(!radarContains(p,manifest))continue;ctx.beginPath();ctx.arc(p.x,p.y,enemy.boss?2.5:1.8,0,Math.PI*2);ctx.fillStyle='#ff3030';ctx.fill();ctx.strokeStyle='#400000';ctx.lineWidth=.7;ctx.stroke();}
    if(game.zoneRun?.phase==='cleared'&&mapRegions.gatePoint)dot(game.zoneRun.gate||mapRegions.gatePoint(hero),'#91dfff',5);
    dot(hero,'#ffffff',3);ctx.restore();
  }
  return {draw,manifest};
}
