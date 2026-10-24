export function clearSegment(a,b,passable) {
  const length=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(length/6));
  let previous=a;
  for(let i=1;i<=steps;i++){const point={x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps};if(!passable(point.x,point.y)||passable.canTraverse&&!passable.canTraverse(previous,point))return false;previous=point;}
  return true;
}
export function findPath(start,goal,passable,{step=16,limit=24000,margin=64}={}) {
  if(clearSegment(start,goal,passable))return [goal];
  const key=(x,y)=>x+','+y,target={x:Math.round((goal.x-start.x)/step),y:Math.round((goal.y-start.y)/step)};
  const point=n=>({x:start.x+n.x*step,y:start.y+n.y*step});
  const heuristic=n=>Math.hypot(n.x-target.x,n.y-target.y);
  const origin={x:0,y:0,g:0};origin.f=heuristic(origin);
  // A binary heap keeps long detours from turning each expansion into a
  // linear scan of every frontier node.
  const open=[];
  const push=node=>{let i=open.length;open.push(node);while(i){const parent=(i-1)>>1;if(open[parent].f<=node.f)break;open[i]=open[parent];i=parent;}open[i]=node;};
  const pop=()=>{const first=open[0],last=open.pop();if(open.length){let i=0;while(i*2+1<open.length){let child=i*2+1;if(child+1<open.length&&open[child+1].f<open[child].f)child++;if(last.f<=open[child].f)break;open[i]=open[child];i=child;}open[i]=last;}return first;};
  push(origin);
  const costs=new Map([[key(0,0),0]]),closed=new Set();
  const bound=Math.max(Math.abs(target.x),Math.abs(target.y))+margin;
  for(let visited=0;open.length&&visited<limit;visited++){
    const current=pop(),id=key(current.x,current.y);if(closed.has(id))continue;closed.add(id);
    const p=point(current);
    if(heuristic(current)<2&&clearSegment(p,goal,passable)){
      const route=[goal];let node=current;while(node.parent){route.push(point(node));node=node.parent;}route.reverse();
      const smooth=[];let from=start;
      for(let i=0;i<route.length;){let end=i;while(end+1<route.length&&clearSegment(from,route[end+1],passable))end++;smooth.push(route[end]);from=route[end];i=end+1;}
      return smooth;
    }
    for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const next={x:current.x+dx,y:current.y+dy,parent:current};if(Math.abs(next.x)>bound||Math.abs(next.y)>bound)continue;
      const nextId=key(next.x,next.y);if(closed.has(nextId))continue;
      next.g=current.g+Math.hypot(dx,dy);if((costs.get(nextId)??Infinity)<=next.g)continue;
      if(!clearSegment(p,point(next),passable))continue;
      costs.set(nextId,next.g);next.f=next.g+heuristic(next);push(next);
    }
  }
  return null;
}
