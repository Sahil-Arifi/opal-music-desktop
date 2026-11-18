const fs = require('node:fs');
const {stat} = require('node:fs/promises');
const {Readable} = require('node:stream');
const path = require('node:path');
const {formats} = require('./library.cjs');

async function serveImport(file, request, origin) {
  const {size} = await stat(file);
  const headers = {'Content-Type':formats[path.extname(file).toLowerCase()]||'application/octet-stream',
    'Access-Control-Allow-Origin':origin,'Accept-Ranges':'bytes','Cache-Control':'no-store'};
  const range = request.headers.get('range');
  let start=0,end=size-1;
  if(range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!m||(!m[1]&&!m[2])) return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+size}});
    start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
    end=m[1]&&m[2]?Math.min(Number(m[2]),size-1):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start<0||start>=size)
      return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+size}});
    headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  const body=request.method==='HEAD'||size===0?null:Readable.toWeb(fs.createReadStream(file,{start,end}));
  return new Response(body,{status:range?206:200,headers});
}
module.exports={serveImport};

