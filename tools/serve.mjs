import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {createHash} from 'node:crypto';
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../game",
);
const types = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
};
const port = Number(process.env.PORT || 8787);
const assetsRoot=path.resolve(process.env.BRITANNIA_ASSETS_DIR||path.join(root,'assets'));
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const pathname=decodeURIComponent(url.pathname);
    if(pathname==='/asset-cache-version.json'){
      // Extraction receipts and manifest stamps change on a local asset rebuild.
      const stamps=await Promise.all(['setup-report.json','manifest.json','ui/manifest.json','effects/manifest.json','audio/manifest.json','mobile-locations/manifest.json','world-equipment/manifest.json'].map(async name=>{try{const info=await stat(path.join(assetsRoot,name));return [name,info.size,info.mtimeMs];}catch{return [name,null];}}));
      const version=createHash('sha256').update(JSON.stringify(stamps)).digest('hex');
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({version}));return;
    }
    if(pathname==='/'||pathname==='/index.html'){
      try{await stat(path.join(assetsRoot,'mobile-locations/manifest.json'));}
      catch{
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Set up Britannia Survivors</title><style>body{max-width:42rem;margin:10vh auto;padding:1rem;background:#171c20;color:#eee;font:18px system-ui}code{color:#eed490}</style><h1>Bring your own Britannia</h1><p>This fan project includes no original game resources.</p><p>Install the official Ultima Online Classic client, then follow ASSET-SETUP.md or docs/asset-setup.md in your download.</p><p>In the source checkout run <code>npm run assets:setup -- --client "PATH_TO_YOUR_CLASSIC_CLIENT"</code>.</p><p>For a desktop download, set <code>BRITANNIA_ASSETS_DIR</code> to the generated <code>game/assets</code> directory and restart.</p>');return;
      }
    }
    const assetRequest=pathname.startsWith('/assets/'),base=assetRequest?assetsRoot:root;
    let file = path.resolve(base, assetRequest?'.'+pathname.slice('/assets'.length):'.'+pathname);
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
const host=process.env.HOST||"127.0.0.1";
server.listen(port, host, () =>
  console.log(`Britannia Survivors: http://127.0.0.1:${port}`),
);
