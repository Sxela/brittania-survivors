import {cp,rename} from 'node:fs/promises';
import path from 'node:path';

export function desktopTarget(platform=process.platform){
 if(platform==='win32')return {platform:'win',original:'electron.exe',executable:'BritanniaSurvivors.exe'};
 if(platform==='linux')return {platform:'linux',original:'electron',executable:'britannia-survivors'};
 throw Error('Desktop builds support Windows and Linux only.');
}
export async function stageRuntime(runtime,destination,platform=process.platform){
 const target=desktopTarget(platform);
 await cp(runtime,destination,{recursive:true,filter:source=>path.basename(source)!=='default_app.asar'});
 await rename(path.join(destination,target.original),path.join(destination,target.executable));
 return target;
}
