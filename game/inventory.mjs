import {rarestFirst} from './reward-rules.mjs';
import {itemOverlayPosition} from './item-overlay.mjs';
import {trackAsset} from './asset-loading.mjs';
import { SLOT_LABELS, orderedEquipment, propertyRows, comparisonItem } from "./equipment.mjs";
import { applyHue } from "./hues.mjs";
import { compareEquipment } from "./presentation.mjs";
let controller, tooltip, ghost, tooltipTimer, tooltipItem, tooltipPinned=false;
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
export function clearEquipmentWindow() {
  controller?.abort(); controller = null;
  clearTimeout(tooltipTimer);tooltipItem=null;tooltipPinned=false;
  tooltip?.remove(); tooltip = null;
  ghost?.remove(); ghost = null;
  document.querySelectorAll(".drop-ready").forEach(el => el.classList.remove("drop-ready"));
}
function equipmentIcon(ui, item) {
  const art=ui.equipment?.items?.[item.slot==='potion'?'potion':item.id];
  return ui.images[art?.variants?.find(v=>v.itemId===item.itemId)?.icon||art?.icon||`equipment/item-${item.itemId}`]?.src || "";
}
function itemArtwork(ui, item) {
  const icon=equipmentIcon(ui,item);
  return `${icon ? `<img src="${esc(icon)}" alt="">` : esc(item.name)}<span class="item-quality">${item.insured?'Insured':item.tier ? '+' + item.tier : ''}</span>`;
}
function equipmentTooltip(game, hint, blocked=()=>false) {
  if(!tooltip){tooltip=document.createElement('div');tooltip.id='equipment-tooltip';tooltip.className='aos-properties hidden';tooltip.setAttribute('role','tooltip');tooltip.tabIndex=0;tooltip.onpointerenter=()=>clearTimeout(tooltipTimer);tooltip.onpointerleave=()=>{tooltipTimer=setTimeout(()=>{tooltip?.classList.add('hidden');tooltipItem=null;},200);};document.body.append(tooltip);}
  document.addEventListener('pointerdown',e=>{if(tooltipPinned&&!e.target.closest('#equipment-tooltip,[data-item],[data-shop-item]')){tooltipPinned=false;tooltipItem=null;tooltip?.classList.add('hidden');}},{signal:controller.signal});
  const hideTooltip = () => {if(tooltipPinned)return;clearTimeout(tooltipTimer);tooltipTimer=setTimeout(()=>{tooltip?.classList.add('hidden');tooltipItem=null;},200);};
  const showTooltip = (item, x, y, anchor=null) => {
    if(blocked()) return;
    clearTimeout(tooltipTimer);
    if(tooltipItem===item&&!tooltip.classList.contains('hidden'))return;
    tooltipItem=item;tooltip.scrollTop=0;tooltipPinned=document.body.classList.contains('touch-device');
    const isWorn=Object.values(game.equipment).includes(item.uid);
    tooltip.classList.toggle('single-item',isWorn);
    const current = isWorn?null:comparisonItem(game,item), rows = compareEquipment(item, current);
    const improved=rows.some(r=>r.delta>0),worse=rows.some(r=>r.delta<0);
    const verdict=isWorn?'Equipped':!current?'Empty slot':improved&&worse?'Trade-off':improved?'Upgrade':worse?'Lower stats':'Same stats';
    const rowsHtml=rows.map(row=>`<tr><th>${esc(row.label)}</th><td>${row.value}</td><td>${row.equipped}</td><td class="${row.delta>0?'stat-better':row.delta<0?'stat-worse':''}">${row.delta>0?'+':''}${row.delta}</td></tr>`).join('');
    tooltip.innerHTML=`<div class="aos-property-panes"><div class="aos-property-list"><strong class="${item.artifact?'artifact':''}">${esc(item.name)}</strong><small>${verdict} / ${item.artifact?'Artifact / ':''}${game.equipment[item.slot]===item.uid?'Equipped':esc(SLOT_LABELS[item.slot]||item.slot)}</small>${item.slot==='weapon'&&(item.stats?.MinDamage||item.stats?.AosMinDamage)?`<div>Damage ${item.stats.MinDamage??item.stats.AosMinDamage} - ${item.stats.MaxDamage??item.stats.AosMaxDamage}</div>`:''}${propertyRows(item).map(row=>`<div>${esc(row.label)} ${row.value}${row.note?` <small>(${esc(row.note)})</small>`:""}</div>`).join('')}</div>${current?`<div class="aos-property-list worn-properties"><strong>${esc(current.name)}</strong><small>Worn / ${esc(SLOT_LABELS[current.slot]||current.slot)}</small>${propertyRows(current).map(row=>`<div>${esc(row.label)} ${row.value}${row.note?` <small>(${esc(row.note)})</small>`:""}</div>`).join('')}</div>`:''}</div>${isWorn?'':`<div class="aos-comparison"><small>${current?'Compared with '+esc(current.name):'Nothing equipped in this slot'}</small><table><thead><tr><th>Stat</th><th>Item</th><th>Worn</th><th>Change</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`}<small>${esc(typeof hint==='function'?hint(item):hint)}</small>`;
    if(item.slot==='potion') tooltip.innerHTML=`<strong>${esc(item.name)}</strong><p>Restores ${item.healing} health when purchased.</p>`;
    if(tooltipPinned){tooltip.insertAdjacentHTML('afterbegin','<button class="properties-close" aria-label="Close item stats">Close</button>');tooltip.querySelector('.properties-close').onclick=()=>{tooltipPinned=false;tooltipItem=null;tooltip.classList.add('hidden');};}
    tooltip.classList.remove('hidden');
    tooltip.style.width='';tooltip.style.maxHeight='';
    const r=tooltip.getBoundingClientRect(),source=anchor||{left:x,top:y,right:x+1,bottom:y+1};
    const exclusions=[...document.querySelectorAll('.equipment-selection,#inventory-trash')].filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect());
    const position=itemOverlayPosition(source,{width:innerWidth,height:innerHeight},{width:r.width,height:r.height},exclusions);
    tooltip.style.width=position.width+'px';tooltip.style.maxHeight=position.maxHeight+'px';
    tooltip.classList.toggle('stacked-properties',position.width<500);
    tooltip.style.left=position.left+'px';tooltip.style.top=position.top+'px';

  };
  return {showTooltip, hideTooltip};
}
export function renderShopWindow({ root, game, ui, onBuy, onClose, onRestock, embedded=false }) {
  if(!embedded){clearEquipmentWindow();controller=new AbortController();}
  const signal=controller.signal;
  root.innerHTML=`<div class="eyebrow">A FRIEND AMONG THE TREES</div><h2>The wandering trader</h2>${embedded?'':`<p>You carry <strong>${game.player.gold}</strong> gold.</p>`}<div class="items">${(game.shop||[]).map((item,i)=>`<div class="item shop-item" data-shop-item="${i}"><div class="shop-item-heading"><button class="pack-item" aria-label="${esc(item.name)}" type="button">${itemArtwork(ui,item)}</button><strong>${esc(item.name)}${item.sold?' / Sold':''}</strong></div><small>${esc(SLOT_LABELS[item.slot]||(item.slot==='potion'?'Potion':item.slot)||'Supplies')}</small><button data-buy="${i}" ${item.sold||game.player.gold<(item.price||item.cost||0)?'disabled':''}>${item.sold?'Sold':'Buy &middot; '+(item.price||item.cost||0)+' gold'}</button></div>`).join('')}</div><div class="dialog-actions"><button data-restock ${game.player.gold<game.restockPrice?'disabled':''}>Refresh stock - ${game.restockPrice} gold</button>${embedded?'':'<button id="close-dialog">Return <kbd>B</kbd></button>'}</div>`;
  const {showTooltip,hideTooltip}=equipmentTooltip(game,'Buy to add this item to your backpack');
  root.querySelectorAll('[data-shop-item]').forEach(card=>{
    const index=Number(card.dataset.shopItem),item=game.shop[index];
    card.addEventListener('pointerenter',e=>showTooltip(item,e.clientX,e.clientY,e.currentTarget.getBoundingClientRect()),{signal});
    card.addEventListener('pointermove',e=>showTooltip(item,e.clientX,e.clientY,e.currentTarget.getBoundingClientRect()),{signal});
    card.addEventListener('pointerleave',hideTooltip,{signal});
    card.addEventListener('focusin',e=>{const r=e.target.getBoundingClientRect();showTooltip(item,r.left,r.bottom,r);},{signal});
    card.addEventListener('focusout',hideTooltip,{signal});
    card.querySelector('[data-buy]').onclick=()=>onBuy(index);
  });
  if(!embedded)root.querySelector('#close-dialog').onclick=onClose;
  root.querySelector('[data-restock]').onclick=onRestock;
}
export function renderEquipmentWindow({ root, game, ui, palettes={}, onChange, onClose, onBuy, onRestock }) {
  clearEquipmentWindow();
  controller = new AbortController();
  const signal = controller.signal;
  const image = key => ui.images[key]?.src || "";
  const dollCanvas=ui.equipment?.canvas||{width:440,height:732};
  const dollWidth=dollCanvas.width||440,dollHeight=dollCanvas.height||732;
  const equipped = item => game.equipment[item.slot] === item.uid;
  const itemButton = (item, index) => `<button class="pack-item" data-item="${item.uid}" data-equip="${index}" aria-label="${esc(item.name)}${equipped(item) ? ', equipped' : ''}" draggable="false">${itemArtwork(ui,item)}</button>`;
  const slot = (name, label) => {
    const alternatives=name==='legs'?['legs','pants']:[name];
    const index = game.inventory.findIndex(item => alternatives.some(k=>item.uid===game.equipment[k]));
    const p = ui.equipment?.slots?.[name];
    const style = p ? ` style="left:${p.x/dollWidth*100}%;top:${p.y/dollHeight*100}%;width:${p.width/dollWidth*100}%;height:${p.height/dollHeight*100}%"` : '';
    const placeholder=image(p?.placeholder||'equipment/slot-'+name);
    return `<div class="doll-slot doll-${name}"${style} data-drop="${name}" aria-label="${esc(label)} slot${index<0?', empty':''}" title="${esc(label)}">${index >= 0 ? itemButton(game.inventory[index], index) : placeholder?`<img class="empty-slot" src="${placeholder}" alt="${esc(label)}">`:''}</div>`;
  };
  const previousSelection=Number(root.dataset.selectedItem)||null;
  root.dataset.mobileInventoryView=root.dataset.mobileInventoryView||'bag';
  const previousScroll=Number(root.dataset.packScroll)||0;
  root.classList.add("equipment-window");
  root.innerHTML = `<div class="inventory-toolbar"><div class="inventory-tabs" role="tablist" aria-label="Inventory"><button id="gear-tab" role="tab" aria-controls="gear-content">Gear</button><button id="shop-tab" role="tab" aria-controls="equipment-shop" ${onBuy?'':'disabled'}>Shop</button></div><strong>${game.player.gold} gold</strong><button id="close-dialog">Close</button></div>
    <div id="gear-content" role="tabpanel"><div class="mobile-inventory-switch" role="group" aria-label="Equipment view"><button data-mobile-inventory="bag">Bag</button><button data-mobile-inventory="doll">Character</button></div>
    <div class="equipment-workspace">
      <section class="paperdoll-window" aria-label="Paperdoll">
        <h3>${esc(game.archetype === 'mage' ? 'Magician' : game.archetype === 'warrior' ? 'Warrior' : 'Ranger')}</h3>
        <div class="paperdoll-stage" style="aspect-ratio:${dollWidth}/${dollHeight}" data-drop="doll" aria-label="Drop equipment on your character">
          <img class="paperdoll-frame" src="${image('equipment/paperdoll-background')}" alt="">
          <canvas id="equipment-doll" width="${dollWidth}" height="${dollHeight}" aria-label="Character wearing equipped items"></canvas>
          ${(ui.equipment.slotOrder||Object.keys(ui.equipment.slots)).map(name=>slot(name,SLOT_LABELS[name]||name)).join('')}
          <span class="paperdoll-name">${esc(game.player.level ? 'Level ' + game.player.level : 'Adventurer')}</span>
        </div>
      </section>
      <section class="backpack-window" aria-label="Backpack">
        <h3>Backpack</h3>
        <div class="leather-backpack" data-drop="pack" aria-label="Drop equipped items here to put them in your backpack">
          <img class="backpack-art" src="${image('equipment/backpack')}" alt="">
          <div class="backpack-items">${game.inventory.map((item,i)=>({item,i})).sort((a,b)=>rarestFirst(a.item,b.item)).map(({item,i})=>equipped(item)?'':itemButton(item,i)).join('')}</div>
        </div>
        <div class="backpack-tools"><p class="equipment-help">${document.body.classList.contains('touch-device')?'Tap for stats / Drag to equip':'Drag to equip / Hover to compare'}</p><button id="inventory-trash" data-drop="trash" type="button" aria-label="Discard selected item or drag an item here" title="Drag an item here to discard it"><img src="${image('inventory/trash')}" alt="Trash"><span>Trash</span></button></div>
        <div class="equipment-selection" aria-live="polite"><span id="selected-item-name">Select an item</span><button id="equip-selected" disabled hidden>Equip</button><button id="unequip-selected" disabled hidden>Unequip</button><button id="sell-selected" disabled hidden>Sell</button></div>
      </section>

    </div>
    <details class="equipment-settings"><summary>Inventory options</summary>            <button id="autosell-toggle" title="Cycle autosell mode">Autosell<small>${game.autosell==='off'?'Off':game.autosell==='common'?'Common':'Inferior'}</small></button>
            <button id="autoequip-toggle" aria-pressed="${!!game.autoequip}">Autoequip<small>${game.autoequip?'On':'Off'}</small></button>
            <button id="body-toggle">Body<small>${game.player.sex==='female'?'Female':'Male'}</small></button>

</details>
    <p id="equipment-notice" role="status"></p>
    </div>${onBuy?'<section id="equipment-shop" role="tabpanel" aria-label="Shop"></section>':''}`;
  const notice = text => { root.querySelector('#equipment-notice').textContent = text; };
  let selectedUid = previousSelection, drag = null;
  const select = item => {
    selectedUid = item.uid;root.dataset.selectedItem=String(item.uid);
    root.querySelectorAll('[data-item]').forEach(button=>button.classList.toggle('selected-item',Number(button.dataset.item)===item.uid));
    root.querySelector('#equip-selected').disabled=equipped(item);
    root.querySelector('#equip-selected').hidden=equipped(item);
    root.querySelector('#unequip-selected').hidden=!equipped(item);
    root.querySelector('#sell-selected').hidden=equipped(item);
    root.querySelector('#selected-item-name').textContent = item.name;
    const sell = root.querySelector('#sell-selected');
    root.querySelector('#unequip-selected').disabled=!equipped(item);
    sell.disabled = equipped(item); sell.textContent = `Sell ${Math.max(1, Math.floor(item.price / 2))}g`;
  };
  root.querySelector('#close-dialog').onclick = onClose;
  root.setInventoryTab=tab=>{
    const shop=tab==='shop'&&!!onBuy;root.dataset.inventoryTab=shop?'shop':'gear';
    root.querySelector('#gear-content').classList.toggle('hidden',shop);
    root.querySelector('#equipment-shop')?.classList.toggle('hidden',!shop);
    root.querySelector('#gear-tab').setAttribute('aria-selected',String(!shop));
    root.querySelector('#shop-tab').setAttribute('aria-selected',String(shop));
    hideTooltip();root.scrollTop=0;
  };
  root.querySelector('#gear-tab').onclick=()=>root.setInventoryTab('gear');
  root.querySelector('#shop-tab').onclick=()=>root.setInventoryTab('shop');
  const showEquipmentView=view=>{
    root.dataset.mobileInventoryView=view;
    root.querySelectorAll('[data-mobile-inventory]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mobileInventory===view)));
  };
  root.querySelectorAll('[data-mobile-inventory]').forEach(button=>button.onclick=()=>showEquipmentView(button.dataset.mobileInventory));
  showEquipmentView(root.dataset.mobileInventoryView);
  root.querySelector('#autosell-toggle').onclick=()=>{game.autosell={off:'inferior',inferior:'common',common:'off'}[game.autosell];game.cleanupInventory?.();onChange();};
  root.querySelector('#autoequip-toggle').onclick=()=>{game.autoequip=!game.autoequip;if(game.autoequip)game.autoEquipInventory?.();onChange();};
  root.querySelector('#body-toggle').onclick=()=>{game.player.sex=game.player.sex==='female'?'male':'female';for(const item of game.wornItems)if((game.player.sex==='male'&&item.allowMale===false)||(game.player.sex==='female'&&item.allowFemale===false))game.equipment[item.slot]=null;game.refreshEquipmentStats();onChange();};
  root.querySelector('#equip-selected').onclick=()=>{const index=game.inventory.findIndex(item=>item.uid===selectedUid);if(game.equip(index))onChange();};
  root.querySelector('#unequip-selected').onclick=()=>{
    const index=game.inventory.findIndex(item=>item.uid===selectedUid);
    if(game.unequip(index))onChange();
  };
  root.querySelector('#sell-selected').onclick = () => {
    const i = game.inventory.findIndex(item => item.uid === selectedUid);
    if(game.sell(i)) onChange();
  };
  const discardItem=item=>{const index=game.inventory.findIndex(i=>i.uid===item?.uid);if(game.discard(index)){root.dataset.selectedItem='';onChange();}};
  root.querySelector('#inventory-trash').onclick=()=>{const item=game.inventory.find(i=>i.uid===selectedUid);if(item)discardItem(item);};
  const performDrop = (item, target) => {
    const index = game.inventory.findIndex(i => i.uid === item.uid);
    if(target==='trash'){discardItem(item);return;}
    if(target === 'pack') {
      if(game.unequip(index)) onChange();
      return;
    }
    if(target !== 'doll' && target !== item.slot && !(target==='legs'&&item.slot==='pants')) {
      notice(`That item belongs in the ${SLOT_LABELS[item.slot]||item.slot} slot.`); return;
    }
    if(game.equip(index)) onChange();else notice('This item cannot be equipped by your character.');
  };
  const {showTooltip,hideTooltip}=equipmentTooltip(game,item=>equipped(item)?'Double-click, press Enter or select Unequip to return to the backpack':'Double-click or press Enter to equip',()=>!!ghost);
  root.querySelectorAll('[data-item]').forEach(button => {
    const item = game.inventory.find(item => item.uid === Number(button.dataset.item));
    button.addEventListener('pointerenter',e => showTooltip(item,e.clientX,e.clientY,e.currentTarget.getBoundingClientRect()),{signal});
    button.addEventListener('pointermove',e => { if(!drag) showTooltip(item,e.clientX,e.clientY,e.currentTarget.getBoundingClientRect()); },{signal});
    button.addEventListener('pointerleave',hideTooltip,{signal});
    button.addEventListener('focus',() => { const r=button.getBoundingClientRect(); showTooltip(item,r.left,r.bottom,r); },{signal});
    button.addEventListener('blur',hideTooltip,{signal});
    button.addEventListener('click',() => select(item),{signal});
    button.addEventListener('dblclick',() => performDrop(item,equipped(item)?'pack':'doll'),{signal});
    button.addEventListener('keydown',e => { if(e.key==='Enter'){e.preventDefault();performDrop(item,equipped(item)?'pack':'doll');} },{signal});
    button.addEventListener('pointerdown',e => {
      if(e.button!==0) return;
      e.preventDefault(); button.focus(); select(item);
      drag = { item, button, pointerId:e.pointerId, x:e.clientX, y:e.clientY, clientX:e.clientX, clientY:e.clientY };
      button.setPointerCapture(e.pointerId);
      requestAnimationFrame(scrollWhileDragging);
    },{signal});
  });
  function scrollWhileDragging() {
    if(!drag || signal.aborted) return;
    if(ghost) {
      const r=root.getBoundingClientRect();
      if(drag.clientY<r.top+65) root.scrollTop-=10;
      else if(drag.clientY>r.bottom-65) root.scrollTop+=10;
    }
    requestAnimationFrame(scrollWhileDragging);
  }
  const validTarget = target => target === 'trash' || target === 'pack' || target === 'doll' || target === drag?.item.slot || (target==='legs'&&drag?.item.slot==='pants');
  document.addEventListener('pointermove',e => {
    if(!drag || e.pointerId !== drag.pointerId) return;
    drag.clientX=e.clientX;drag.clientY=e.clientY;
    if(!ghost && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5) return;
    if(!ghost) { clearTimeout(tooltipTimer);tooltip?.classList.add('hidden');tooltipItem=null; ghost=drag.button.cloneNode(true);ghost.removeAttribute('id');ghost.classList.add('item-drag-ghost');ghost.setAttribute('aria-hidden','true');document.body.append(ghost); }
    ghost.style.left = (e.clientX-24)+'px';ghost.style.top = (e.clientY-24)+'px';
    root.querySelectorAll('[data-drop]').forEach(el=>el.classList.toggle('drop-ready',el.dataset.drop===drag.item.slot||(el.dataset.drop==='legs'&&drag.item.slot==='pants')));
    const target = document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop]');
    if(target && validTarget(target.dataset.drop)) target.classList.add('drop-ready');
  },{signal});
  document.addEventListener('pointerup',e => {
    if(!drag || e.pointerId!==drag.pointerId) return;
    const item=drag.item, wasDragging=!!ghost;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop]');
    ghost?.remove();ghost=null;drag=null;
    root.querySelectorAll('.drop-ready').forEach(el=>el.classList.remove('drop-ready'));
    if(wasDragging && target) performDrop(item,target.dataset.drop);
  },{signal});
  document.addEventListener('pointercancel',()=>{ghost?.remove();ghost=null;drag=null;root.querySelectorAll('.drop-ready').forEach(el=>el.classList.remove('drop-ready'));},{signal});
  if(onBuy)renderShopWindow({root:root.querySelector('#equipment-shop'),game,ui,onBuy,onRestock,embedded:true});
  root.setInventoryTab(root.dataset.inventoryTab||'gear');
  const pack=root.querySelector('.backpack-items');pack.scrollTop=previousScroll;
  pack.addEventListener('scroll',()=>{root.dataset.packScroll=String(pack.scrollTop);},{signal});
  const oldItem=game.inventory.find(item=>item.uid===previousSelection);if(oldItem)select(oldItem);
  paintDoll(root.querySelector('#equipment-doll'),game,ui,palettes);
}
async function paintDoll(canvas,game,ui,palettes) {
  const g=canvas.getContext('2d'),origin=ui.equipment?.canvas||{originX:220,originY:325},sex=game.player.sex||'male';
  const draw=async(visual,hue=0,partialHue=false)=>{
    if(!visual)return;const entry=ui.images[visual.image];if(!entry)return;
    const image=new Image();image.src=entry.src;await trackAsset('Inventory artwork',()=>image.decode());if(!canvas.isConnected)return;
    let art=image;
    hue=hue||visual.sourceHue||visual.equipmentConversion?.hue||0;
    if(hue&&palettes[String(hue&0x3fff)]){const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const cg=c.getContext('2d');cg.drawImage(image,0,0);const p=cg.getImageData(0,0,c.width,c.height);applyHue(p.data,palettes[String(hue&0x3fff)],partialHue||!!(hue&0x8000));cg.putImageData(p,0,0);art=c;}
    const [left,top]=visual.bounds;g.drawImage(art,origin.originX+left,origin.originY+top);
  };
  await draw(ui.equipment?.bodies[sex],game.player.hue||1002,true);
  for(const item of orderedEquipment(game)){
    const art=ui.equipment?.items?.[item.id],variant=art?.variants?.find(v=>v.itemId===item.itemId)||art;
    await draw(variant?.layers?.[sex],item.hue,!!(variant?.partialHue??art?.partialHue));
  }
}
