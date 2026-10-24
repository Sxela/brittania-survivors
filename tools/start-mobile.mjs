import os from 'node:os';
process.env.HOST='0.0.0.0';process.env.PORT=process.env.PORT||'8790';
const {server}=await import('./serve.mjs');
function ready(){
 console.log('Open one of these addresses on your phone using the same Wi-Fi:');
 for(const network of Object.values(os.networkInterfaces()))for(const address of network||[])if(address.family==='IPv4'&&!address.internal)console.log('http://'+address.address+':'+server.address().port+'/?mobile=1');
 console.log('Keep this window open while playing. Press Ctrl+C to stop.');
}
if(server.listening)ready();else server.once('listening',ready);
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Mobile port '+process.env.PORT+' is already in use. Close the other launcher or choose another PORT.':error.message);process.exitCode=1;});
