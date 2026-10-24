// Chests retain the existing item drop payload, including legacy saves.
export const LOOT_CHEST_RANGE=88;
export function canOpenLootChest(game,chest){
 if(game.status!=='playing'||game.player.hp<=0||chest?.kind!=='loot'||!chest.item||chest.collected)return false;
 if(Math.hypot(chest.x-game.player.x,chest.y-game.player.y)>LOOT_CHEST_RANGE)return false;
 const z=game.elevationAt?.(game.player.x,game.player.y,game.time);
 return (!Number.isFinite(z)||!Number.isFinite(chest.z)||Math.abs(z-chest.z)<=2)&&(!game.clearSight||game.clearSight(game.player,chest));
}
export function lootChestAtPoint(game,point,project=chest=>chest){
 for(let i=game.pickups.length-1;i>=0;i--){const chest=game.pickups[i];if(chest.kind!=='loot'||chest.collected)continue;const p=project(chest);
  if(Math.abs(point.x-p.x)<=32&&point.y>=p.y-65&&point.y<=p.y+9)return chest;
 }
 return null;
}
