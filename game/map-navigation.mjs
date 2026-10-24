import { findPath,clearSegment } from './pathfinding.mjs';

// Route only enemies whose direct movement was blocked. Cache paths outside
// simulation state and limit searches to keep large hordes responsive.
export function attachEnemyNavigation(game,map) {
  game.canTraverse=map.canTraverse||null;
  const paths=new WeakMap(),direct=new WeakMap(),passes=new WeakMap(),progress=new WeakMap();let searches=0,lastFrame=-1;
  const passFor=enemy=>{
    if(passes.has(enemy))return passes.get(enemy);
    const radius=enemy.radius*.5,offsets=[[0,0],[-radius,0],[radius,0],[0,-radius],[0,radius]];
    // Validate the entire footprint along a segment. Six-pixel path probes can
    // otherwise skip a thin blocked corner which 60 Hz movement cannot cross.
    const footprint=map.canOccupySegment||game.canTraverse;
    const pass=Object.assign((x,y)=>game.canStand(x,y,radius),{canTraverse:game.canTraverse?(a,b)=>game.canTraverse(a,b)&&offsets.every(([x,y])=>footprint({x:a.x+x,y:a.y+y},{x:b.x+x,y:b.y+y})):null});
    passes.set(enemy,pass);return pass;
  };
  const route=(enemy,player)=>{
    const frame=Math.floor(game.time*20);if(frame!==lastFrame){lastFrame=frame;searches=0;}
    if(searches>=2)return null;searches++;
    const pass=passFor(enemy);
    let goal={x:player.x,y:player.y};
    if(!pass(goal.x,goal.y)){
      const candidates=[];
      for(const radius of [enemy.radius+player.radius,enemy.radius+player.radius+16])for(let n=0;n<16;n++){
        const a=n*Math.PI/8,p={x:player.x+Math.cos(a)*radius,y:player.y+Math.sin(a)*radius};if(pass(p.x,p.y))candidates.push(p);
      }
      candidates.sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y));
      if(candidates.length)goal=candidates[0];
    }
    let path=findPath(enemy,goal,pass,{step:12,limit:6000});
    if(!path&&searches<2){searches++;path=findPath(enemy,goal,pass,{step:8,limit:24000});}
    const cached={path:path||[],goal:{x:player.x,y:player.y},expires:game.time+(path?12:1),position:{x:enemy.x,y:enemy.y},progressAt:game.time};
    paths.set(enemy,cached);return cached;
  };
  game.enemyWaypoint=(enemy,player)=>{
    const pass=passFor(enemy);
    let tracking=progress.get(enemy);
    if(!tracking||game.time-tracking.checkAt>.5||Math.hypot(tracking.x-enemy.x,tracking.y-enemy.y)>8||Math.hypot(tracking.px-player.x,tracking.py-player.y)>64){tracking={x:enemy.x,y:enemy.y,px:player.x,py:player.y,at:game.time,checkAt:game.time};progress.set(enemy,tracking);}
    tracking.checkAt=game.time;
    // Finite native areas can contain tiny clearance islands for a large body.
    // Recover a genuinely stuck pursuer at a legal visible spawn with a clear
    // walking route; never heal it or move it directly onto the player.
    if(map.randomSpawn&&game.time-tracking.at>6&&Math.hypot(enemy.x-player.x,enemy.y-player.y)>enemy.radius+player.radius+8){
      tracking.at=game.time;
      for(let n=0;n<8;n++){
        const point=map.randomSpawn(()=>game.random(),player,enemy.radius,!!enemy.boss,game.viewport);
        if(!point||!clearSegment(point,player,pass))continue;
        game.effect?.(enemy.x,enemy.y,24,'#d2b9ff','teleport',.5);Object.assign(enemy,point);game.effect?.(enemy.x,enemy.y,24,'#d2b9ff','teleport',.5);
        paths.delete(enemy);direct.delete(enemy);progress.delete(enemy);return null;
      }
    }
    let line=direct.get(enemy);
    if(!line||line.until<game.time||Math.hypot(line.x-enemy.x,line.y-enemy.y)>32||Math.hypot(line.px-player.x,line.py-player.y)>32){
      line={clear:clearSegment(enemy,player,pass),until:game.time+.12+(enemy.id%7)*.02,x:enemy.x,y:enemy.y,px:player.x,py:player.y};direct.set(enemy,line);
    }
    if(line.clear){paths.delete(enemy);return null;}
    let cached=paths.get(enemy);
    if(cached){
      if(Math.hypot(cached.position.x-enemy.x,cached.position.y-enemy.y)>4){cached.position={x:enemy.x,y:enemy.y};cached.progressAt=game.time;}
      if(cached.expires<game.time||Math.hypot(cached.goal.x-player.x,cached.goal.y-player.y)>48||cached.path.length&&game.time-cached.progressAt>.45){paths.delete(enemy);cached=null;}
    }
    if(!cached)cached=route(enemy,player);
    if(!cached)return null;
    while(cached.path.length&&Math.hypot(cached.path[0].x-enemy.x,cached.path[0].y-enemy.y)<.05){cached.path.shift();cached.checkAt=0;}
    if(!cached.path.length)return null;
    if(!cached.checkAt||cached.checkAt<game.time){cached.checkAt=game.time+.15;if(!clearSegment(enemy,cached.path[0],pass)){paths.delete(enemy);return null;}}
    return cached.path[0];
  };
  game.blockedActor=enemy=>{
    if(enemy===game.player)return;
    const cached=paths.get(enemy);
    if(cached){if(game.time-cached.progressAt>.3)paths.delete(enemy);return;}
    route(enemy,game.player);
  };
  game.clearSight=(a,b)=>clearSegment(a,b,(x,y)=>(map.isSightPassable||map.isPassable)(x,y,game.time));
}

// Incoming official sectors can put a wall or water under an actor or drop.
// Find the closest cell in that sector's connected playable area with enough
// clearance, keeping item identities and encounter stats intact.
export function settleBiome(game,map,{cancelCasts=true}={}){
 const entities=[game.player,...game.enemies.filter(e=>e.hp>0),...(game.pickups||[]),...(game.spellFields||[]).filter(f=>f.summon)];
 let moved=0;
 for(const entity of entities){
  const radius=(entity.radius||0)*.5;
  const safe=(x,y)=>game.canStand(x,y,radius);
  if(safe(entity.x,entity.y))continue;
  const point=map.nearestPlayable(entity.x,entity.y,game.time,safe);
  if(point&&safe(point.x,point.y)){Object.assign(entity,point);moved++;}
 }
 if(cancelCasts){game.pendingEnemyCasts=[];game.effects=game.effects.filter(e=>!['enemy-cast','cast-warning'].includes(e.kind));}
 attachEnemyNavigation(game,map);
 return moved;
}
