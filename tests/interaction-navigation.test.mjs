import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game/core.mjs';
import {attachEnemyNavigation} from '../game/map-navigation.mjs';
import {itemOverlayPosition} from '../game/item-overlay.mjs';
const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
test('item overlays avoid the hovered icon, selection buttons and trash at desktop and narrow widths',()=>{
 for(const width of [1440,1024,640,375]){
  const anchor={left:width-120,right:width-72,top:230,bottom:278};
  const controls={left:Math.max(0,width-350),right:width-10,top:430,bottom:500};
  const pos=itemOverlayPosition(anchor,{width,height:720},{width:640,height:450},[controls]);
  const rect={left:pos.left,right:pos.left+pos.width,top:pos.top,bottom:pos.top+Math.min(450,pos.maxHeight)};
  assert.ok(!overlaps(rect,anchor));assert.ok(!overlaps(rect,controls));
  assert.ok(rect.left>=0&&rect.right<=width&&rect.top>=0&&rect.bottom<=720);
 }
});
test('discard supports dragged equipped and backpack items without selling them',()=>{
 const game=new Game({weapons:[{id:'staff',name:'Staff',damage:5}]});const item=game.inventory.find(i=>Object.values(game.equipment).includes(i.uid));assert.ok(item);
 const gold=game.player.gold;assert.equal(game.discard(game.inventory.indexOf(item)),true);
 assert.ok(!game.inventory.includes(item));assert.ok(!Object.values(game.equipment).includes(item.uid));assert.equal(game.player.gold,gold);
 assert.equal(game.discard(-1),false);
});
function chase({start,goal,wall,radius=14}){
 const game=new Game({monsters:[{id:'path-rat',body:238,adaptation:{hp:1000,damage:1,radius,speed:90}}]},{seed:7});
 game.enemies=[];Object.assign(game.player,goal);game.player.hp=game.player.maxHp=10000;game.spawnClock=game.attackClock=999;game.spellLoadout=[];
 const pass=(x,y)=>!wall(x,y);game.isPassable=pass;attachEnemyNavigation(game,{isPassable:pass});
 const enemy=game.spawnEnemy('path-rat');Object.assign(enemy,start,{speed:90,radius});
 let steps=0;
 while(steps++<1200&&(Math.hypot(enemy.x-goal.x,enemy.y-goal.y)>enemy.radius+game.player.radius||!game.clearSight(enemy,game.player))){game.update(.02);assert.ok(game.canStand(enemy.x,enemy.y,enemy.radius*.5));}
 return {game,enemy,steps};
}
test('monsters take a long detour around a building using their full movement clearance',()=>{
 const {enemy,steps}=chase({start:{x:0,y:0},goal:{x:200,y:0},wall:(x,y)=>x>=50&&x<=140&&y>=-300&&y<=300,radius:22});
 assert.ok(steps<1200,'enemy failed to route around the building');assert.ok(Math.hypot(enemy.x-200,enemy.y)<40);
});
test('close enemies separated by a thin wall continue routing instead of stopping at melee distance',()=>{
 const {steps}=chase({start:{x:50,y:0},goal:{x:70,y:0},wall:(x,y)=>x>=58&&x<=62&&y>=-45&&y<=45});
 assert.ok(steps>1&&steps<1200);
});
