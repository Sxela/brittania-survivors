import { DIFFICULTIES } from './general-mechanics.mjs';
import { LEGACY } from './progression.mjs';

export function renderCampControls(root,profile,actions) {
  root.innerHTML=`<div class="difficulty-setting" role="group" aria-label="Difficulty">${Object.entries(DIFFICULTIES).map(([id,d])=>`<button data-difficulty="${id}" aria-pressed="${profile.difficulty===id}" class="${profile.difficulty===id?'selected':''}">${d.name}</button>`).join('')}</div><p class="fine">${profile.difficulty==='hard'?'Hard: stronger hordes, +30% gold and stronger rolled loot.':profile.difficulty==='easy'?'Easy: gentler hordes, 85% gold rewards.':'Normal: standard enemies and rewards.'}<br>${profile.gold} gold in camp / ${profile.victories} victories / Best ${Math.floor(profile.best/60)}m ${Math.floor(profile.best%60)}s</p><div class="camp-actions"><button data-camp="inventory">Equipment & trader</button><button data-camp="legacy">Legacy</button><button data-camp="export">Export save</button><button data-camp="import">Import save</button><button data-camp="reset">New session</button></div>`;
  const difficulty=root.querySelector('.difficulty-setting');
  document.getElementById('difficulty-controls').replaceChildren(difficulty);
  root.querySelector('[data-camp="inventory"]').textContent='Gear & Shop';
  root.querySelectorAll('[data-camp="export"],[data-camp="import"],[data-camp="reset"]').forEach(button=>button.classList.add('hidden'));
  document.querySelectorAll('[data-difficulty]').forEach(button=>button.onclick=()=>actions.difficulty(button.dataset.difficulty));
  root.querySelectorAll('[data-camp]').forEach(button=>button.onclick=()=>actions[button.dataset.camp]());
}
export function renderLegacy(root,profile,{onBuy,onClose}) {
  root.innerHTML=`<h2>Your legacy</h2><p>${profile.gold} gold. Bonuses carry through victories and are lost on death.</p>${LEGACY.map(entry=>{const rank=profile.upgrades[entry.id]||0;return `<div class="legacy-row"><div><img class="legacy-icon" src="assets/classic-ui/abilities/skills/${{power:'evaluatingintelligence',vitality:'anatomy',magnet:'spiritspeak'}[entry.id]}.png" alt=""><strong>${entry.name} ${rank}/5</strong><small>${entry.description}</small></div><button data-legacy="${entry.id}" ${rank>=5||profile.gold<25+rank*25?'disabled':''}>${rank>=5?'Mastered':25+rank*25+' gold'}</button></div>`;}).join('')}<div class="dialog-actions"><button id="close-legacy">Return to camp</button></div>`;
  root.querySelectorAll('[data-legacy]').forEach(button=>button.onclick=()=>onBuy(button.dataset.legacy));
  root.querySelector('#close-legacy').onclick=onClose;
}
