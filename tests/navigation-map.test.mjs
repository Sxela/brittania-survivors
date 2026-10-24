import test from 'node:test';
import assert from 'node:assert/strict';
import {findPath,clearSegment} from '../game/pathfinding.mjs';
import {PointerNavigation} from '../game/navigation.mjs';
import {pickupGuides,championGuides} from '../game/guidance.mjs';

test('map click routing goes around a wall without cutting blocked corners',()=>{
  const pass=(x,y)=>!(x>=40&&x<=80&&y>-70&&y<70),start={x:0,y:0},goal={x:150,y:20};
  assert.equal(clearSegment(start,goal,pass),false);
  const path=findPath(start,goal,pass);assert.ok(path?.length>1);
  let previous=start;for(const point of path){assert.ok(clearSegment(previous,point,pass));previous=point;}
  const nav=new PointerNavigation();nav.configure(pass);nav.setDestination(goal);
  const player={...start,speed:150};
  for(let i=0;i<500&&nav.destination;i++){const input=nav.steer(player,.02);player.x+=input.x*player.speed*.02;player.y+=input.y*player.speed*.02;assert.ok(pass(player.x,player.y));}
  assert.equal(nav.destination,null);assert.ok(Math.hypot(player.x-goal.x,player.y-goal.y)<1);
});
test('unreachable destinations stop without walking into a closed obstacle',()=>{
  const pass=(x,y)=>Math.hypot(x,y)<30,nav=new PointerNavigation();nav.configure(pass);nav.setDestination({x:100,y:0});
  assert.deepEqual(nav.steer({x:0,y:0,speed:150},.02),{x:0,y:0});assert.equal(nav.destination,null);
});
test('pickup guidance shows nearest offscreen drops and hides unnecessary healing',()=>{
  const g={player:{x:0,y:0,hp:100,maxHp:100},pickups:[{kind:'loot',x:800,y:0},{kind:'loot',x:600,y:0},{kind:'xp',x:0,y:0},{kind:'heal',x:-700,y:0},{kind:'haste',x:0,y:500}]};
  const guides=pickupGuides(g,800,600);assert.equal(guides.find(g=>g.kind==='loot').distance,600);assert.ok(guides.some(g=>g.kind==='powerup'));assert.ok(!guides.some(g=>g.kind==='heal'||g.kind==='xp'));
  for(const guide of guides){assert.ok(guide.x>=0&&guide.x<=800&&guide.y>=0&&guide.y<=600);}
  g.player.hp=20;assert.ok(pickupGuides(g,800,600).some(g=>g.kind==='heal'));
});

test('champions use arrow-only guides off screen, including distant leaders, without marking normal mobs',()=>{const g={player:{x:0,y:0},enemies:[{id:1,x:0,y:0,hp:10,boss:true},{id:2,x:9000,y:0,hp:10,captain:true},{id:3,x:-900,y:200,hp:10,packChampion:true},{id:4,x:0,y:-900,hp:0,boss:true},{id:5,x:0,y:900,hp:10}]};const guides=championGuides(g,1400,900);assert.deepEqual(guides.map(g=>g.enemyId),[2,3]);assert.ok(guides[0].angle===0);assert.ok(guides[1].angle>Math.PI/2);assert.ok(guides.every(g=>g.x>=30&&g.x<=1370&&g.y>=160&&g.y<=735));assert.ok(guides.every(g=>!('distance'in g)&&!('name'in g)&&g.kind==='champion'));});
