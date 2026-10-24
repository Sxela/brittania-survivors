// Requires locally extracted assets. Run: electron tests/loading-screen.browser.cjs
const {app,BrowserWindow}=require('electron');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../game');
app.setPath('userData',path.resolve(__dirname,'../.cache/loading-screen-browser'));
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
let areaMode='slow',bootFailure=false;
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(bootFailure&&name==='/assets/audio/manifest.json'){res.writeHead(503);res.end('unavailable');return;}
  const area=name.includes('/mobile-locations/')&&!name.endsWith('/manifest.json');
  if(area&&areaMode==='fail'){res.writeHead(503);res.end('unavailable');return;}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  const send=()=>{
    const types={'.mjs':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
    res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','content-length':fs.statSync(file).size,'cache-control':'no-store'});
    fs.createReadStream(file).pipe(res);
  };
  if(area&&areaMode==='slow')setTimeout(send,1500);else send();
});
async function waitFor(win,expression){
  const until=Date.now()+90000;
  while(Date.now()<until){if(await win.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error('Timed out waiting for '+expression);
}
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    for(const [width,height,mobile] of [[1280,900,false],[390,844,true]]){
      const win=new BrowserWindow({width,height,show:false,webPreferences:{backgroundThrottling:false,offscreen:true}});
      await win.loadURL(url+(mobile?'/?mobile=1':''));
      await waitFor(win,'!!window.britannia');
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("asset-loading").hidden'),true);
      await win.webContents.executeJavaScript(`window.loadingSamples=[];new MutationObserver(()=>{const p=document.querySelector('#asset-loading-progress');window.loadingSamples.push({label:document.querySelector('#asset-loading-label').textContent,detail:document.querySelector('#asset-loading-detail').textContent,value:p.value});}).observe(document.querySelector('#asset-loading'),{subtree:true,attributes:true,childList:true,characterData:true});window.startPromise=window.britannia.start();true`);
      await waitFor(win,'!document.getElementById("asset-loading").hidden && document.getElementById("asset-loading-label").textContent.includes(" data")');
      const metrics=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.asset-loading-card').getBoundingClientRect(),p=document.querySelector('progress').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,bar:p.width};})()`);
      assert(metrics.left>=0&&metrics.right<=metrics.width&&metrics.top>=0&&metrics.bottom<=metrics.height&&metrics.bar>0,JSON.stringify(metrics));
      const out=path.resolve(__dirname,'../.cache/screenshots');fs.mkdirSync(out,{recursive:true});
      fs.writeFileSync(path.join(out,mobile?'loading-mobile.png':'loading-desktop.png'),(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.startPromise');
      assert.equal(await win.webContents.executeJavaScript('window.loadingSamples.some(s=>s.label==="Loading area artwork" && s.value>0 && s.detail.includes("files"))'),true);
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("asset-loading").hidden && window.britannia.game.status==="playing"'),true);
      areaMode='fail';await win.reload();await waitFor(win,'!!window.britannia');
      await win.webContents.executeJavaScript('window.britannia.start()');
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("asset-loading").hidden && !document.getElementById("start").disabled && document.getElementById("menu-message").textContent.includes("HTTP 503")'),true);
      areaMode='slow';win.destroy();console.log('Loading UI passed: '+width+'x'+height);
    }
    bootFailure=true;
    const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
    await win.loadURL(url);
    await waitFor(win,'!document.getElementById("asset-loading-retry").hidden');
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("asset-loading").hidden'),false);
    win.destroy();console.log('Startup failure shows retry.');server.close();app.exit(0);
  }catch(error){console.error(error);server.close();app.exit(1);}
});
