// Requires extracted and optimized maps. Run: electron tests/map-streaming.browser.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../.cache/map-streaming-browser'));
app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
const out=path.resolve(__dirname,'../.cache/map-streaming');fs.mkdirSync(out,{recursive:true});
async function waitFor(win,expression){const until=Date.now()+90000;while(Date.now()<until){if(await win.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,60));}throw Error('Timed out: '+expression);}

async function compareScene() {
  const {createLocationMap}=await import('/location-map.mjs');
  const {MapAssetStore}=await import('/map-asset-store.mjs');
  const game=window.britannia.game,optimized=window.britannia.mapManifest;
  const index=await fetch('/assets/mobile-locations/manifest.json').then(r=>r.json());
  const original=await fetch('/'+index.areas[game.currentArea().id].src).then(r=>r.json());
  original.images['tree-stump']=window.britannia.uiManifest.images['scenery/tree-stump'];
  const w=640,h=480,hero={...game.player},camera={x:hero.x-w/2,y:hero.y-game.elevationAt(hero.x,hero.y)*4-h/2};
  const placeholders=Object.fromEntries(Object.entries(original.images).map(([key,entry])=>[key,{width:entry.width,height:entry.height}]));
  const probe=createLocationMap(original,placeholders);
  const keys=new Set(probe.decorations(camera,w,h,game.time,hero).map(object=>object.item.image));keys.add('tree-stump');
  for(const chunk of [...original.regions[0].grounds,...(original.regions[0].backdropGrounds||[])])if(chunk.left+chunk.width>=camera.x&&chunk.left<=camera.x+w&&chunk.top+chunk.height>=camera.y&&chunk.top<=camera.y+h)keys.add(chunk.image);
  const images={};await Promise.all([...keys].filter(key=>original.images[key]).map(async key=>{images[key]=await createImageBitmap(await (await fetch('/'+original.images[key].src)).blob());}));
  const store=new MapAssetStore(optimized,{margin:0});await store.preload(camera,w,h);
  const oldMap=createLocationMap(original,images,{palettes:window.britannia.huePalettes});
  const newMap=createLocationMap(optimized,store.images,{palettes:window.britannia.huePalettes});
  function render(map){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;map.drawGround(ctx,camera,w,h);for(const object of map.decorations(camera,w,h,game.time,hero).sort((a,b)=>a.y-b.y))object.draw(ctx,camera);return {pixels:ctx.getImageData(0,0,w,h).data,url:canvas.toDataURL()};}
  const before=render(oldMap),after=render(newMap);let different=0,maxDifference=0;
  for(let i=0;i<before.pixels.length;i++)if(before.pixels[i]!==after.pixels[i]){different++;maxDifference=Math.max(maxDifference,Math.abs(before.pixels[i]-after.pixels[i]));}
  store.dispose();for(const image of Object.values(images))image.close();
  return {different,maxDifference,before:before.url,after:after.url};
}

app.whenReady().then(async()=>{
  process.env.PORT='0';process.env.HOST='127.0.0.1';const {server}=await import('../tools/serve.mjs');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  let win;const report=[];
  try{
    for(const mobile of [false,true]){
      win=new BrowserWindow({width:mobile?390:1280,height:mobile?844:900,show:false,webPreferences:{backgroundThrottling:false,offscreen:true}});
      const errors=[];win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
      await win.loadURL('http://127.0.0.1:'+server.address().port+(mobile?'/?mobile=1':''));await waitFor(win,'!!window.britannia');
      for(const areaName of ['Haven Island','Bet-Lem Reg']){
        const area=JSON.stringify(areaName);
        await win.webContents.executeJavaScript(`(async()=>{const {Game}=await import('/core.mjs'),{createZoneRun}=await import('/zone-run.mjs'),{createLocationMap}=await import('/location-map.mjs');const g=new Game(window.britannia.runtimeCatalog,{archetype:'mage',seed:42,difficulty:'hard'});const i=g.areaRoute.findIndex(a=>a.name===${area});if(i<0)throw Error('Area not found');g.zoneRun=createZoneRun(g,i);const index=await fetch('/assets/optimized-locations/manifest.json').then(r=>r.json()),manifest=await fetch('/'+index.areas[g.currentArea().id].src).then(r=>r.json());const map=createLocationMap(manifest,{}),p=map.nearestPlayable(manifest.regions[0].spawn.x,manifest.regions[0].spawn.y);g.player.x=p.x;g.player.y=p.y;await window.britannia.start({saved:{state:g.snapshot(),map:null}});if(window.britannia.game.currentArea().name!==${area})throw Error('Area did not load');window.britannia.game.pause();})()`);
        assert.equal(await win.webContents.executeJavaScript('window.britannia.mapManifest.optimizedMapsVersion'),1);
        await waitFor(win,'!window.britannia.mapRegions.loadingGround && !window.britannia.mapRegions.performanceStats.pendingImages');
        const initial=await win.webContents.executeJavaScript('window.britannia.mapRegions.performanceStats');
        assert(initial.assetBytes<=(mobile?96:160)*1024*1024,JSON.stringify(initial));
        const visual=await win.webContents.executeJavaScript('('+compareScene.toString()+')()');
        fs.writeFileSync(path.join(out,(mobile?'mobile-':'desktop-')+areaName.replaceAll(' ','-')+'-before.png'),Buffer.from(visual.before.split(',')[1],'base64'));
        fs.writeFileSync(path.join(out,(mobile?'mobile-':'desktop-')+areaName.replaceAll(' ','-')+'-after.png'),Buffer.from(visual.after.split(',')[1],'base64'));
        assert.equal(visual.different,0,areaName+': '+visual.different+' changed channels; max difference '+visual.maxDifference);
        const samples=[];
        for(const fraction of [.1,.45,.8]){
          await win.webContents.executeJavaScript(`(async()=>{const {mapPoint}=await import('/map-regions.mjs');const r=window.britannia.mapManifest.regions[0],cells=r.mainPassable,p=cells[Math.min(cells.length-1,Math.floor(cells.length*${fraction}))],point=mapPoint(Math.floor(p/r.height)+.5,p%r.height+.5);window.britannia.game.player.x=point.x;window.britannia.game.player.y=point.y;})()`);
          await new Promise(resolve=>setTimeout(resolve,100));await waitFor(win,'!window.britannia.mapRegions.loadingGround && !window.britannia.mapRegions.performanceStats.pendingImages');
          const stats=await win.webContents.executeJavaScript('window.britannia.mapRegions.performanceStats');assert(stats.assetBytes<=(mobile?96:160)*1024*1024,JSON.stringify(stats));samples.push(stats);
        }
        const requests=await win.webContents.executeJavaScript('window.britannia.mapRegions.performanceStats.imageRequests');await new Promise(resolve=>setTimeout(resolve,300));
        assert.equal(await win.webContents.executeJavaScript('window.britannia.mapRegions.performanceStats.imageRequests'),requests,'Stationary camera must not continuously reload prefetched ground');
        if(areaName==='Haven Island'){
          const probe=await win.webContents.executeJavaScript(`(async()=>{const {createLocationMap}=await import('/location-map.mjs'),{mapPoint}=await import('/map-regions.mjs'),g=window.britannia.game,r=window.britannia.mapManifest.regions[0],map=window.britannia.mapRegions,old=createLocationMap({regions:[{...r,physicalPassable:undefined}]},{});const fit=(p,m)=>[[0,0],[-g.player.radius,0],[g.player.radius,0],[0,-g.player.radius],[0,g.player.radius]].every(([x,y])=>m.isPlayable(p.x+x,p.y+y));for(const i of r.physicalPassable){const to=mapPoint(Math.floor(i/r.height)+.5,i%r.height+.5);if(old.isPlayable(to.x,to.y)||!fit(to,map))continue;for(let n=0;n<8;n++){const a=n*Math.PI/4,dir={x:Math.cos(a),y:Math.sin(a)},from={x:to.x-dir.x*147.6,y:to.y-dir.y*147.6};if(fit(from,old)&&!map.canTraverse(from,to)){Object.assign(g.player,from);g.player.dashCooldown=0;g.lastDirection=dir;return {from,to};}}}throw Error('No disconnected Haven landing found');})()`);
          await new Promise(resolve=>setTimeout(resolve,100));await waitFor(win,'!window.britannia.mapRegions.loadingGround');
          await win.webContents.executeJavaScript('window.britannia.game.status="playing"');
          win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
          await new Promise(resolve=>setTimeout(resolve,100));
          const landed=await win.webContents.executeJavaScript('(()=>{const g=window.britannia.game;g.status="paused";return {x:g.player.x,y:g.player.y,valid:g.canStand(g.player.x,g.player.y,g.player.radius),cooldown:g.player.dashCooldown};})()');
          assert(landed.valid&&landed.cooldown>0&&Math.hypot(landed.x-probe.to.x,landed.y-probe.to.y)<1,JSON.stringify({probe,landed}));
          await waitFor(win,'!window.britannia.mapRegions.loadingGround');
          fs.writeFileSync(path.join(out,(mobile?'mobile':'desktop')+'-haven-teleport.png'),(await win.webContents.capturePage()).toPNG());
          console.log('Space crossed blocked native scenery to a disconnected Haven floor: '+(mobile?'phone':'desktop'));
        }
        report.push({mobile,area:areaName,pixelDifferences:visual.different,initial,samples});console.log(JSON.stringify(report.at(-1)));
      }
      assert.deepEqual(errors,[]);win.destroy();
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));server.close();app.exit(0);
  }catch(error){console.error(error);win?.destroy();server.close();app.exit(1);}
});
