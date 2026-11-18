const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json'};
const {createArtworkStore}=require('./artwork-cache.cjs');
async function createServer({rendererDir=path.resolve(__dirname,'../../dist/renderer'),artworkDir}={}){
  const root=path.resolve(rendererDir),readArtwork=createArtworkStore({dir:artworkDir});
  const server=http.createServer(async(req,res)=>{
    const host='127.0.0.1:'+server.address().port;
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' blob: music-media:; img-src 'self' data: blob: https://*.ytimg.com https://*.googleusercontent.com https://*.ggpht.com; connect-src 'self'; frame-src 'none'");
    if(req.headers.host!==host){res.writeHead(403).end();return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    try {
      const requestURL=new URL(req.url,'http://'+host);
      const route=decodeURIComponent(requestURL.pathname);
      if(route==='/artwork'){
        const url=new URL(requestURL.searchParams.get('url'));
        if(url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname))throw Error('Invalid artwork host');
        const image=await readArtwork(url.href);
        res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.body.length,'Cache-Control':'private, max-age=3600'});
        res.end(req.method==='HEAD'?undefined:image.body);return;
      }
      const file=path.resolve(root,'.'+(route==='/'?'/index.html':route));
      if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]){res.writeHead(404).end();return;}
      const content=await fs.readFile(file);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Content-Length':content.length});
      res.end(req.method==='HEAD'?undefined:content);
    }catch{res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:'http://127.0.0.1:'+server.address().port,close:()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}};
}
module.exports={createServer};

