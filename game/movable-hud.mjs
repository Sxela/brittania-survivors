// Icon positions are UI preferences, independent of character/run saves.
export function attachMovableHud(root) {
  const storageKey='britannia-hud-icons-v1';
  let positions={},drag=null,suppressClick=null,locked=localStorage.getItem('britannia-hud-locked')==='true';
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
    for(const [key,p] of Object.entries(saved||{}))
      if(Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)
        positions[key]={x:p.x,y:p.y};
  } catch {}
  const selector='.skill,.hud-shortcut';
  const keyFor=el=>el.dataset.skill?'spell:'+el.dataset.skill:el.id;
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(positions));}catch{}};
  function place(el,p) {
    if(!root.clientWidth||!root.clientHeight)return;
    el.classList.add('hud-floating');
    el.style.left=Math.round(p.x*Math.max(0,root.clientWidth-el.offsetWidth))+'px';
    el.style.top=Math.round(p.y*Math.max(0,root.clientHeight-el.offsetHeight))+'px';
  }
  function move(el,x,y) {
    const width=Math.max(0,root.clientWidth-el.offsetWidth),height=Math.max(0,root.clientHeight-el.offsetHeight);
    const p={x:width?Math.max(0,Math.min(width,x))/width:0,y:height?Math.max(0,Math.min(height,y))/height:0};
    positions[keyFor(el)]=p;place(el,p);
  }
  function refresh() {
    for(const el of root.querySelectorAll(selector)){
      if(document.body.classList.contains('touch-device')){el.classList.remove('hud-floating');el.style.removeProperty('left');el.style.removeProperty('top');continue;}
      const p=positions[keyFor(el)];if(p)place(el,p);
    }
  }
  root.addEventListener('pointerdown',e=>{
    const el=e.target.closest(selector);
    if(!el||e.button!==0||drag||locked||document.body.classList.contains('touch-device'))return;
    const rect=el.getBoundingClientRect();
    drag={el,id:e.pointerId,x:e.clientX,y:e.clientY,dx:e.clientX-rect.left,dy:e.clientY-rect.top,moved:false,previous:positions[keyFor(el)]};
    el.focus({preventScroll:true});
    el.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
  });
  root.addEventListener('pointermove',e=>{
    if(drag?.id!==e.pointerId)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return;
    drag.moved=true;drag.el.classList.add('hud-dragging');
    const rect=root.getBoundingClientRect();
    move(drag.el,e.clientX-rect.left-drag.dx,e.clientY-rect.top-drag.dy);
    e.preventDefault();e.stopPropagation();
  });
  function finish(e,cancel=false) {
    if(drag?.id!==e.pointerId)return;
    const {el,moved,previous}=drag;drag=null;el.classList.remove('hud-dragging');
    if(moved){
      suppressClick=el;setTimeout(()=>{if(suppressClick===el)suppressClick=null;},0);
      if(cancel){
        if(previous){positions[keyFor(el)]=previous;place(el,previous);}
        else {delete positions[keyFor(el)];el.classList.remove('hud-floating');el.style.removeProperty('left');el.style.removeProperty('top');}
      }
      save();
    }
  }
  root.addEventListener('pointerup',e=>finish(e));
  root.addEventListener('pointercancel',e=>finish(e,true));
  root.addEventListener('click',e=>{
    if(suppressClick&&suppressClick.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();suppressClick=null;}
  },true);
  root.addEventListener('keydown',e=>{
    const el=e.target.closest(selector);
    if(!el||!e.altKey||locked)return;
    if(e.key==='Home'){
      delete positions[keyFor(el)];el.classList.remove('hud-floating');el.style.removeProperty('left');el.style.removeProperty('top');
    } else {
      const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];
      if(!delta)return;
      const rect=el.getBoundingClientRect(),bounds=root.getBoundingClientRect();
      move(el,rect.left-bounds.left+delta[0],rect.top-bounds.top+delta[1]);
    }
    save();e.preventDefault();e.stopPropagation();
  });
  new ResizeObserver(refresh).observe(root);
  refresh();
  return {refresh,get locked(){return locked;},setLocked(value){locked=!!value;localStorage.setItem('britannia-hud-locked',String(locked));root.classList.toggle('hud-locked',locked);},reset(){positions={};save();for(const el of root.querySelectorAll(selector)){el.classList.remove('hud-floating');el.style.removeProperty('left');el.style.removeProperty('top');}}};
}
