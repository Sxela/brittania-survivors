// Draw by category first so a large spell family cannot crowd out other choices.
export function mixedChoiceDraw(pool,count,random,category=choice=>choice.type==='spell'?choice.category:'passive'){
 const groups=new Map();for(const choice of pool){const key=category(choice);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(choice);}
 const take=items=>items.splice(Math.min(items.length-1,Math.floor(random()*items.length)),1)[0];
 const keys=[...groups.keys()],draw=[];
 while(keys.length&&draw.length<count){const key=take(keys);draw.push(take(groups.get(key)));}
 const rest=[...groups.values()].flat();while(rest.length&&draw.length<count)draw.push(take(rest));
 return draw;
}
