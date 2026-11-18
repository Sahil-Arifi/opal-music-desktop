import {useEffect,useRef,useState} from 'react'
import {motion} from 'motion/react'
import {createPortal} from 'react-dom'
import {Check,Copy,Ellipsis,Globe,ImagePlus,Link2,ListMinus,ListPlus,Lock,Pencil,X} from 'lucide-react'
import type {Desktop,Playlist} from './types'
import {PlaylistArtwork} from './PlaylistArtwork'
import {Btn} from './ui'
import './playlist-settings.css'

type Privacy='public'|'unlisted'|'private'
export type PlaylistDialogState={mode:'create'|'edit'|'share';playlist?:Playlist}
const privacyChoices=[['private','Private',Lock],['unlisted','Unlisted',Link2],['public','Public',Globe]] as const
const message=(error:unknown,fallback:string)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):fallback

type DialogProps={
 dialog:PlaylistDialogState
 api?:Desktop
 close:()=>void
 done:(p?:Playlist)=>void
 coverChanged?:(playlist:Playlist)=>void
 notify?:(message:string)=>void
}
export function PlaylistDialog({dialog,api,close,done,coverChanged,notify}:DialogProps){
 const initial=dialog.playlist,editing=dialog.mode==='edit',sharing=dialog.mode==='share',id=initial?.id
 const [title,setTitle]=useState(initial?.title||''),[description,setDescription]=useState(initial?.description||'')
 const [privacy,setPrivacy]=useState<Privacy|''>(dialog.mode==='create'?'private':initial?.privacy||'')
 const [cover,setCover]=useState(initial),[coverStatus,setCoverStatus]=useState('')
 const [operation,setOperation]=useState<'cover'|'save'|null>(null),[error,setError]=useState(''),[url,setURL]=useState(''),[copied,setCopied]=useState(false)
 const busy=operation!==null
 useEffect(()=>{
   if(!sharing||!id||!api)return
   let live=true;api.playlistAction('share',{id}).then(v=>{if(live){if(v.url)setURL(v.url);else setError('No share link is available for this playlist.')}}).catch(()=>{if(live)setError('The share link could not be loaded.')})
   return()=>{live=false}
 },[sharing,id,api])
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopImmediatePropagation();if(!busy)close()}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[busy,close])

 async function submit(){
   if(!api||busy||!title.trim())return
   setOperation('save');setError('')
   try{
     const result=await api.playlistAction(editing?'edit':'create',{
       id:editing?id:undefined,title:title.trim(),...(privacy?{privacy}:{}),
       ...(description!==(initial?.description||'')?{description}:{}),
     })
     done(result.playlist);notify?.(editing?'Playlist updated':'Playlist created')
   }catch(e){setError(message(e,'Could not save this playlist.'))}
   finally{setOperation(null)}
 }
 async function changeCover(){
   if(!id||!api?.choosePlaylistCover||busy)return
   setOperation('cover');setCoverStatus('');setError('')
   try{
     const playlist=await api.choosePlaylistCover(id)
     if(playlist){setCover(playlist);coverChanged?.(playlist);setCoverStatus('Cover updated');notify?.('Playlist cover updated')}
   }catch(e){setError(message(e,'Could not update the playlist cover.'))}
   finally{setOperation(null)}
 }
 async function copy(){
   try{await navigator.clipboard.writeText(url);setCopied(true)}catch{setError('Select and copy the link below.')}
 }

 return <div className="collection-dialog-back" onPointerDown={e=>{if(e.target===e.currentTarget&&!busy)close()}}>
 <motion.section role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-name" className="collection-dialog" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.18}}>
 <header><h2 id="playlist-dialog-name">{sharing?'Share playlist':editing?'Edit playlist':'Create playlist'}</h2><Btn title="Close playlist dialog" disabled={busy} onClick={close}><X size={17}/></Btn></header>
 {sharing?<><p>{initial?.title}</p>{url?<><input aria-label="Playlist share link" readOnly value={url} onFocus={e=>e.currentTarget.select()}/><Btn className="ink-button" title="Copy link" onClick={copy}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy link'}</Btn></>:!error&&<p role="status">Loading link…</p>}</>:
 <form onSubmit={e=>{e.preventDefault();void submit()}}>
 {editing&&cover&&api?.choosePlaylistCover&&<div className="playlist-cover-setting">
 <PlaylistArtwork playlist={cover}/><div><Btn title="Change playlist cover" disabled={busy} onClick={changeCover}><ImagePlus size={15}/>{operation==='cover'?'Updating cover…':'Change cover…'}</Btn>
 {coverStatus&&<small role="status"><Check size={12}/>{coverStatus}</small>}</div></div>}
 <label className="field-title">Name<input autoFocus maxLength={150} required placeholder="Playlist name" value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
 <label className="field-title playlist-description">Description<textarea rows={3} maxLength={5000} value={description} onChange={e=>setDescription(e.target.value)} disabled={busy}/></label>
 <fieldset disabled={busy}><legend>Visibility</legend><div className="privacy-choices">{privacyChoices.map(([value,label,Icon])=><button key={value} type="button" aria-pressed={value===privacy} onClick={()=>setPrivacy(value)}><Icon size={14}/>{label}</button>)}</div></fieldset>
 <button className="playlist-submit" disabled={busy||!title.trim()}>{operation==='save'?'Saving…':editing?'Save changes':'Create playlist'}</button></form>}
 {error&&<p className="playlist-error" role="alert">{error}</p>}</motion.section></div>
}

type SettingsProps={playlist:Playlist;api?:Desktop;onChange?:(p:Playlist)=>void;notify?:(message:string)=>void}
export function PlaylistSettings({playlist,api,onChange,notify}:SettingsProps){
 const [menu,setMenu]=useState(false),[meta,setMeta]=useState(playlist),[dialog,setDialog]=useState<PlaylistDialogState|null>(null)
 const [checking,setChecking]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('')
 const anchor=useRef<HTMLDivElement>(null)
 useEffect(()=>{setMeta(playlist);setMenu(false);setDialog(null);setError('')},[playlist.id])
 useEffect(()=>{
   if(!menu)return
   let live=true
   setChecking(true);setError('');setMeta(playlist)
   api?.playlistDetails(playlist.id).then(value=>{if(live)setMeta({...playlist,...value})}).catch(e=>{if(live)setError(message(e,'Could not load playlist settings.'))}).finally(()=>{if(live)setChecking(false)})
   function outside(e:PointerEvent){if(!anchor.current?.contains(e.target as Node))setMenu(false)}
   function escape(e:KeyboardEvent){if(e.key==='Escape'){e.stopPropagation();setMenu(false);anchor.current?.querySelector('button')?.focus()}}
   document.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape,true)
   return()=>{live=false;document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape,true)}
 },[menu,playlist.id,api])
 function change(next:Playlist){setMeta(next);onChange?.(next)}
 function open(mode:'edit'|'share'){setDialog({mode,playlist:meta});setMenu(false)}
 async function changeSaved(){
   if(!api||saving||typeof meta.saved!=='boolean')return
   setSaving(true);setError('')
   try{
     const result=await api.playlistAction(meta.saved?'unsave':'save',{id:meta.id})
     if(result.playlist)change(result.playlist)
     notify?.(meta.saved?'Playlist removed from library':'Playlist saved to library');setMenu(false)
   }catch(e){setError(message(e,'Could not update your library.'))}
   finally{setSaving(false)}
 }
 if(!api)return null
 return <div className="playlist-detail-tools" ref={anchor}>
 <Btn title={'Options for '+playlist.title} pressed={menu} onClick={()=>setMenu(v=>!v)}><Ellipsis size={17}/></Btn>
 {menu&&<div className="playlist-menu">{checking&&<small role="status">Checking access…</small>}
 {(meta.owned||(meta as Playlist&{editable?:boolean}).editable)&&<button onClick={()=>open('edit')}><Pencil size={14}/>Edit playlist</button>}
 <button onClick={()=>open('share')}><Link2 size={14}/>Share playlist</button>
 {!meta.owned&&typeof meta.saved==='boolean'&&<button disabled={saving} onClick={changeSaved}>{meta.saved?<ListMinus size={14}/>:<ListPlus size={14}/>} {meta.saved?'Remove from library':'Save to library'}</button>}
 {error&&<small role="alert">{error}</small>}</div>}
 {dialog&&createPortal(<PlaylistDialog dialog={dialog} api={api} close={()=>setDialog(null)} done={next=>{if(next)change(next);setDialog(null)}} coverChanged={change} notify={notify}/>,document.body)}
 </div>
}

