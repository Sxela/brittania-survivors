import { propertyRows } from "./equipment.mjs";
// EC's five native rows face S, SW, W, NW, N. Other directions mirror them.
export function actorFacing(dx, dy) {
  if (!dx && !dy) return { row: 0, mirror: false };
  const octant = ((Math.round((Math.atan2(dy, dx) - Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
  return { row: octant > 4 ? 8 - octant : octant, mirror: octant > 4 };
}

export function compareEquipment(item, equipped) {
  const left=propertyRows(item),right=propertyRows(equipped),keys=[...new Set([...left.map(r=>r.key),...right.map(r=>r.key)])];
  if(!keys.length)keys.push(item.slot==='weapon'?'power':'defense');
  return keys.map(key=>{const a=left.find(r=>r.key===key),b=right.find(r=>r.key===key),value=a?.value||0,worn=b?.value||0;
    return {key,label:a?.label||b?.label||(key==='power'?'Power':'Defense'),value,equipped:worn,delta:value-worn};});
}
