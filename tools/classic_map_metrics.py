"""Pure geometry metrics; no client or server installation dependency."""
from collections import Counter,deque
import re
def largest_component(blocked):
 remaining=set(range(4096))-blocked;largest=set()
 while remaining:
  start=remaining.pop();group={start};queue=deque([start])
  while queue:
   index=queue.popleft();x,y=divmod(index,64)
   for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
    other=nx*64+ny
    if 0<=nx<64 and 0<=ny<64 and other in remaining:remaining.remove(other);group.add(other);queue.append(other)
  if len(group)>len(largest):largest=group
 return largest

def structure_metrics(statics,definition):
 """Measure complete native wall/roof footprints, not sprite pixel bounds.

 Eight-neighbor components join roof slopes and their supporting corners.
 Border-touching structures are excluded rather than cut apart or moved.
 """
 walls=set();structure=set()
 for item in statics:
  flags=definition(item['itemId'])['flags'];point=(item['x'],item['y'])
  if flags&0x10:walls.add(point)
  if flags&0x10000010:structure.add(point)
 remaining=set(structure);footprints=[]
 while remaining:
  start=remaining.pop();group={start};queue=deque([start])
  while queue:
   x,y=queue.popleft()
   for dx in (-1,0,1):
    for dy in (-1,0,1):
     point=(x+dx,y+dy)
     if point in remaining:remaining.remove(point);group.add(point);queue.append(point)
  xs,ys=zip(*group);footprints.append({'width':max(xs)-min(xs)+1,'height':max(ys)-min(ys)+1,'tiles':len(group)})
 longest=0
 for x,y in walls:
  for dx,dy in ((1,0),(0,1)):
   if (x-dx,y-dy) in walls:continue
   run=1
   while (x+dx*run,y+dy*run) in walls:run+=1
   longest=max(longest,run)
 return {'components':len(footprints),'wallTiles':len(walls),'structureTiles':len(structure),
  'maxFootprintWidth':max((f['width'] for f in footprints),default=0),
  'maxFootprintHeight':max((f['height'] for f in footprints),default=0),
  'longestWallRun':longest,'boundaryStructureTiles':sum(x in (0,63) or y in (0,63) for x,y in structure)}

def small_structures(metrics):
 return metrics['maxFootprintWidth']<=12 and metrics['maxFootprintHeight']<=12 and metrics['longestWallRun']<=8 and metrics['boundaryStructureTiles']==0

def vegetation_metrics(statics,definition):
 """Conservative canopy estimate from original foliage flags and native art bounds.

 Sum rectangle area rather than subtracting overlaps, so stacked tree pieces
 never make a dense grove appear sparse. Small grass/flowers do not count.
 """
 count=0;area=0
 for item in statics:
  data=definition(item['itemId']);w,h,*_=data.get('bounds',[0,0,0,0]);name=data.get('name','').lower()
  vegetation=bool(data['flags']&0x20000) or bool(re.search(r'tree|leaves|foliage|sapling|palm|trunk|branch|vine|bush',name))
  if vegetation and h>=70:
   count+=1;area+=(w+1)*(h+1)
 return {'tallVegetationCount':count,'estimatedCanopyRatio':area/(4096*44*44/2)}

def sparse_vegetation(metrics):
 return metrics['tallVegetationCount']<=24 and metrics['estimatedCanopyRatio']<=.12
