// Requires extracted resources. Run with Electron; captures desktop and portrait HUDs.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../.cache/hud-layout');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(win,code){const deadline=Date.now()+90000;while(Date.now()<deadline){if(await win.webContents.executeJavaScript(code))return;await wait(80);}throw Error('Timed out: '+code);}
app.whenReady().then(async()=>{
 process.env.PORT='0';process.env.HOST='127.0.0.1';const {server}=await import('../tools/serve.mjs');
 if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
 let win;
 try{
  for(const [width,height,mobile] of [[390,844,false],[320,568,true],[1280,900,false]]){
   win=new BrowserWindow({width,height,useContentSize:true,show:false});
   const js=code=>win.webContents.executeJavaScript(code);
   await win.loadURL('http://127.0.0.1:'+server.address().port+'/?'+(mobile?'mobile=1':''));
   await until(win,'!!window.britannia');await js('window.britannia.start({seed:12345})');
   await until(win,"!document.getElementById('hud').classList.contains('hidden') && !document.getElementById('zone-title').hidden");
   const metrics=await js(`(()=>{
    const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    return {hud:box('#hud'),xp:box('.hud-experience'),player:box('.player-panel'),map:box('#minimap'),pause:box('#pause'),timeline:box('#zone-timeline'),title:document.getElementById('zone-title').textContent,
     clock:getComputedStyle(document.getElementById('clock')).display,zone:getComputedStyle(document.querySelector('#zone strong')).display,xpLabel:getComputedStyle(document.querySelector('.xp-label')).display};})()`);
   assert(Math.abs(metrics.xp.width-metrics.hud.width)<1,JSON.stringify(metrics));
   assert(metrics.xp.bottom<=metrics.player.top&&metrics.xp.bottom<=metrics.map.top,JSON.stringify(metrics));
   assert(metrics.player.right<=metrics.map.left+1,JSON.stringify(metrics));
   assert(Math.abs(metrics.pause.right-metrics.hud.right)<1&&Math.abs(metrics.pause.bottom-metrics.hud.bottom)<1,JSON.stringify(metrics));
   assert(metrics.timeline.top>=metrics.player.top&&metrics.timeline.bottom<=metrics.player.bottom,JSON.stringify(metrics));
   assert.equal(metrics.clock,'none');assert.equal(metrics.zone,'none');assert.equal(metrics.xpLabel,'none');assert(metrics.title);
   if(width<=390)assert(metrics.map.width<=128,JSON.stringify(metrics));
   await until(win,'window.britannia.viewport.topInset>0');
   assert(await js(`(()=>{const view=window.britannia.viewport,r=document.getElementById('world').getBoundingClientRect(),bottom=Math.max(document.querySelector('.player-panel').getBoundingClientRect().bottom,document.getElementById('minimap').getBoundingClientRect().bottom);return Math.abs(view.topInset*view.zoom-Math.min(r.height*.4,bottom-r.top+8))<1;})()`),'camera inset follows actual HUD bottom');
   await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   fs.writeFileSync(path.join(out,'zone-entry-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
   await wait(2100);assert(await js("document.getElementById('zone-title').hidden"),'zone title expires after two seconds');
   fs.writeFileSync(path.join(out,'hud-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
   if(width===390){
    for(const percent of [50,125]){
     await js("window.britannia.pause();document.getElementById('pause-options').click()");
     assert.equal(await js("document.getElementById('option-zoom').type"),'range');
     await js(`(()=>{const slider=document.getElementById('option-zoom');slider.value=${percent};slider.dispatchEvent(new Event('input'));})()`);
     assert.equal(await js('window.britannia.viewport.zoom'),percent/100);
     await js("document.getElementById('options-back').click();document.getElementById('resume').click()");
     await until(win,'!window.britannia.mapRegions.loadingGround');
     await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     fs.writeFileSync(path.join(out,'zoom-'+percent+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    await win.loadURL('http://127.0.0.1:'+server.address().port);await until(win,'!!window.britannia');
    assert.equal(await js('window.britannia.viewport.zoom'),1.25,'slider zoom survives page reload');
    await js("localStorage.removeItem('britannia-mobile-zoom')");
   }
   win.destroy();console.log('PASS HUD '+width+'x'+height+(mobile?' forced mobile':' desktop'));
  }
  server.close();app.exit(0);
 }catch(error){console.error(error);win?.destroy();server.close();app.exit(1);}
});
