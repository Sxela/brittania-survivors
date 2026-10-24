const fs=require('node:fs/promises');
const path=require('node:path');
function releaseVersion(value){
 if(typeof value!=='string')throw Error('Provide a release version such as 1.2.3 or 1.2.3-beta.1.');
 const version=value.startsWith('v')?value.slice(1):value;
 const match=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
 if(!match||match[0]!==version||match.slice(1,4).some(n=>Number(n)>65535)||(match[4]||'').split('.').some(id=>/^0[0-9]+$/.test(id)))throw Error('Invalid release version: use major.minor.patch with an optional prerelease suffix.');
 return {version,tag:'v'+version,prerelease:!!match[4]};
}
async function prepareRelease(value,root=path.resolve(__dirname,'..')){
 const result=releaseVersion(value),pkgPath=path.join(root,'package.json'),lockPath=path.join(root,'package-lock.json'),htmlPath=path.join(root,'game/index.html');
 const pkg=JSON.parse(await fs.readFile(pkgPath,'utf8')),lock=JSON.parse(await fs.readFile(lockPath,'utf8')),html=await fs.readFile(htmlPath,'utf8');
 if(!lock.packages?.['']||!html.includes('LOCAL BUILD <b>'))throw Error('Release metadata is incomplete.');
 pkg.version=lock.version=lock.packages[''].version=result.version;
 await fs.writeFile(pkgPath,JSON.stringify(pkg,null,2)+'\n');await fs.writeFile(lockPath,JSON.stringify(lock,null,2)+'\n');
 await fs.writeFile(htmlPath,html.replace(/(LOCAL BUILD <b>)[^<]+/,(_,prefix)=>prefix+result.version+' · Classic'));
 return result;
}
module.exports={releaseVersion,prepareRelease};
if(require.main===module)(async()=>{
 const [value,flag]=process.argv.slice(2);
 if(flag&&flag!=='--check'||process.argv.length>4)throw Error('Usage: node tools/prepare-release.cjs VERSION [--check]');
 const result=flag==='--check'?releaseVersion(value):await prepareRelease(value);
 if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,Object.entries(result).map(([key,value])=>`${key}=${value}\n`).join(''));
 console.log(`Release ${result.tag}${flag==='--check'?' validated':' prepared'}.`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
