const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
// Place a scrollable property window beside its source without covering item
// selection, sale controls, or the trash target.
export function itemOverlayPosition(anchor,viewport,size,exclusions=[]){
 const margin=8,gap=12,W=viewport.width,H=viewport.height,candidates=[];
 const add=(left,width,lo,hi,side)=>{
  left=Math.max(margin,Math.min(left,W-width-margin));
  let intervals=[[Math.max(margin,lo),Math.min(H-margin,hi)]];
  for(const block of exclusions){
   if(left>=block.right||left+width<=block.left)continue;
   intervals=intervals.flatMap(([a,b])=>block.bottom<=a||block.top>=b?[[a,b]]:[[a,Math.min(b,block.top-gap)],[Math.max(a,block.bottom+gap),b]]).filter(([a,b])=>b-a>=80);
  }
  for(const [a,b] of intervals){
   const height=Math.min(size.height,b-a);if(width<160||height<80)continue;
   const top=Math.max(a,Math.min(anchor.top,b-height));
   const rect={left,top,right:left+width,bottom:top+height};if(overlaps(rect,anchor))continue;
   candidates.push({...rect,width,maxHeight:b-top,score:width*height*(side?1.2:1)});
  }
 };
 const right=W-margin-anchor.right-gap,left=anchor.left-margin-gap;
 if(right>=240)add(anchor.right+gap,Math.min(size.width,right),margin,H-margin,true);
 if(left>=240){const width=Math.min(size.width,left);add(anchor.left-gap-width,width,margin,H-margin,true);}
 const width=Math.min(size.width,W-margin*2);
 add(anchor.left,width,anchor.bottom+gap,H-margin,false);add(anchor.left,width,margin,anchor.top-gap,false);
 if(!candidates.length){const side=right>=left,available=Math.max(right,left),width=Math.max(1,Math.min(size.width,available));add(side?anchor.right+gap:anchor.left-gap-width,width,margin,H-margin,true);}
 candidates.sort((a,b)=>b.score-a.score);
 return candidates[0]||{left:margin,top:Math.min(H-88,anchor.bottom+gap),width,maxHeight:80};
}
