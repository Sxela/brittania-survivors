import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
function game(){const g=new Game();g.enemies=[];g.spawnClock=999;g.player.x=g.player.y=0;g.lastDirection={x:1,y:0};return g;}
test('jump crosses a solid castle wall while ordinary walking remains blocked',()=>{
 const g=game();g.isPassable=x=>x<30||x>90;
 g.update(.2,{x:1,y:0});assert.ok(g.player.x<30);
 g.player.x=0;assert.equal(g.dash(),true);assert.ok(g.player.x>90);assert.ok(g.canStand(g.player.x,g.player.y,g.player.radius));
 const landed=g.player.x;g.update(.2);assert.equal(g.player.x,landed);assert.equal(g.dash(),false);
});
test('jump finds a shorter safe landing when its full endpoint is obstructed',()=>{
 const g=game();g.isPassable=x=>x<30||x>70&&x<130;
 assert.equal(g.dash(),true);assert.ok(g.player.x>70&&g.player.x<130);assert.ok(g.canStand(g.player.x,g.player.y,g.player.radius));
});
test('jump cannot land in water, void or walls and failed jumps spend no cooldown',()=>{
 const g=game();g.isPassable=x=>x<=14;assert.equal(g.dash(),false);assert.equal(g.player.x,0);assert.equal(g.player.dashCooldown,0);
});
test('diagonal jumps stay within range and land with full body clearance',()=>{
 const g=game();g.lastDirection={x:1,y:1};g.isPassable=(x,y)=>x<30||x>65;
 assert.equal(g.dash(),true);assert.ok(g.player.x>65);assert.ok(Math.hypot(g.player.x,g.player.y)<=147.60001);assert.equal(g.player.x,g.player.y);
});
test('saving a jump does not repeat its displacement after loading',()=>{
 const g=game();g.dash();const saved=g.snapshot(),restored=Game.restore({},saved);const x=restored.player.x;
 restored.update(.2);assert.equal(restored.player.x,x);assert.ok(restored.player.dashCooldown>0);
});
