export function mobilePresentation({width,height,touch=false,forced=false,dpr=1,zoom}={}){
 const mobile=forced||touch&&Math.min(width,height)<=760;
 return {mobile,portrait:mobile&&height>=width,zoom:mobile?([1,1.5,2].includes(zoom)?zoom:1.5):1,dpr:Math.min(dpr||1,mobile?3:2)};
}
export function isTouchHold(pointer,now){
 return !!pointer?.touch&&(pointer.held||now-pointer.startedAt>=180||Math.hypot(pointer.clientX-pointer.originX,pointer.clientY-pointer.originY)>=8);
}
