export function championGuides(game,width,height,zoom=1,radar=null,topInset=0) {
  const cx=width/2,cy=(height+topInset)/2,margin=30/zoom,top=Math.max(topInset+12/zoom,Math.min(160/zoom,height*.3)),bottom=Math.max(top+1,height-165/zoom);
  const guides=[];
  for(const enemy of game.enemies){
    if(enemy.hp<=0||!(enemy.boss||enemy.captain||enemy.packChampion))continue;
    const dx=enemy.x-game.player.x,dy=enemy.y-game.player.y,x=cx+dx,y=cy+dy;
    if((!dx&&!dy)||(x>=margin&&x<=width-margin&&y>=top&&y<=bottom))continue;
    const tx=dx>0?(width-margin-cx)/dx:dx<0?(margin-cx)/dx:Infinity;
    const ty=dy>0?(bottom-cy)/dy:dy<0?(top-cy)/dy:Infinity;
    const t=Math.max(0,Math.min(tx,ty));
    const guide={kind:'champion',x:cx+dx*t,y:cy+dy*t,angle:Math.atan2(dy,dx),enemyId:enemy.id};
    // Keep the arrow below the enlarged top-right radar if that HUD covers it.
    const radarSize=radar??(width>1000?300:width>800?135:112.5);
    if(guide.x>width-radarSize-24/zoom&&guide.y<radarSize+24/zoom)guide.y=Math.min(bottom,radarSize+24/zoom);
    guides.push(guide);
  }
  return guides;
}

export function pickupGuides(game,width,height,zoom=1,topInset=0) {
  const p=game.player,cx=width/2,cy=(height+topInset)/2,margin=30/zoom,top=Math.max(topInset+12/zoom,Math.min(160/zoom,height*.3)),bottom=Math.max(top+1,height-165/zoom);
  const nearest=new Map();
  for(const drop of game.pickups){
    if(drop.kind==='heal'&&p.hp>=p.maxHp)continue;
    const dx=drop.x-p.x,dy=drop.y-p.y,distance=Math.hypot(dx,dy),x=cx+dx,y=cy+dy;
    if(distance>1600||x>=margin&&x<=width-margin&&y>=top&&y<=bottom)continue;
    const kind=drop.kind==='loot'?'loot':['xp','gold','heal','ore'].includes(drop.kind)?drop.kind:'powerup';
    if(nearest.get(kind)?.distance<=distance)continue;
    const tx=dx>0?(width-margin-cx)/dx:dx<0?(margin-cx)/dx:Infinity;
    const ty=dy>0?(bottom-cy)/dy:dy<0?(top-cy)/dy:Infinity;
    const t=Math.max(0,Math.min(tx,ty));
    nearest.set(kind,{kind,x:cx+dx*t,y:cy+dy*t,angle:Math.atan2(dy,dx),distance:Math.round(distance),drop});
  }
  const spaced=[];
  for(const guide of nearest.values()){
    for(const other of spaced)if(Math.hypot(other.x-guide.x,other.y-guide.y)<48/zoom){guide.y=Math.max(top,Math.min(bottom,guide.y+40/zoom));guide.x=Math.max(margin,Math.min(width-margin,guide.x-24/zoom));}
    spaced.push(guide);
  }
  return spaced;
}

// Reuse the native edge arrows once only the final few targets remain.
export function lastEnemyGuides(game,width,height,zoom=1,radar=null,topInset=0){
  const zone=game.zoneRun;
  if(!zone||zone.phase!=='combat'||zone.version>=4&&!zone.bossSpawned)return [];
  const alive=game.enemies.filter(e=>e.hp>0&&e.zoneIndex===zone.index);
  if(!alive.length||alive.length+Math.max(0,zone.quota-zone.spawned)>5)return [];
  return championGuides({...game,enemies:alive.map(e=>({...e,boss:true}))},width,height,zoom,radar,topInset).map(g=>({...g,kind:'enemy'}));
}
