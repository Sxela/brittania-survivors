// Walk height follows the same shared corner triangles as the baked native land.
// Structural supports retain their own floor; never blend a roof into the ground.
export function locationHeights(region){
 const {width:w,height:h,tiles}=region,n=w*h,terrain=new Uint8Array(n),bridgeCells=new Uint8Array(n),entry=new Float64Array(n),top=new Float64Array(n);
 const corners=i=>{const x=Math.floor(i/h),y=i%h;return [tiles[i][1],tiles[Math.min(x+1,w-1)*h+y][1],tiles[x*h+Math.min(y+1,h-1)][1],tiles[Math.min(x+1,w-1)*h+Math.min(y+1,h-1)][1]];};
 const floors=new Map(),landBlocked=new Uint8Array(n),averages=new Float64Array(n);
 for(let i=0;i<n;i++){const [a,b,c,d]=corners(i);averages[i]=Math.floor(Math.abs(a-d)>Math.abs(c-b)?(b+c)/2:(a+d)/2);}
 for(const s of region.statics||[]){if(s.x<0||s.y<0||s.x>=w||s.y>=h||s.flags&0x20000000)continue;const i=s.x*h+s.y,height=s.height||0,calc=s.flags&0x400?Math.floor(height/2):height;if(s.flags&0x240&&s.z+calc>averages[i]&&averages[i]+16>s.z)landBlocked[i]=1;}
 for(const s of region.statics||[]){if(s.x<0||s.y<0||s.x>=w||s.y>=h||!(s.flags&0x400)||s.flags&(0x40|0x10000000|0x20000000))continue;const i=s.x*h+s.y,z=s.z+Math.floor((s.height||0)/2);if(z===region.walkZ?.[i]){const old=floors.get(i);if(!old||s.z<old.z)floors.set(i,s);}}
 for(let i=0;i<n;i++){
  const [a,b,c,d]=corners(i),average=Math.floor(Math.abs(a-d)>Math.abs(c-b)?(b+c)/2:(a+d)/2),z=region.walkZ?.[i]??tiles[i][1],id=tiles[i][0];
  const ignored=id===2||id===0x1db||id>=0x1ae&&id<=0x1b5;
  terrain[i]=!!region.walkZ&&!ignored&&!landBlocked[i]&&!floors.has(i)&&z===average;
  if(terrain[i]){entry[i]=Math.min(a,b,c,d);top[i]=Math.max(a,b,c,d);}
  else{const bridge=floors.get(i);bridgeCells[i]=!!bridge;entry[i]=bridge?bridge.z:z;top[i]=bridge?bridge.z+(bridge.height||0):z;}
 }
 function cellHeight(i,a,b){
  if(!terrain[i])return region.walkZ?.[i]??tiles[i][1];
  const ix=Math.floor(i/h),iy=i%h,[z0,z1,z2,z3]=corners(i),u=Math.max(0,Math.min(1,a-ix)),v=Math.max(0,Math.min(1,b-iy));
  return u+v<=1?z0+(z1-z0)*u+(z2-z0)*v:z3+(z2-z3)*(1-u)+(z1-z3)*(1-v);
 }
 function elevationAt(x,y){
  const a=Math.max(0,Math.min(w-1e-8,(x+y)/44)),b=Math.max(0,Math.min(h-1e-8,(y-x)/44));
  return cellHeight(Math.floor(a)*h+Math.floor(b),a,b);
 }
 return {elevationAt,cellHeight,entry,top,terrain,bridgeCells};
}

// Crossing an edge must obey native step/bridge clearance. Being reachable by
// stairs somewhere else does not make the side of an upper floor an entrance.
export function locationTraversal(region,heights,passable,{ignoreHeight=false}={}){
 const w=region.width,h=region.height;
 const valid=(a,b)=>a>=0&&b>=0&&a<w&&b<h&&passable(a*h+b);
 const edge=(a,b,c,d,px,py)=>{
  if(!valid(c,d))return false;const i=a*h+b,j=c*h+d;
  if(ignoreHeight)return true;
  return heights.entry[j]<=heights.top[i]+2&&heights.entry[i]<=heights.top[j]+2&&
   (heights.bridgeCells[i]||heights.bridgeCells[j]||Math.abs(heights.cellHeight(i,px,py)-heights.cellHeight(j,px,py))<=2.000001);
 };
 return (from,to)=>{
  const ax=(from.x+from.y)/44,ay=(from.y-from.x)/44,bx=(to.x+to.y)/44,by=(to.y-to.x)/44;
  let x=Math.floor(ax),y=Math.floor(ay);const ex=Math.floor(bx),ey=Math.floor(by);
  if(!valid(x,y)||!valid(ex,ey))return false;
  const dx=bx-ax,dy=by-ay,sx=Math.sign(dx),sy=Math.sign(dy),tx=dx?Math.abs(1/dx):Infinity,ty=dy?Math.abs(1/dy):Infinity;
  let nx=dx?(sx>0?x+1-ax:ax-x)*tx:Infinity,ny=dy?(sy>0?y+1-ay:ay-y)*ty:Infinity;
  while(x!==ex||y!==ey){
   const t=Math.min(nx,ny),px=ax+dx*t,py=ay+dy*t;
   if(x!==ex&&y!==ey&&Math.abs(nx-ny)<1e-9){if(!edge(x,y,x+sx,y,px,py)||!edge(x,y,x,y+sy,px,py)||!edge(x+sx,y,x+sx,y+sy,px,py)||!edge(x,y+sy,x+sx,y+sy,px,py))return false;x+=sx;y+=sy;nx+=tx;ny+=ty;}
   else if(y===ey||x!==ex&&nx<ny){if(!edge(x,y,x+sx,y,px,py))return false;x+=sx;nx+=tx;}
   else{if(!edge(x,y,x,y+sy,px,py))return false;y+=sy;ny+=ty;}
  }
  return true;
 };
}

// Only spawn on the connected walking surface after validating floor entrances.
export function connectedLocationCells(region,cells,traverse){
 if(!cells.length)return [];
 const h=region.height,allowed=new Set(cells),spawn=region.spawn||{},sx=spawn.tileX??(spawn.x+spawn.y)/44-.5,sy=spawn.tileY??(spawn.y-spawn.x)/44-.5;
 let start=cells[0],best=Infinity;
 for(const i of cells){const distance=(Math.floor(i/h)-sx)**2+(i%h-sy)**2;if(distance<best){best=distance;start=i;}}
 const visited=new Set([start]),queue=[start],point=(x,y)=>({x:(x-y)*22,y:(x+y+1)*22});
 for(let n=0;n<queue.length;n++){const i=queue[n],x=Math.floor(i/h),y=i%h,a=point(x,y);
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=nx*h+ny;if(nx<0||ny<0||nx>=region.width||ny>=h||!allowed.has(j)||visited.has(j))continue;if(traverse(a,point(nx,ny))){visited.add(j);queue.push(j);}}
 }
 return cells.filter(i=>visited.has(i));
}
