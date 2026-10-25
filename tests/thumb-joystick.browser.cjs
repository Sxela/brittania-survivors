// Emulated touch integration, resize, persistence and screenshots; no game assets required.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../.cache/thumb-joystick');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
app.commandLine.appendSwitch('disable-gpu');
const fixture=path.join(out,'fixture.html');
fs.writeFileSync(fixture,`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../../game/style.css">
<body><div id="hud" style="position:absolute;inset:10px;display:block"><div id="joystick"><i></i></div></div>
<div id="settings" style="display:none"></div><script type="module">
import {attachThumbJoystick,thumbJoystickAvailable} from '${require('node:url').pathToFileURL(path.resolve(__dirname,'../game/mobile.mjs')).href}';
window.vector={x:0,y:0};window.playing=true;window.starts=0;
window.control=attachThumbJoystick(document.getElementById('joystick'),{available:()=>thumbJoystickAvailable({width:innerWidth,height:innerHeight,touch:window.touchHardware===true}),active:()=>window.playing,onStart:()=>window.starts++,onMove:v=>window.vector=v});
control.options(document.getElementById('settings'));window.ready=true;
</script>`);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:390,height:844,useContentSize:true,show:false,webPreferences:{contextIsolation:true}});
 const js=code=>win.webContents.executeJavaScript(code);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const reload=()=>new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
 try{
  await win.loadFile(fixture);while(!await js('!!window.ready'))await wait(20);
  await js("localStorage.removeItem('britannia-thumb-joystick-v1')");await reload();while(!await js('!!window.ready'))await wait(20);
  assert.equal(await js("getComputedStyle(document.getElementById('joystick')).display"),'none');
  await js("document.getElementById('option-joystick').click()");
  win.webContents.debugger.attach('1.3');
  const touch=(type,points)=>win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type,touchPoints:points});
  const rect=await js("(()=>{const r=document.getElementById('joystick').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width}})()");
  assert.equal(rect.width,120,'joystick is visible in plain portrait desktop without touch classes');
  win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(rect.x),y:Math.round(rect.y),button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.x+35),y:Math.round(rect.y),button:'left'});await wait(50);
  assert((await js('vector.x'))>.8,'mouse can operate the desktop joystick');
  win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(rect.x+35),y:Math.round(rect.y),button:'left',clickCount:1});await wait(30);
  assert.deepEqual(await js('vector'),{x:0,y:0});
  await touch('touchStart',[{id:1,x:rect.x,y:rect.y}]);
  await touch('touchMove',[{id:1,x:rect.x+35,y:rect.y}]);await wait(50);
  assert((await js('vector.x'))>.8);
  // CDP touchEnd ends the emulated gesture. Inject an unrelated pointer release
  // separately to verify ownership while the real emulated thumb stays down.
  await js("document.getElementById('joystick').dispatchEvent(new PointerEvent('pointerup',{pointerId:9999,pointerType:'touch'}))");
  assert((await js('vector.x'))>.8,'second finger must not stop the owning thumb');
  await touch('touchEnd',[]);await wait(30);assert.deepEqual(await js('vector'),{x:0,y:0});
  await touch('touchStart',[{id:1,x:rect.x,y:rect.y}]);await touch('touchMove',[{id:1,x:rect.x+30,y:rect.y}]);
  await touch('touchCancel',[]);await wait(30);assert.deepEqual(await js('vector'),{x:0,y:0});
  await js("for(const [name,value]of [['scale',200],['x',100],['y',100]]){const e=document.getElementById('option-joystick-'+name);e.value=value;e.dispatchEvent(new Event('input'));}");
  await js('window.touchHardware=true');
  for(const [width,height]of [[390,844],[844,390],[320,568]]){
   win.setContentSize(width,height);await wait(50);await js('control.refresh()');
   const box=await js("(()=>{const r=document.getElementById('joystick').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()");
   assert(box.left>=0&&box.top>=0&&box.right<=width&&box.bottom<=height,JSON.stringify(box));assert.equal(box.width,240);assert.equal(box.height,240);
   fs.writeFileSync(path.join(out,`joystick-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await reload();while(!await js('!!window.ready'))await wait(20);
  assert.deepEqual(await js('control.preferences'),{enabled:true,scale:2,x:100,y:100});
  await js("document.getElementById('settings').style.display='block';document.getElementById('hud').style.display='none'");
  await wait(100);
  assert(await js("document.getElementById('settings').scrollWidth<=innerWidth"));
  fs.writeFileSync(path.join(out,'settings-320.png'),(await win.webContents.capturePage()).toPNG());
  console.log('PASS: emulated touch ownership, release/cancel, size/position, rotation, persistence, narrow settings');win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});
