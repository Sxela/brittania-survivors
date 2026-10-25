import { findPath, clearSegment } from './pathfinding.mjs';
import {Z_SCALE} from './static-placement.mjs';
export function playerCamera(player,view,elevation=0){
  return {x:player.x-view.w/2,y:player.y-elevation*Z_SCALE-(view.h+(view.topInset||0))/2};
}
// Movement stays continuous; only the sprite facing is quantized to eight directions.
export function cursorWorldPoint(clientX, clientY, rect, player, view, elevationAt=null) {
  const camera=playerCamera(player,view,elevationAt?.(player.x,player.y)||0);
  const point={x:camera.x+(clientX-rect.left)*view.w/rect.width,y:camera.y+(clientY-rect.top)*view.h/rect.height};
  const projectedY=point.y;
  if(elevationAt)for(let i=0;i<4;i++)point.y=projectedY+elevationAt(point.x,point.y)*Z_SCALE;
  return point;
}
export class PointerNavigation {
  destination = null;
  route = [];
  configure(passable=null,nearest=null) {this.passable=passable;this.nearest=nearest;this.cancel();}
  setDestination(point) {
    if(Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      const target=this.passable&&!this.passable(point.x,point.y)&&this.nearest?this.nearest(point.x,point.y):point;
      if(this.destination&&Math.hypot(target.x-this.destination.x,target.y-this.destination.y)<2)return;
      this.destination={x:target.x,y:target.y};this.route=[];
    }
  }
  cancel() { this.destination=null;this.route=[]; }
  steer(player,dt) {
    if(!this.destination)return {x:0,y:0};
    if(this.passable&&!this.route.length){
      this.route=findPath(player,this.destination,this.passable)||findPath(player,this.destination,this.passable,{step:8,limit:24000})||[];
      if(!this.route.length){this.onUnreachable?.(this.destination);this.cancel();return {x:0,y:0};}
    }
    while(this.route.length>1&&Math.hypot(this.route[0].x-player.x,this.route[0].y-player.y)<2)this.route.shift();
    const target=this.route[0]||this.destination;
    if(this.passable&&!clearSegment(player,target,this.passable)){this.route=[];return {x:0,y:0};}
    const dx=target.x-player.x,dy=target.y-player.y,distance=Math.hypot(dx,dy);
    if(distance<.5){this.cancel();return {x:0,y:0};}
    const divisor=Math.max(distance,player.speed*Math.max(0,dt));
    return {x:dx/divisor,y:dy/divisor};
  }
}
