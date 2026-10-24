// Survivor adaptations. Native fixed AOS properties are preserved alongside
// these deterministic weapon identities; no extra asset or random roll needed.
export const WEAPON_TRAITS=Object.freeze({
 arcane:{name:'Arcane strike',attributes:{ElementalDamage:25,HitFireball:25}},
 sweeping:{name:'Sweeping strike',attributes:{HitPhysicalArea:35}},
 swift:{name:'Swift strikes',attributes:{WeaponSpeed:20}},
 vampiric:{name:'Vampiric strikes',attributes:{HitLeechHits:25}},
});
const wandSpells={'clumsy-wand':'clumsy','feeble-wand':'feeblemind','weakness-wand':'weaken','fireball-wand':'fireball','greater-heal-wand':'greater-heal','heal-wand':'heal','harm-wand':'harm','lightning-wand':'lightning','magic-arrow-wand':'magic-arrow','mana-drain-wand':'feeblemind'};
const hash=id=>[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
export function weaponIdentity(item){
 if(item?.slot!=='weapon')return null;
 const id=String(item.id||item.name||'').toLowerCase();
 if(/wand|staff/.test(id))return {spellId:wandSpells[id]||(['fireball','lightning','harm','energy-bolt'][hash(id)%4])};
 return {traitId:Object.keys(WEAPON_TRAITS)[hash(id)%4]};
}
export function applyWeaponIdentity(item){
 if(item?.weaponIdentityVersion===1||item?.slot!=='weapon')return item;
 const identity=weaponIdentity(item);if(!identity)return item;
 if(identity.spellId)item.grantedSpell=identity.spellId;
 else {
  item.weaponTrait=identity.traitId;item.weaponBonuses={...WEAPON_TRAITS[identity.traitId].attributes};
 }
 item.weaponIdentityVersion=1;return item;
}
