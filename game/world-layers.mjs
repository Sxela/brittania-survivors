// Keep the native floor where persistent objects were created.
export function entityElevation(entity,map,time=0){
 return Number.isFinite(entity?.z)?entity.z:map.elevationAt(entity.x,entity.y,time);
}
export function actorDepth(entity,map,time=0){return entity.y+entityElevation(entity,map,time)*.01;}
export function staticDepth(point,item,floor=false){
 // A floor starts behind its occupant, not at the front half of its diamond.
 return point.y+(floor?0:22)+(item.z||0)*.01-(floor ? .01 : 0);
}
export function transparencyCircle(hero,elevation){return {x:hero.x,y:hero.y-elevation*4-30,radius:100};}
export const isTreeScenery=item=>/tree|leaves|foliage/i.test(item.name||'')||!!(item.flags&0x20000);
export function obstructsCharacter(item,bounds,hero,heroZ,drawDepth=bounds.depth){
 if(!hero||isTreeScenery(item))return false;
 if((item.z||0)+(item.height||0)<=heroZ+5)return false;
 return overlaysCharacter(bounds,hero,heroZ,drawDepth);
}
export function overlaysCharacter(bounds,hero,heroZ,drawDepth=bounds.depth){
 if(!hero)return false;
 const heroDepth=hero.y+(Number.isFinite(hero.z)?hero.z:heroZ)*.01;
 if(!Number.isFinite(drawDepth)||drawDepth<=heroDepth)return false;
 const feet=hero.y-heroZ*4,halfWidth=Math.max(20,(hero.radius||15)*1.3);
 if(bounds.left>=hero.x+halfWidth||bounds.left+bounds.width<=hero.x-halfWidth||bounds.top>=feet+5||bounds.top+bounds.height<=feet-75)return false;
 const circle=transparencyCircle(hero,heroZ);
 const x=Math.max(bounds.left,Math.min(circle.x,bounds.left+bounds.width));
 const y=Math.max(bounds.top,Math.min(circle.y,bounds.top+bounds.height));
 return (circle.x-x)**2+(circle.y-y)**2<circle.radius**2;
}
