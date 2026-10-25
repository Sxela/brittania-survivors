import test from 'node:test';
import assert from 'node:assert/strict';
import {PointerNavigation,cursorWorldPoint,playerCamera} from '../game/navigation.mjs';
import {Game} from '../game/core.mjs';

test('cardinal and arbitrary-angle click destinations arrive without overshoot or diagonal snapping',()=>{
  for(const [x,y] of [[190,0],[-190,0],[0,190],[0,-190],[177,53],[-43,167]]){
    const nav=new PointerNavigation(),p={x:0,y:0,speed:173};nav.setDestination({x,y});
    for(let i=0;i<200 && nav.destination;i++){const dt=i%2?.017:.049,v=nav.steer(p,dt);p.x+=v.x*p.speed*dt;p.y+=v.y*p.speed*dt;}
    assert.ok(Math.hypot(p.x-x,p.y-y)<.5);assert.equal(nav.destination,null);
  }
});
test('cursor coordinates respect the canvas rectangle, camera and CSS scale',()=>{
  assert.deepEqual(cursorWorldPoint(650,280,{left:50,top:30,width:800,height:500},{x:100,y:200},{w:1600,h:1000}),{x:500,y:200});
});

test('elevated and underground players, nearby pickups and center clicks share one centered origin',()=>{
  const player={x:120,y:960},view={w:1600,h:1000},rect={left:50,top:30,width:800,height:500};
  for(const z of [-85,0,40,120]){
    const camera=playerCamera(player,view,z);
    assert.equal(player.x-camera.x,view.w/2);
    assert.equal(player.y-camera.y-z*4,view.h/2);
    assert.deepEqual(cursorWorldPoint(450,280,rect,player,view,()=>z),player);
    const drop={x:player.x+20,y:player.y+15};
    assert.equal(drop.y-camera.y-z*4,view.h/2+15);
    const click=cursorWorldPoint(460,287.5,rect,player,view,()=>z);
    assert.deepEqual(click,drop);
  }
});
test('navigation cancellation and malformed destinations preserve a valid movement state',()=>{
  const n=new PointerNavigation();n.setDestination({x:100,y:20});n.setDestination({x:NaN,y:2});assert.deepEqual(n.destination,{x:100,y:20});n.cancel();assert.deepEqual(n.steer({x:0,y:0,speed:180},.02),{x:0,y:0});
});

test('camera and clicks center on the playable area below the HUD cutoff at every zoom',()=>{
 const player={x:120,y:960},rect={left:10,top:20,width:390,height:844},cutoff=150;
 for(const zoom of [.5,1,1.25,2])for(const z of [-20,0,40]){
  const view={w:rect.width/zoom,h:rect.height/zoom,topInset:cutoff/zoom},camera=playerCamera(player,view,z);
  const center=(rect.height+cutoff)/2;
  assert.ok(Math.abs((player.y-camera.y-z*4)*zoom-center)<1e-8);
  assert.deepEqual(cursorWorldPoint(rect.left+rect.width/2,rect.top+center,rect,player,view,()=>z),player);
  const top=cursorWorldPoint(rect.left+rect.width/2,rect.top+cutoff,rect,player,view,()=>z);
  const bottom=cursorWorldPoint(rect.left+rect.width/2,rect.top+rect.height,rect,player,view,()=>z);
  assert.ok(Math.abs(player.y-top.y-(bottom.y-player.y))<1e-8);
 }
});
test('original sound cues are bounded transient events and do not replay from saves',()=>{
  const g=new Game({}, {seed:7});for(let i=0;i<300;i++)g.audioCue('magic-arrow');assert.equal(g.audioEvents.length,128);
  const state=g.snapshot();assert.equal(state.audioEvents,undefined);
  assert.equal(g.drainAudioEvents().length,128);assert.equal(g.audioEvents.length,0);
  assert.equal(Game.restore({},state).drainAudioEvents().length,0);
});
