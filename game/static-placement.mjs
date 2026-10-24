// Native UO isometric coordinates: 44x44 land diamonds and four pixels per z.
export const Z_SCALE=4;
export const TILE_WIDTH=44;
export const TILE_HEIGHT=44;
export function isFloorSurface(item){
 return !!(item.flags&0x200)&&!(item.flags&0x40)&&(item.bounds?.[1]||0)<=50&&/floor|tile|slate|planks?|wooden boards|pavers?|flagstones?|wooden logs|wooden bridge/i.test(item.name||'');
}

export function staticPlacement(point,item){
 const [bw,bh,ox,oy]=item.bounds||[0,0,0,0];
 const x=point.x,y=point.y-(item.z||0)*Z_SCALE,flat=!bw||!bh;
 // The EC bounds are inclusive maxima; the last antialiased row/column is art.
 const width=flat?TILE_WIDTH:bw+1,height=flat?TILE_HEIGHT:bh+1;
 // Classic raw art is centered on the cell, including sprites wider than a
 // 44px diamond. A fixed -22 shifts trees, tables and wall sections sideways.
 if(item.classicArt)return {x,y,flat:false,width,height,left:x-Math.floor(width/2),
  top:y-height+TILE_HEIGHT,depth:point.y+TILE_HEIGHT/2+(item.z||0)*.01};
 return {x,y,flat,width,height,left:x+(flat?-TILE_WIDTH/2:ox-TILE_WIDTH/2),
  top:y+(flat?0:-height+oy+TILE_HEIGHT),depth:point.y+TILE_HEIGHT/2+(item.z||0)*.01};
}
