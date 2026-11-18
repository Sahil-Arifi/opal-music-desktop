const fs=require('node:fs/promises');
const path=require('node:path');
const {clickPoint}=require('./site-rating.cjs');
const {readPlaylistDetails}=require('./history-reader.cjs');

function coverControl(action,file){
  const form=document.querySelector('ytmusic-playlist-form');
  const editor=document.querySelector('yt-image-editor-renderer');
  const visible=el=>el?.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]');
  const button=(scope,selector)=>[...scope?.querySelectorAll(selector)||[]].find(visible);
  const label=el=>(el.getAttribute('aria-label')||el.textContent||'').trim();
  function point(el){
    if(!visible(el) || el.disabled)return null;el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
    return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
  }
  if(action==='setFile'){
    const input=editor?.querySelector('input[type=file][accept*="image"]') || form?.querySelector('input[type=file][accept*="image"]');
    if(!input)return false;
    const bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.name,{type:file.type}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return true;
  }
  if(action==='openEditor'){
    const anchor=button(form||document,'.thumbnail-edit-button button,.thumbnail-edit-button-wrapper button') ||
      [...(form||document).querySelectorAll('button')].find(el=>visible(el) && /^(?:upload|change|edit|choose|replace)(?: playlist)? (?:thumbnail|image|photo|cover)/i.test(label(el)));
    return point(anchor);
  }
  if(action==='commitImage')return point(button(editor,'#update-button button,#update-button') || [...editor?.querySelectorAll('button')||[]].find(el=>/^(?:done|save|apply|update)$/i.test(label(el))));
  if(action==='hasEditor')return !!visible(editor);
  if(action==='hasForm')return !!visible(form);
  return null;
}

async function readCoverFile(filePath){
  if(typeof filePath!=='string' || !path.isAbsolute(filePath))throw Error('Choose a playlist image first.');
  const file=await fs.open(filePath,'r');
  try{
    const info=await file.stat();
    if(!info.isFile() || !info.size || info.size>10*1024*1024)throw Error('Choose a JPEG, PNG or WebP image up to 10 MB.');
    const bytes=await file.readFile();
    const type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':
      bytes[0]===255 && bytes[1]===216 && bytes[2]===255?'image/jpeg':
      bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP'?'image/webp':'';
    if(!type)throw Error('Choose a JPEG, PNG or WebP image.');
    return {name:path.basename(filePath),data:bytes.toString('base64'),type};
  }finally{await file.close();}
}

async function replaceCover({win,call,control,poll,navigate,url,payload,assertAccount}){
  const file=await readCoverFile(payload.filePath);assertAccount();
  await navigate(url);const before=await poll(()=>call(readPlaylistDetails),'YouTube Music could not open the playlist.');
  let editor=await call(coverControl,'openEditor');
  if(!editor){
    await poll(()=>control('edit'),'YouTube Music does not offer cover editing for this playlist.');
    editor=await poll(()=>call(coverControl,'openEditor'),'YouTube Music does not offer a custom image for this playlist.');
  }
  assertAccount();clickPoint(win.webContents,editor);
  await poll(()=>call(coverControl,'setFile',file),'YouTube Music did not offer an image upload for this playlist.');
  const save=await poll(()=>call(coverControl,'commitImage'),'YouTube Music did not offer saving this image.');
  assertAccount();clickPoint(win.webContents,save);
  await poll(async()=>!await call(coverControl,'hasEditor'),'YouTube Music did not confirm the image.');
  if(await call(coverControl,'hasForm')){
    await poll(()=>control('submit'),'YouTube Music did not offer saving the new cover.');
    await poll(async()=>!await call(coverControl,'hasForm'),'YouTube Music did not finish saving the cover.');
  }
  await navigate(url);
  const after=await poll(async()=>{const d=await call(readPlaylistDetails);return d?.artwork && d.artwork!==before.artwork?d:null;},'YouTube Music did not confirm a changed playlist cover.');
  return {ok:true,playlist:{...after,source:'youtube'}};
}
module.exports={replaceCover,readCoverFile};

