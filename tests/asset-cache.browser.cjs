// No client assets required. Run: electron tests/asset-cache.browser.cjs
const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../.cache/asset-cache-browser'));
app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
let revision='a'.repeat(64);const counts=new Map();
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;counts.set(name,(counts.get(name)||0)+1);
  res.setHeader('Cache-Control','no-store');
  if(name==='/'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Persistent cache check</title><script type="module">import {setupAssetCache} from "/asset-cache.mjs";window.cacheReady=setupAssetCache();</script>');return;
  }
  if(name==='/asset-cache-version.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:revision}));return;}
  if(name==='/assets/probe.json'||name==='/data/probe.json'){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({revision}));return;
  }
  if(name==='/assets/probe.svg'){
    res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="gold"/></svg>');return;
  }
  if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(['/asset-cache.mjs','/asset-cache-policy.mjs','/asset-cache-worker.js'].includes(name)){
    res.setHeader('Content-Type','text/javascript');
    let code=fs.readFileSync(path.join(__dirname,'../game',name.slice(1)),'utf8');
    // Fault injection is confined to this test server, never the shipped worker.
    if(name==='/asset-cache-worker.js')code+='\nconst originalPut=Cache.prototype.put;Cache.prototype.put=function(request,response){if(new URL(typeof request==="string"?request:request.url).searchParams.has("quota-test"))return Promise.reject(new DOMException("Storage full","QuotaExceededError"));return originalPut.call(this,request,response);};';
    res.end(code);return;
  }
  res.writeHead(404);res.end('missing');
});
async function waitFor(win,expression){const until=Date.now()+15000;while(Date.now()<until){if(await win.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+expression);}
const read=win=>win.webContents.executeJavaScript('fetch("/assets/probe.json").then(r=>r.json())');
async function ready(win,url){await win.loadURL(url);await waitFor(win,'!!window.cacheReady');assert.equal(await win.webContents.executeJavaScript('window.cacheReady'),true);}
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  let win;
  try{
    win=new BrowserWindow({width:1280,height:900,show:false});await ready(win,url);
    assert.equal((await read(win)).revision,revision);
    await waitFor(win,'caches.match(location.origin+"/assets/probe.json").then(Boolean)');
    assert.equal((await read(win)).revision,revision);assert.equal(counts.get('/assets/probe.json'),1);
    await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src="/assets/probe.svg";document.body.append(image);})');
    await waitFor(win,'caches.match(location.origin+"/assets/probe.svg").then(Boolean)');
    win.destroy();
    win=new BrowserWindow({width:390,height:844,show:false});await ready(win,url);
    assert.equal((await read(win)).revision,revision);assert.equal(counts.get('/assets/probe.json'),1);
    await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src="/assets/probe.svg";document.body.append(image);})');
    assert.equal(counts.get('/assets/probe.svg'),1);
    for(let i=0;i<2;i++)await win.webContents.executeJavaScript('fetch("/data/probe.json").then(r=>r.json())');
    assert.equal(counts.get('/data/probe.json'),2);
    for(let i=0;i<2;i++)assert.equal(await win.webContents.executeJavaScript('fetch("/assets/missing.json").then(r=>r.status)'),404);
    assert.equal(counts.get('/assets/missing.json'),2);
    revision='b'.repeat(64);await ready(win,url);
    assert.equal((await read(win)).revision,revision);assert.equal(counts.get('/assets/probe.json'),2);
    await waitFor(win,'caches.match(location.origin+"/assets/probe.json").then(Boolean)');
    await win.webContents.executeJavaScript('localStorage.setItem("britannia-run-v1","keep this save");caches.open("unrelated-app").then(c=>c.put("/unrelated",new Response("keep"))).then(()=>import("/asset-cache.mjs")).then(m=>m.clearAssetCache())');
    assert.equal(await win.webContents.executeJavaScript('localStorage.getItem("britannia-run-v1")'),'keep this save');
    assert.equal(await win.webContents.executeJavaScript('caches.has("unrelated-app")'),true);
    await read(win);assert.equal(counts.get('/assets/probe.json'),3);
    for(let i=0;i<2;i++)assert.equal((await win.webContents.executeJavaScript('fetch("/assets/probe.json?quota-test=1").then(r=>r.json())')).revision,revision);
    assert.equal(counts.get('/assets/probe.json'),5);
    assert.equal(await win.webContents.executeJavaScript('caches.match(location.origin+"/assets/probe.json?quota-test=1").then(Boolean)'),false);
    console.log('Persistent asset cache passed: new page and phone window reuse JSON/images without network; asset revision refreshes; errors/code data stay uncached; clearing preserves saves; full storage falls back to downloads.');
    win.destroy();server.close();app.exit(0);
  }catch(error){console.error(error);win?.destroy();server.close();app.exit(1);}
});
