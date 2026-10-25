export function mobilePresentation({width,height,touch=false,forced=false,dpr=1,zoom}={}){
 const mobile=forced||touch&&Math.min(width,height)<=760;
 const selectedZoom=Number.isFinite(zoom)&&zoom>=.5&&zoom<=2?zoom:mobile?1.5:1;
 return {mobile,portrait:mobile&&height>=width,zoom:selectedZoom,dpr:Math.min(dpr||1,mobile?3:2)};
}
export function isTouchHold(pointer,now){
 return !!pointer?.touch&&(pointer.held||now-pointer.startedAt>=180||Math.hypot(pointer.clientX-pointer.originX,pointer.clientY-pointer.originY)>=8);
}

export function thumbJoystickAvailable({width,height,touch=false,forced=false}={}){
 return forced||touch||width<=760&&height>=width;
}

const joystickDefaults={enabled:false,scale:1,x:8,y:70};
export function joystickPreferences(value={}){
 const bounded=(key,min,max)=>Number.isFinite(value?.[key])?Math.max(min,Math.min(max,value[key])):joystickDefaults[key];
 return {enabled:value?.enabled===true,scale:bounded('scale',.75,2),x:bounded('x',0,100),y:bounded('y',0,100)};
}
export function joystickVector(dx,dy,radius){
 const distance=Math.hypot(dx,dy);
 if(distance<radius*.12||radius<=0)return {x:0,y:0};
 const divisor=Math.max(radius,distance);
 return {x:dx/divisor,y:dy/divisor};
}

export function attachThumbJoystick(element,{available,active,onMove,onStart,storage=globalThis.localStorage}){
 const key='britannia-thumb-joystick-v1';
 let prefs=joystickPreferences(),pointerId=null;
 try{prefs=joystickPreferences(JSON.parse(storage.getItem(key)));}catch{}
 const thumb=element.firstElementChild;
 function cancel(){
  const id=pointerId;pointerId=null;
  if(id!==null&&element.hasPointerCapture(id))element.releasePointerCapture(id);
  thumb.style.transform='';onMove({x:0,y:0});
 }
 function refresh(){
  cancel();
  element.classList.toggle('thumb-enabled',prefs.enabled&&available());
  const root=element.parentElement;
  const size=Math.min(120*prefs.scale,root.clientWidth,root.clientHeight);
  element.style.width=element.style.height=size+'px';
  element.style.left=(root.clientWidth-size)*prefs.x/100+'px';
  element.style.top=(root.clientHeight-size)*prefs.y/100+'px';
 }
 function update(value){prefs=joystickPreferences({...prefs,...value});try{storage.setItem(key,JSON.stringify(prefs));}catch{}refresh();}
 function move(e){
  if(e.pointerId!==pointerId)return;
  if(!active()){cancel();return;}
  const rect=element.getBoundingClientRect(),radius=rect.width*.32;
  const vector=joystickVector(e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2,radius);
  thumb.style.transform=`translate(${vector.x*radius}px,${vector.y*radius}px)`;onMove(vector);e.preventDefault();
 }
 element.addEventListener('pointerdown',e=>{
  if(!prefs.enabled||!available()||!active()||pointerId!==null||e.button!==0)return;
  e.preventDefault();e.stopPropagation();onStart();pointerId=e.pointerId;element.setPointerCapture(pointerId);move(e);
 });
 element.addEventListener('pointermove',move);
 for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,e=>{if(e.pointerId===pointerId)cancel();});
 function options(parent){
  const panel=document.createElement('fieldset');panel.className='joystick-settings';
  panel.innerHTML='<legend>Thumb joystick</legend><button id="option-joystick" type="button"></button><p class="fine">Transparent touch control. Position stays inside the game view when rotating your screen.</p><div class="joystick-preview" aria-hidden="true"><i></i></div>';
  const toggle=panel.querySelector('button'),preview=panel.querySelector('.joystick-preview i');
  const paint=()=>{toggle.textContent='Thumb joystick: '+(prefs.enabled?'On':'Off');toggle.setAttribute('aria-pressed',String(prefs.enabled));preview.style.left=`calc(${prefs.x}% + ${(0.5-prefs.x/100)*28*prefs.scale}px)`;preview.style.top=`calc(${prefs.y}% + ${(0.5-prefs.y/100)*28*prefs.scale}px)`;preview.style.transform=`translate(-50%,-50%) scale(${prefs.scale})`;preview.style.opacity=prefs.enabled?'.65':'.25';};
  toggle.onclick=()=>{update({enabled:!prefs.enabled});paint();};
  for(const [name,label,min,max,step,multiplier] of [['scale','Size',75,200,5,100],['x','Horizontal position',0,100,1,1],['y','Vertical position',0,100,1,1]]){
   const row=document.createElement('label');row.className='volume-control';
   row.innerHTML=`<span>${label} <output></output></span><input id="option-joystick-${name}" type="range" min="${min}" max="${max}" step="${step}" aria-label="Joystick ${label.toLowerCase()}">`;
   const input=row.querySelector('input'),output=row.querySelector('output');input.value=prefs[name]*multiplier;output.textContent=Math.round(prefs[name]*multiplier)+'%';
   input.oninput=()=>{update({[name]:Number(input.value)/multiplier});output.textContent=input.value+'%';paint();};panel.append(row);
  }
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset joystick';reset.onclick=()=>{update(joystickDefaults);panel.remove();options(parent);};panel.append(reset);paint();parent.insertBefore(panel,parent.querySelector(':scope > .dialog-actions'));
 }
 refresh();return {refresh,cancel,options,get engaged(){return pointerId!==null;},get preferences(){return {...prefs};}};
}
