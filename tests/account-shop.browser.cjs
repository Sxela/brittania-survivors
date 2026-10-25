// Real SPA integration with local extracted assets; emulated phone and desktop screenshots.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../.cache/account-shop');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+process.pid));app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(win,code){const deadline=Date.now()+90000;while(Date.now()<deadline){if(await win.webContents.executeJavaScript(code))return;await wait(80);}throw Error('Timed out: '+code);}
app.whenReady().then(async()=>{
 process.env.PORT='0';process.env.HOST='127.0.0.1';const {server}=await import('../tools/serve.mjs');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
 const win=new BrowserWindow({width:1280,height:900,useContentSize:true,show:false});const js=code=>win.webContents.executeJavaScript(code);
 async function capture(name){await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
 try{
  await win.loadURL('http://127.0.0.1:'+server.address().port);await until(win,'!!window.britannia');
  assert.equal(await js("!!document.getElementById('camp-button')"),false);
  assert.equal(await js("document.getElementById('account-shop-button').textContent"),'Upgrades');
  await js("localStorage.removeItem('britannia-run-v1');window.britannia.profile.account.ingots=100;document.getElementById('account-shop-button').click()");
  assert.equal(await js("document.querySelectorAll('[data-account-class]').length"),3);
  await js("document.getElementById('shop-tab').click();document.querySelector('[data-account-upgrade=power]').click()");assert.equal(await js('window.britannia.profile.account.ingots'),80);assert.equal(await js('window.britannia.profile.account.upgrades.power'),1);
  await until(win,`(()=>{const im=document.querySelector('.inventory-toolbar .ingot-icon');return im?.complete&&im.naturalWidth>0&&im.src.endsWith('resources-gold-ingots.png')})()`);
  await capture('account-upgrades-desktop');
  await js(`(()=>{const g=window.britannia.game,source=window.britannia.runtimeCatalog.items.find(i=>i.slot==='ring');const item=g.makeItem(source,'ring',1);item.insured=true;g.inventory.push(item);g.equip(g.inventory.length-1);document.querySelector('[data-account-class=warrior]').click();})()`);
  assert.equal(await js('window.britannia.profile.account.inventory.length>0'),true);
  await js("document.querySelector('[data-item]').click();document.getElementById('equip-selected').click()");
  assert.equal(await js('!!window.britannia.profile.account.equipment.warrior.ring'),true);assert.equal(await js('!!window.britannia.profile.account.equipment.mage.ring'),false);
  await capture('account-wardrobe-desktop');
  win.setContentSize(320,568);await wait(150);
  assert(await js("document.getElementById('dialog').scrollWidth<=document.getElementById('dialog').clientWidth+1"),'phone wardrobe has no horizontal overflow');
  await capture('account-wardrobe-phone');await js("document.getElementById('shop-tab').click()");await capture('account-upgrades-phone');
  await js("document.getElementById('close-dialog').click();window.britannia.start({seed:12345})");await until(win,"window.britannia.game?.status==='playing'&&!document.getElementById('hud').classList.contains('hidden')");
  await js("(async()=>{const {rollZoneSpells}=await import(new URL('/zone-run.mjs',location.href));const g=window.britannia.game;g.enemies=[];g.zoneRun.phase='spellshop';g.zoneRun.bossSpawned=g.zoneRun.bossKilled=true;g.player.gold=10000;rollZoneSpells(g);window.beforeShopIds=g.zoneSpellOffers.map(o=>o.id);window.britannia.zoneSpellShop();})()");
  await wait(1100);await js("document.querySelector('[data-zone-spell=\"0\"]').click()");
  assert.equal(await js("document.querySelector('[data-zone-spell=\"0\"]').textContent"),'Purchased');
  assert.equal(await js("document.querySelector('[data-zone-spell=\"0\"]').disabled"),true);
  assert.deepEqual(await js('window.britannia.game.zoneSpellOffers.map(o=>o.id)'),await js('window.beforeShopIds'));
  await capture('fixed-shop-phone');
  await js("window.britannia.game.zoneRun.phase='combat';window.britannia.game.autoequip=false;window.britannia.inventory();document.getElementById('close-dialog').click()");
  await js("window.britannia.game.player.hp=0;window.britannia.game.status='dead'");await until(win,"!!document.getElementById('return-camp')");
  assert.equal(await js("localStorage.getItem('britannia-run-v1')"),null);assert.equal(await js('window.britannia.profile.account.upgrades.power'),1);
  await js("document.getElementById('return-camp').click()");assert.equal(await js("document.getElementById('continue').classList.contains('hidden')"),true);
  await win.loadURL('http://127.0.0.1:'+server.address().port);await until(win,'!!window.britannia');
  assert.equal(await js('window.britannia.profile.account.upgrades.power'),1);assert.equal(await js('window.britannia.profile.account.ingots'),80);assert.equal(await js('!!window.britannia.profile.account.equipment.warrior.ring'),true);
  console.log('PASS: account purchase, shared insured wardrobe/class transfer, phone layout, death invalidation, reload persistence');win.destroy();server.close();app.exit(0);
 }catch(error){console.error(error);await capture('failure');win.destroy();server.close();app.exit(1);}
});
