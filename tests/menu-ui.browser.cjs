// Requires locally extracted resources. Run: electron tests/menu-ui.browser.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.resolve(__dirname,'../.cache/menu-ui-browser'));
app.commandLine.appendSwitch('disable-gpu');app.on('window-all-closed',()=>{});
async function waitFor(win,expression){const until=Date.now()+90000;while(Date.now()<until){if(await win.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,80));}throw Error('Timed out: '+expression);}
async function screenshot(win,file){await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(file,(await win.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  process.env.PORT='0';process.env.HOST='127.0.0.1';
  const {server}=await import('../tools/serve.mjs');if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port,out=path.resolve(__dirname,'../.cache/screenshots');fs.mkdirSync(out,{recursive:true});
  let win;
  try{
    for(const [width,height,mobile] of [[1280,900,false],[768,1024,true],[390,844,true],[320,568,true]]){
      win=new BrowserWindow({width,height,show:false,webPreferences:{backgroundThrottling:false,offscreen:true}});
      await win.loadURL(url+(mobile?'/?mobile=1':''));await waitFor(win,'!!window.britannia');
      await win.webContents.executeJavaScript('document.getElementById("new-game").click()');
      await screenshot(win,path.join(out,'menu-setup-'+width+'.png'));
      await win.webContents.executeJavaScript('window.britannia.start({seed:12345})');
      await win.webContents.executeJavaScript('window.britannia.inventory()');
      await waitFor(win,'[...document.querySelectorAll("#dialog img")].every(image=>image.complete)');
      assert.equal(await win.webContents.executeJavaScript('!!document.querySelector("#paperdoll-backpack,#inventory-shop-jump")'),false);
      const metrics=await win.webContents.executeJavaScript(`(()=>{const dialog=document.getElementById('dialog');return {overflow:dialog.scrollWidth-dialog.clientWidth,images:[...dialog.querySelectorAll('img')].filter(im=>im.getClientRects().length).map(im=>({src:im.src,fit:getComputedStyle(im).objectFit})),buttons:[...dialog.querySelectorAll('button:not(.pack-item)')].filter(b=>b.getClientRects().length).map(b=>({text:b.textContent,overflow:b.scrollWidth-b.clientWidth,height:b.getBoundingClientRect().height,size:getComputedStyle(b).backgroundSize,border:getComputedStyle(b).borderImageSource}))};})()`);
      if(metrics.overflow>1){console.log(await win.webContents.executeJavaScript(`(()=>{const d=document.getElementById('dialog'),r=d.getBoundingClientRect();return [...d.querySelectorAll('*')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>r.right).map(e=>({tag:e.tagName,id:e.id,cls:e.className,w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,position:getComputedStyle(e).position}));})()`));fs.writeFileSync(path.join(out,'menu-overflow-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
      assert(metrics.overflow<=1,JSON.stringify(metrics));
      assert(metrics.images.every(im=>im.fit==='contain'),JSON.stringify(metrics.images));
      assert(metrics.buttons.every(b=>b.overflow<=1&&b.height>=44),JSON.stringify(metrics.buttons));
      assert(metrics.buttons.filter(b=>b.text!=='Trash').every(b=>b.size==='100% auto'&&b.border==='none'),JSON.stringify(metrics.buttons));
      await screenshot(win,path.join(out,'inventory-'+width+'.png'));
      if(mobile){
        await win.webContents.executeJavaScript('document.querySelector("[data-mobile-inventory=doll]").click()');
        assert.equal(await win.webContents.executeJavaScript('document.querySelector("[data-mobile-inventory=doll]").getAttribute("aria-pressed")'), 'true');
        await screenshot(win,path.join(out,'character-'+width+'.png'));
      }
      await win.webContents.executeJavaScript('document.querySelector("#dialog [data-item]").click()');
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("equip-selected").hidden && !document.getElementById("unequip-selected").hidden && document.getElementById("sell-selected").hidden'),true);
      await win.webContents.executeJavaScript('document.getElementById("unequip-selected").click()');
      assert.equal(await win.webContents.executeJavaScript('!document.getElementById("equip-selected").hidden && document.getElementById("unequip-selected").hidden && !document.getElementById("sell-selected").hidden'),true);
      await win.webContents.executeJavaScript('document.getElementById("shop-tab").click()');
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("shop-tab").getAttribute("aria-selected")'), 'true');
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("equipment-shop").classList.contains("hidden")'), false);
      await screenshot(win,path.join(out,'shop-'+width+'.png'));
      await win.webContents.executeJavaScript('document.getElementById("close-dialog").click();window.britannia.game.player.xp=window.britannia.game.player.nextXp;window.britannia.game.checkLevel()');
      await waitFor(win,'!!document.querySelector("[data-choice]")');
      await screenshot(win,path.join(out,'upgrades-'+width+'.png'));
      assert.equal(await win.webContents.executeJavaScript('document.getElementById("dialog").scrollWidth<=document.getElementById("dialog").clientWidth+1'),true);
      win.destroy();console.log('Menu layout and actions passed: '+width+'x'+height);
    }
    server.close();app.exit(0);
  }catch(error){console.error(error);win?.destroy();server.close();app.exit(1);}
});
