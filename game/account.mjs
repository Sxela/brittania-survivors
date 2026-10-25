// Permanent account data is separate from ordinary gold and per-run legacy.
export const ACCOUNT_CLASSES=['mage','warrior','archer'];
export const ACCOUNT_UPGRADES=[
 ['power','Damage','+5% global damage bonus'],['vitality','Health','+5% base health'],
 ['speed','Movement','+5% base movement speed'],['haste','Attack speed','+5% attack speed'],
 ['armor','Resistance','+5% of class resistance bases'],['magnet','Pickup range','+5% pickup range'],
 ['regen','Regeneration','Regenerate 0.5% of base health per second'],
 ['cast','Casting','+5% global cast speed'],['area','Area','+5% global spell area'],
 ['duration','Duration','+5% global spell duration'],['gold','Gold find','+5% ordinary gold income'],
 ['luck','Luck','+5 Luck (5% of a 100-point base)'],['startingGold','Starting purse','+5 starting gold (5% of a 100-gold base)'],
].map(([id,name,description])=>({id,name,description}));
export const accountCost=rank=>20+rank*10;
export function accountRanks(value={}){
 return Object.fromEntries(ACCOUNT_UPGRADES.map(({id})=>[id,Math.max(0,Math.min(10,Math.floor(Number(value?.[id])||0)))]));
}
export function validAccountRanks(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(id=>ACCOUNT_UPGRADES.some(u=>u.id===id)&&Number.isInteger(value[id])&&value[id]>=0&&value[id]<=10);
}
export function freshAccount(){return {ingots:0,upgrades:accountRanks(),inventory:[],equipment:Object.fromEntries(ACCOUNT_CLASSES.map(id=>[id,{}])),nextId:1,receipts:{}};}
export function buyAccountUpgrade(profile,id){
 const entry=ACCOUNT_UPGRADES.find(u=>u.id===id),a=profile.account;
 if(!entry||!a)return false;const rank=a.upgrades[id]||0,cost=accountCost(rank);
 if(rank>=10||a.ingots<cost)return false;a.ingots-=cost;a.upgrades[id]=rank+1;return true;
}
export function ingotReward(enemy,random){
 // Normal monsters and champion escorts cannot roll account currency.
 if(!enemy?.boss&&!enemy?.captain&&!enemy?.packChampion)return 0;
 if(random()>=(enemy.boss ? .30 : .12))return 0;
 return enemy.boss?2+Math.floor(random()*9):2+Math.floor(random()*3);
}
