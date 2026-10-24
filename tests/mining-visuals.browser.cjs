// Requires extracted assets. Run: electron tests/mining-visuals.browser.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../.cache/mining-visuals-browser'));
app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
const out=path.resolve(__dirname,'../.cache/mining-visuals');fs.mkdirSync(out,{recursive:true});
async function waitFor(win,expression){const until=Date.now()+90000;while(Date.now()<until){if(await win.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,70));}throw Error('Timed out: '+expression);}
async function inspectMining(){
 const {WorldAppearance}=await import('/world-appearance.mjs'),{OriginalEffects}=await import('/classic-effects.mjs');
 const manifest=await fetch('/assets/world-equipment/manifest.json').then(r=>r.json());
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=560;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#26342a';ctx.fillRect(0,0,900,560);
 const appearance=new WorldAppearance(ctx,manifest,window.britannia.huePalettes),game=window.britannia.game;
 const saved={pickups:game.pickups,sex:game.player.sex},calls=[],sprite=appearance.sprite.bind(appearance);
 appearance.sprite=(def,...args)=>{calls.push(def?.src);return sprite(def,...args);};
 try{
  for(const [index,sex]of ['male','female'].entries()){
   game.player.sex=sex;game.pickups=[{kind:'ore',mining:true,progress:.65,x:game.player.x+25,y:game.player.y}];await appearance.warm(game);
   for(let i=0;i<4;i++){game.pickups[0].progress=i*.75;appearance.player(game,90+i*160,130+index*150,false,0);}
   if(!calls.includes(manifest.playerBases[sex].mine.src))throw Error('Missing native mining body '+sex);
   if(!calls.includes(manifest.equipment['3718'].layers[sex].mine.src))throw Error('Missing pickaxe layer '+sex);
  }
 }finally{game.player.sex=saved.sex;game.pickups=saved.pickups;}
 for(let i=0;i<3;i++){const art=window.britannia.uiManifest.images['resources/gold-rock-'+i];await appearance.load(art.src);appearance.sprite({src:art.src,cellWidth:art.width,cellHeight:art.height,framesPerDirection:1,anchorX:art.width/2,anchorY:art.height},800,90+i*90,{row:0,mirror:false},0,0x8a5);}
 const effects=new OriginalEffects(ctx,window.britannia.spellEffects.manifest);effects.images=window.britannia.spellEffects.images;
 for(const [row,kind]of ['explosion','flame-strike'].entries()){
  const life=kind==='explosion'?1.3:3;
  for(let i=0;i<5;i++){const x=80+i*165,y=390+row*150;effects.effect({kind,x,y,life:life*(1-i/5),maxLife:life},{x:0,y:0},0);}
 }
 return {png:canvas.toDataURL(),calls:calls.filter(Boolean).length,sex:game.player.sex};
}
app.whenReady().then(async()=>{
 process.env.PORT='0';process.env.HOST='127.0.0.1';const {server}=await import('../tools/serve.mjs');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));let win;
 try{
  for(const mobile of [false,true]){
   win=new BrowserWindow({width:mobile?390:1280,height:mobile?844:900,show:false,webPreferences:{backgroundThrottling:false,offscreen:true}});
   const errors=[];win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
   await win.loadURL('http://127.0.0.1:'+server.address().port+(mobile?'/?mobile=1':''));await waitFor(win,'!!window.britannia');
   await win.webContents.executeJavaScript(`(async()=>{const {Game}=await import('/core.mjs'),{createZoneRun}=await import('/zone-run.mjs');const g=new Game(window.britannia.runtimeCatalog,{seed:42,difficulty:'hard'});g.zoneRun=createZoneRun(g,g.areaRoute.findIndex(a=>a.name==='Haven Island'));await window.britannia.start({saved:{state:g.snapshot(),map:null}});window.britannia.game.pause();})()`);
   assert(await win.webContents.executeJavaScript('window.britannia.game.pickups.filter(p=>p.kind==="ore").length>=8'));
   const mining=await win.webContents.executeJavaScript('('+inspectMining.toString()+')()');fs.writeFileSync(path.join(out,(mobile?'phone':'desktop')+'-mining-spells.png'),Buffer.from(mining.png.split(',')[1],'base64'));
   // Haven dock: native water, planks and piers share cells here.
   await win.webContents.executeJavaScript(`(async()=>{const {mapPoint}=await import('/map-regions.mjs');Object.assign(window.britannia.game.player,mapPoint(117.5,149.5));document.getElementById('hud').style.visibility='hidden';})()`);
   await new Promise(resolve=>setTimeout(resolve,150));await waitFor(win,'!window.britannia.mapRegions.loadingGround&&!window.britannia.mapRegions.performanceStats.pendingImages');
   fs.writeFileSync(path.join(out,(mobile?'phone':'desktop')+'-haven-dock.png'),(await win.webContents.capturePage()).toPNG());
   const clusters=await win.webContents.executeJavaScript(`(()=>{const game=window.britannia.game,groups=Map.groupBy(game.pickups.filter(p=>p.kind==='ore'),p=>p.clusterId),group=[...groups.values()].find(g=>g.length===4);if(!group)throw Error('No full ore cluster');const center=group[0];Object.assign(game.player,{x:center.x,y:center.y+80});return group.map(p=>({x:p.x,y:p.y,strikes:p.strikes}));})()`);
   assert(clusters.every(p=>p.strikes===1));await new Promise(resolve=>setTimeout(resolve,150));await waitFor(win,'!window.britannia.mapRegions.loadingGround&&!window.britannia.mapRegions.performanceStats.pendingImages');
   fs.writeFileSync(path.join(out,(mobile?'phone':'desktop')+'-ore-cluster.png'),(await win.webContents.capturePage()).toPNG());
   await win.webContents.executeJavaScript('window.britannia.inventory()');
   await waitFor(win,'[...document.querySelectorAll("#dialog img")].every(im=>im.complete)');
   const texture=await win.webContents.executeJavaScript(`(async()=>{const pane=document.createElement('div');pane.className='aos-properties';pane.style.cssText='position:fixed;z-index:9999;left:8px;top:120px;width:calc(100vw - 16px);max-width:600px;padding:30px;text-align:center';pane.textContent='Shirt / Equipped / Double-click to return to the backpack';document.body.append(pane);const art=new Image();art.src='/assets/classic-ui/properties-texture.png';await art.decode();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return getComputedStyle(pane).backgroundImage;})()`);
   assert(texture.includes('properties-texture.png'));fs.writeFileSync(path.join(out,(mobile?'phone':'desktop')+'-parchment.png'),(await win.webContents.capturePage()).toPNG());
   assert.deepEqual(errors,[]);console.log('Haven docks, native mining and spell art passed: '+(mobile?'phone':'desktop'));win.destroy();
  }
  server.close();app.exit(0);
 }catch(error){console.error(error);win?.destroy();server.close();app.exit(1);}
});
