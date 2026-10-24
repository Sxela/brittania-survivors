import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {locationHeights,locationTraversal,connectedLocationCells} from '../game/location-height.mjs';
import {mapPoint} from '../game/map-regions.mjs';
import {clearSegment,findPath} from '../game/pathfinding.mjs';
import {Game} from '../game/core.mjs';
const point=mapPoint;
function region(w=4,h=4){return {width:w,height:h,tiles:Array.from({length:w*h},()=>[1,0]),walkZ:Array(w*h).fill(0),statics:[]};}
function at(heights,a,b){const p=point(a,b);return heights.elevationAt(p.x,p.y);}

test('terrain follows baked native triangles continuously, including the diagonal and cell boundaries',()=>{
 const r=region();for(let x=0;x<4;x++)for(let y=0;y<4;y++){r.tiles[x*4+y][1]=x*4+y*2;r.walkZ[x*4+y]=x*4+y*2+(x<3?2:0)+(y<3?1:0);}
 const heights=locationHeights(r);
 for(const [a,b] of [[.1,.2],[.8,.9],[1,1],[1.000001,1.2],[.999999,1.2],[2.7,2.8]])assert.ok(Math.abs(at(heights,a,b)-(4*a+2*b))<1e-8);
 const saddle=region(2,2);saddle.tiles=[[1,0],[1,2],[1,6],[1,0]];saddle.walkZ=[0,1,3,0];
 assert.equal(at(locationHeights(saddle),.5,.5),4,'render uses the shared left/right triangle edge, not rounded collision average');
});

test('flat terrain stays flat below upper stories and raised floors retain their height',()=>{
 const r=region();r.statics=[{x:1,y:1,z:20,height:0,flags:0x200,name:'wooden floor'}];let heights=locationHeights(r);
 for(let a=.01;a<3;a+=.1)assert.equal(at(heights,a,1.5),0);
 r.walkZ[5]=20;heights=locationHeights(r);assert.equal(at(heights,1.01,1.5),20);assert.equal(at(heights,.99,1.5),0);
 const traverse=locationTraversal(r,heights,()=>true);assert.equal(traverse(point(.5,1.5),point(1.5,1.5)),false);
});

test('native bridge steps work while unrelated ground-to-floor edges are blocked in both directions',()=>{
 const r=region(3,3);r.tiles=r.tiles.map(()=>[2,-32]);r.walkZ.fill(-32);r.walkZ[1]=-30;r.walkZ[4]=-27;
 r.statics=[{x:0,y:1,z:-32,height:5,flags:0x600}];const heights=locationHeights(r),traverse=locationTraversal(r,heights,()=>true);
 assert.equal(traverse(point(.5,1.5),point(1.5,1.5)),true);
 assert.equal(traverse(point(1.5,1.5),point(.5,1.5)),true);
 assert.equal(traverse(point(1.5,.5),point(1.5,1.5)),false);
});

test('bridge at the land average retains its native departure height',()=>{
 const r=region();r.tiles=r.tiles.map(()=>[1,-59]);r.walkZ.fill(-59);r.walkZ[5]=-53;r.statics=[{x:2,y:1,z:-61,height:5,flags:0x600},{x:1,y:1,z:-55,height:5,flags:0x600}];const heights=locationHeights(r);
 assert.equal(heights.terrain[9],0);assert.equal(heights.top[9],-56);assert.equal(locationTraversal(r,heights,()=>true)(point(2.5,1.5),point(1.5,1.5)),true);
});

test('grid traversal handles exact corners, tiny offsets and long segments without skipping obstacles',()=>{
 const r=region(),heights=locationHeights(r),traverse=locationTraversal(r,heights,i=>i!==5);
 assert.equal(traverse(point(.5,.5),point(2.5,2.5)),false);
 assert.equal(traverse(point(.5,2.5),point(1,2.99999999999)),true);
 assert.equal(traverse(point(.5,2.5),point(1,3.00000000001)),true);
 assert.equal(traverse(point(0,0),point(.1,.1)),true);
 assert.equal(traverse(point(.5,.5),point(-1,0)),false);
});

test('movement and path smoothing route around a raised floor rather than hopping onto its side',()=>{
 const r=region(7,7);r.walkZ[3*7+3]=30;const heights=locationHeights(r),traverse=locationTraversal(r,heights,()=>true);
 const pass=Object.assign((x,y)=>{const a=(x+y)/44,b=(y-x)/44;return a>=0&&b>=0&&a<7&&b<7;},{canTraverse:traverse});
 const start=point(2.5,3.5),goal=point(4.5,3.5);assert.equal(clearSegment(start,goal,pass),false);const route=findPath(start,goal,pass,{step:8});assert.ok(route?.length);let from=start;for(const next of route){assert.equal(clearSegment(from,next,pass),true);from=next;}
 const g=new Game();g.canTraverse=traverse;g.player.radius=0;Object.assign(g.player,point(2.99,3.5));const before={...g.player};g.moveActor(g.player,...Object.values(point(.02,0)));assert.ok(traverse(before,g.player));assert.notEqual(Math.floor((g.player.x+g.player.y)/44),3);
});

test('all 73 native zones have continuous terrain seams; unsupported floor edges reject movement symmetrically',()=>{
 const source=JSON.parse(readFileSync(new URL('../game/assets/locations/manifest.json',import.meta.url),'utf8'));assert.equal(source.regions.length,73);let checked=0,rejected=0;
 for(const r of source.regions){const heights=locationHeights(r),main=new Set(r.mainPassable),traverse=locationTraversal(r,heights,i=>main.has(i)),h=r.height;
  const connected=connectedLocationCells(r,r.mainPassable,traverse);assert.ok(connected.length>=main.size-5,r.name+' unexpected lost ground');const kept=new Set(connected);assert.deepEqual(connectedLocationCells(r,connected,locationTraversal(r,heights,i=>kept.has(i))),connected,r.name+' spawn component');
  for(const i of main){const x=Math.floor(i/h),y=i%h;for(const [dx,dy] of [[1,0],[0,1]]){const j=(x+dx)*h+y+dy;if(x+dx>=r.width||y+dy>=h||!main.has(j))continue;
   const a=point(x+.5,y+.5),b=point(x+dx+.5,y+dy+.5),allowed=traverse(a,b);assert.equal(allowed,traverse(b,a),r.name+' step reversal');if(!allowed)rejected++;
   if(heights.terrain[i]&&heights.terrain[j]){const p=point(x+.5+dx*(.5-1e-7),y+.5+dy*(.5-1e-7)),q=point(x+.5+dx*(.5+1e-7),y+.5+dy*(.5+1e-7));assert.ok(Math.abs(heights.elevationAt(p.x,p.y)-heights.elevationAt(q.x,q.y))<.0001,r.name+' terrain seam');checked++;}
  }}
 }
 assert.ok(checked>100000);assert.ok(rejected>100);
});
