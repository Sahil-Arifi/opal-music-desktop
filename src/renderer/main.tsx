import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {createRoot} from 'react-dom/client'
import {AnimatePresence,LayoutGroup,MotionConfig,motion} from 'motion/react'
import {ArrowDownToLine,ArrowLeft,ArrowRight,ArrowUpRight,AudioLines,Check,ChevronRight,Disc3,Ellipsis,Expand,Folder,Heart,Import,KeyRound,Library,ListMusic,Music2,Plus,RefreshCw,Search,Settings2,Volume2,X} from 'lucide-react'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import {GlobalSearch} from './Search'
import {Stats} from './Stats'
import {Catalog,FollowedArtists} from './Catalog'
import {TrackActionsProvider,TrackFeedback} from './TrackMenu'
import {PlaylistLibrary,PlaylistTracks} from './Playlists'
import {PlaylistSettings} from './PlaylistActions'
import {GlassSelect} from './Select'
import {LaunchLens} from './LaunchLens'
import {GlassLighting} from './GlassLighting'
import {ExpandedPlayer,type PlayerPanel} from './ExpandedPlayer'
import {Avatar,CollectionEmpty,syncText} from './account-ui'
import {Opal,opal,sampleCover,useGlassEnergy,type Palette} from './Opal'
import {artURL,blankHome,blankState,type CatalogKind,type CatalogRef,type Command,type Desktop,type Home,type Mode,type Playlist,type State,type Track,stamp} from './types'
import {Btn,Cover,Empty,FullEffects,Google,Mark,OpticalDefs,PlayIcon,SectionHead,Shelf,TrackRows,spring} from './ui'
import {Dock,HomeView,Mini,Rail,RadioSection,type Page} from './views'
import './style.css'
import './design-match.css'
import './track-menu.css'
import './dark.css'

const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribeMotion=(callback:()=>void)=>{motionPreference.addEventListener('change',callback);return()=>motionPreference.removeEventListener('change',callback)}
const readMotion=()=>motionPreference.matches

const preview=new URLSearchParams(location.search).get('prototype')==='1'
const toastText=(e:unknown)=> e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': Error: /,''):String(e)
type AuthControls={
 busy:boolean;waiting:boolean;passkey:boolean;finishing:boolean;passkeyMessage:string;signin:()=>void;start:()=>void;finish:()=>void;cancelKey:()=>void;reopen:()=>void;cancel:()=>void
}
function AuthButtons({busy,waiting,passkey,finishing,signin,start,finish,cancelKey,reopen,cancel}:AuthControls){
 if(passkey)return <div className="auth-buttons">
   <Btn title="Finish sign-in" className="google-button" disabled={finishing} onClick={finish}><KeyRound size={16}/>{finishing?'Finishing sign-in…':'Finish sign-in'}<ArrowRight size={15}/></Btn>
   <div className="auth-links"><button disabled={finishing} onClick={start}>Reopen Chrome</button><button disabled={finishing} onClick={cancelKey}>Cancel</button></div>
 </div>
 return <div className="auth-buttons">
   <Btn title={waiting?'Reopen account window':preview?'Preview sign-in':'Sign in with Google'} onClick={waiting?reopen:signin} disabled={busy} className="google-button"><Google/>{waiting?'Reopen account window':'Sign in with Google'}<ArrowRight size={15}/></Btn>
   {waiting?<button className="local-link" onClick={cancel}>Back to sign-in</button>:<Btn className="passkey-button" title="Sign in with passkey" onClick={start} disabled={busy}><KeyRound size={14}/>Sign in with passkey</Btn>}
 </div>
}
function SignIn({controls,local,error}:{controls:AuthControls;local:()=>void;error:string}){
 return <main className="signin"><div className="sign-chrome"><Mark size={22}/><b>Opal Music</b>{preview&&<span className="preview-tag">Design preview</span>}</div>
 <motion.section className="sign-center" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.6,ease:[.2,.7,.3,1]}}>
 <div className="sign-lens" aria-hidden="true"><LaunchLens/><span className="lens-line"/><div className="lens-mark"><Mark size={77}/></div></div>
 <h1>Opal Music</h1><p>Independent desktop client. Not affiliated with Google or YouTube.</p><p role="status">{controls.passkey?controls.passkeyMessage:controls.waiting?'Finish signing in in the YouTube Music window.':'Connect your Google account to open your music library.'}</p>
 <AuthButtons {...controls}/>
 <button className="local-link" onClick={local}>Use local music <ChevronRight size={12}/></button>
 {error&&<p className="auth-error" role="alert">{error}</p>}</motion.section>
 </main>
}
function App({api}:{api?:Desktop}){
 const [home,setHome]=useState<Home>(blankHome),[state,setState]=useState<State>(blankState),[mode,setMode]=useState<Mode>('full')
 const [waiting,setWaiting]=useState(false),[passkeyPending,setPasskeyPending]=useState(false),[completing,setCompleting]=useState(false),loginAttempt=useRef(0)
 const [loaded,setLoaded]=useState(false),[local,setLocal]=useState(false),[busy,setBusy]=useState(false),[notice,notify]=useState(''),[authError,setAuthError]=useState('')
 const [catalog,setCatalog]=useState<{kind:CatalogKind;ref:CatalogRef}|null>(null),[catalogArt,setCatalogArt]=useState<string|undefined>()
 const [immersive,setImmersive]=useState(false)
 const [page,pageTo]=useState<Page>('Home'),[expanded,setExpanded]=useState(false),[panel,setPanel]=useState<PlayerPanel>(null),[detail,setDetail]=useState<Track|null>(null),[anchor,setAnchor]=useState('')
 const [playlistQuery,setPlaylistQuery]=useState('')
 const [playlist,setPlaylist]=useState<Playlist|null>(null),[songs,setSongs]=useState<Track[]>([]),[playlistWait,waitPlaylist]=useState(false)
 const [searchFocus,setSearchFocus]=useState(0),[searchSeed,setSearchSeed]=useState({query:'',id:0}),[section,setSection]=useState<{name:Page;request:number}>({name:'Home',request:0}),[playlistError,setPlaylistError]=useState('')
 const [palette,setPalette]=useState<Palette>(opal),[ignoredError,setIgnored]=useState(''),preferReduce=useSyncExternalStore(subscribeMotion,readMotion),fullEffects=state.effects==='full'||(preview&&!state.effects),reduce=!fullEffects&&preferReduce
 const content=useRef<HTMLElement>(null),searchInput=useRef<HTMLInputElement>(null),lastHome=useRef(0),playlistReq=useRef(0)
 const activePlaylist=useRef(playlist?.id);activePlaylist.current=playlist?.id
 const playlistCache=useRef(new Map<string,Track[]>()),loadingPlaylist=useRef<string|null>(null)
 const accountOwner=useRef(home.account.id||home.account.handle);accountOwner.current=home.account.id||home.account.handle
 const rememberPlaylist=(id:string,rows:Track[])=>{const cache=playlistCache.current;cache.delete(id);cache.set(id,rows);if(cache.size>12)cache.delete(cache.keys().next().value!)}
 useEffect(()=>api?.onPlaylistUpdate?.(event=>{
   if((loadingPlaylist.current!==event.id&&activePlaylist.current!==event.id)||event.sort!=='default')return
   const cached=playlistCache.current.get(event.id)
   if(!event.complete&&cached&&cached.length>event.tracks.length)return
   if(event.complete)rememberPlaylist(event.id,event.tracks)
   setSongs(event.tracks)
 }),[api])
 useEffect(()=>{playlistCache.current.clear();playlistReq.current++;loadingPlaylist.current=null;setPlaylist(null);setSongs([]);waitPlaylist(false);setPlaylistError('')},[home.account.id||home.account.handle||home.account.email])
 const browserSignIn=home.account.browserSignIn
 const passkey=passkeyPending||!!browserSignIn?.active
 const finishing=completing||browserSignIn?.phase==='finishing'
 const shell=home.account.connected||home.account.restoring||local||state.library.some(t=>t.source==='local'),mini=mode==='mini'&&shell
 const expandedTrack=detail?.id===state.current?.id?state.current:detail||state.current
 useGlassEnergy(api,mini?'mini':expanded?'expanded':'browse',!!shell && state.playing && !reduce)
 const shown=expanded&&!mini?expandedTrack:state.current
 const opener=useRef<HTMLElement|null>(null)
 useEffect(()=>{if(detail&&state.current?.id===detail.id)setDetail(null)},[detail,state.current?.id])
 const paletteURL=page==='Catalog'&&!expanded?catalogArt:!expanded&&!mini&&(page==='Playlist'||page==='Liked Songs')?(playlist?.artwork||songs[0]?.artwork||shown?.artwork):shown?.artwork
 useEffect(()=>{if(paletteURL)return sampleCover(artURL(paletteURL),setPalette);setPalette(opal)},[paletteURL])
 useEffect(()=>{
   if(!api){setLoaded(true);setAuthError('Open the Mac app to connect your account.');return}
   let alive=true
   const update=(h:Home)=>{if(!alive)return;lastHome.current++;setHome({...blankHome,...h});if(h.account.connected&&!h.account.browserSignIn?.active){setPasskeyPending(false)}if(h.account.connected){setAuthError('');setWaiting(false);setBusy(false)}}
   let stateVersion=0,modeVersion=0
   const h=api.onHome(update),s=api.onState(v=>{stateVersion++;setState({...blankState,...v})}),m=api.onMode(v=>{modeVersion++;setMode(v)})
   const progress=api.onProgress?.(v=>setState(old=>old.current?.id===v.id?{...old,position:v.position,duration:v.duration}:old))
   const epoch=lastHome.current
   Promise.all([api.getHome(),api.getState(),api.getMode()]).then(([home,s,m])=>{if(!alive)return;if(lastHome.current===epoch)update(home);if(!stateVersion)setState(s);if(!modeVersion)setMode(m)}).catch(err=>notify(toastText(err))).finally(()=>{if(alive)setLoaded(true)})
   return()=>{alive=false;h();s();m();progress?.()}
 },[api])
 useEffect(()=>{if(!notice)return;const id=setTimeout(()=>notify(''),7000);return()=>clearTimeout(id)},[notice])
 useEffect(()=>{if(!state.error)setIgnored('')},[state.error])
 useEffect(()=>{content.current?.scrollTo({top:0,behavior:'instant'})},[page,playlist,catalog])
 const pendingFocus=useRef(false)
 useEffect(()=>{if(!mini&&pendingFocus.current&&searchInput.current){pendingFocus.current=false;searchInput.current.focus({preventScroll:true});searchInput.current.select()}},[mini,searchFocus])
 const call=useCallback((fn:()=>Promise<unknown>|undefined)=>{Promise.resolve().then(fn).catch(e=>notify(toastText(e)))},[])
 const send=useCallback((c:Command,v?:unknown)=>call(async()=>{await api?.command(c,v);const message=({queueTrack:'Added to queue',playNext:'Playing next',removeQueue:'Removed from queue',saveTrack:'Added to liked songs',removeSaved:'Removed from liked songs'} as Partial<Record<Command,string>>)[c];if(message)notify(message)}),[api,call])
 const closeExpanded=()=>{setImmersive(false);void api?.setVideoBounds(null).catch(()=>{});setExpanded(false);setDetail(null);setPanel(null);requestAnimationFrame(()=>{if(opener.current?.isConnected)opener.current.focus({preventScroll:true})})}
 const navigate=(p:Page)=>{
   setImmersive(false);void api?.setVideoBounds(null).catch(()=>{});setExpanded(false);setDetail(null);setPanel(null);setPlaylistQuery('')
   if(p==='Liked Songs'){choosePlaylist({id:'LM',title:'Liked Songs',artwork:home.liked[0]?.artwork});pageTo('Liked Songs');return}
   if(p==='Home'||p==='Recent artists'||p==='Discover'||p==='New Releases'||p==='Your Radio'){pageTo('Home');setSection(old=>({name:p,request:old.request+1}))}else pageTo(p)
 }
 useEffect(()=>{
   if(page!=='Home')return
   const id=section.name==='Recent artists'?'home-recent-artists':section.name==='Discover'?'home-discover':section.name==='New Releases'?'home-new-releases':section.name==='Your Radio'?'home-radio':''
   const frame=requestAnimationFrame(()=>{if(id)document.getElementById(id)?.scrollIntoView({block:'start',behavior:reduce?'instant':'smooth'});else content.current?.scrollTo({top:0,behavior:reduce?'instant':'smooth'})})
   return()=>cancelAnimationFrame(frame)
 },[section,page,reduce])
 const pickCatalog=(kind:CatalogKind,ref:CatalogRef)=>{setCatalog({kind,ref});setCatalogArt(ref.artwork);navigate('Catalog')}
 const open=(t:Track,key='playing-art')=>{
   if(!expanded){opener.current=document.activeElement as HTMLElement;setPanel('queue')}
   setDetail(t.id===state.current?.id?null:t);setAnchor(key);setExpanded(true)
 }
 const expandSearch=()=>{pendingFocus.current=true;if(mini)call(()=>api?.setMode('full'));setSearchFocus(v=>v+1)}
 const act=send
 const toggleTrack=(t:Track)=>send(state.current?.id===t.id?'toggle':'playTrack',t)
 const play=(t:Track)=>toggleTrack(t)
 const radio=(v:'start'|'like'|'dislike'|'undo')=>call(()=>api?.radio(v))
 const switchMode=(m:Mode)=>call(()=>api?.setMode(m))
 useEffect(()=>api?.onFocusSearch?.(()=>{if(shell)expandSearch()}),[api,shell,mini])
 useEffect(()=>{
   const key=(e:KeyboardEvent)=>{
     if(!shell||e.defaultPrevented)return
     if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();expandSearch();return}
     if(e.key==='Escape'&&!state.fullscreen&&!document.fullscreenElement){if(expanded){e.preventDefault();closeExpanded()}else if(page!=='Home')navigate('Home')}
     if((e.target as HTMLElement).closest('input:not([type=range]),textarea,[contenteditable=true]'))return
     if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.code==='KeyL'&&state.current){e.preventDefault();if(!expanded)open(state.current);setPanel(panel==='lyrics'?null:'lyrics');return}
     if(e.altKey&&['ArrowRight','ArrowLeft'].includes(e.key)&&state.current){e.preventDefault();act('seek',state.position+(e.key==='ArrowRight'?10:-10));return}
     if((e.metaKey||e.ctrlKey)&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();act('volume',Math.max(0,Math.min(1,state.volume+(e.key==='ArrowUp'?.05:-.05))));return}
   }
   const space=(e:KeyboardEvent)=>{if(!shell||e.defaultPrevented||!state.current||(e.target as HTMLElement).closest('input:not([type=range]),textarea,[contenteditable=true]'))return;if(e.code==='Space'||e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat)act('toggle')}}
   window.addEventListener('keydown',space,true);window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',space,true);window.removeEventListener('keydown',key)}
 },[api,shell,mini,page,expanded,state.current,state.position,state.volume,state.streamingAvailable,state.fullscreen,panel])
 async function signIn(){
   if(!api)return
   const attempt=++loginAttempt.current
   setBusy(true);setWaiting(!preview);setAuthError('')
   try{
     await api.signIn()
     if(attempt!==loginAttempt.current)return
     const h=await api.getHome()
     if(attempt!==loginAttempt.current)return
     setHome(h)
     if(h.account.connected){pageTo('Home');setWaiting(false);setLocal(false)}
   }catch(e){
     if(attempt!==loginAttempt.current)return
     const m=toastText(e);setWaiting(false);setAuthError(m);if(shell)notify(m)
   }finally{if(attempt===loginAttempt.current)setBusy(false)}
 }
 async function handlePasskey(action:'start'|'complete'|'cancel'){
   if(!api)return
   const attempt=++loginAttempt.current
   setWaiting(false);setAuthError('');setBusy(false)
   if(action==='start')setPasskeyPending(true)
   if(action==='complete')setCompleting(true)
   try{
     const result=await (action==='start'?api.startPasskeySignIn():action==='complete'?api.completePasskeySignIn():api.cancelPasskeySignIn())
     if(attempt!==loginAttempt.current)return
     const current=await api.getHome()
     if(attempt!==loginAttempt.current)return
     setHome(current)
     const browser=current.account.browserSignIn||result?.browserSignIn
     setPasskeyPending(browser?.active??(action!=='cancel'&&!current.account.connected))
     if(action==='complete'&&current.account.connected&&!browser?.active){pageTo('Home');setLocal(false)}
     if(browser?.phase==='error')setAuthError(browser.message||'Sign-in could not be completed. Try again.')
     else if(action==='complete'&&!current.account.connected)setAuthError(browser?.message||'Finish signing in in Chrome before continuing.')
   }catch(error){
     if(attempt!==loginAttempt.current)return
     setAuthError(toastText(error))
     if(action==='start')setPasskeyPending(!!home.account.browserSignIn?.active)
   }finally{if(attempt===loginAttempt.current)setCompleting(false)}
 }
 const openAccount=()=>call(()=>api?.openAccount?.())
 const leaveSignIn=()=>{
   ++loginAttempt.current;setWaiting(false);setBusy(false);setAuthError('')
   if(api?.cancelSignIn)call(()=>api.cancelSignIn!())
 }
 const passkeyMessage=browserSignIn?.phase!=='error'&&browserSignIn?.message?browserSignIn.message:'Finish signing in in Chrome, then return here.'
 const authControls:AuthControls={passkeyMessage,busy:!api||!loaded||(!waiting&&busy),waiting,passkey,finishing,signin:signIn,start:()=>handlePasskey('start'),finish:()=>handlePasskey('complete'),cancelKey:()=>handlePasskey('cancel'),reopen:openAccount,cancel:leaveSignIn}
 const signError=authError||(browserSignIn?.phase==='error'?browserSignIn.message||'Sign-in could not be completed.':'')
 function choosePlaylist(p:Playlist,force=false){
   if(!force&&p.id===playlist?.id&&(page==='Playlist'||page==='Liked Songs')&&!playlistError&&songs.length){navigate('Playlist');return}
   setPlaylist(p);navigate('Playlist');setSongs(playlistCache.current.get(p.id)||[]);setPlaylistError('');waitPlaylist(true)
   const req=++playlistReq.current
   loadingPlaylist.current=p.id
   api?.getPlaylist(p.id,undefined,force).then(rows=>{
     if(req!==playlistReq.current)return
     rememberPlaylist(p.id,rows);setSongs(rows)
   }).catch(e=>{if(req===playlistReq.current)setPlaylistError(toastText(e))}).finally(()=>{
     if(req===playlistReq.current){loadingPlaylist.current=null;waitPlaylist(false)}
   })
 }
 function removePlaylistRow(id:string,track:Track){
   const owner=accountOwner.current,request=playlistReq.current
   const remove=(rows:Track[])=>{const at=rows.indexOf(track)>=0?rows.indexOf(track):rows.findIndex(t=>t.id===track.id);if(at<0)return rows;return [...rows.slice(0,at),...rows.slice(at+1)]}
   const before=playlistCache.current.get(id),after=before?remove(before):undefined
   if(after)rememberPlaylist(id,after)
   if(playlist?.id===id)setSongs(remove)
   setHome(h=>({...h,playlists:h.playlists.map(p=>p.id===id&&p.count!=null?{...p,count:Math.max(0,p.count-1)}:p)}))
   return()=>{if(owner!==accountOwner.current)return;if(before&&playlistCache.current.get(id)===after)rememberPlaylist(id,before);if(request===playlistReq.current&&playlist?.id===id&&before)setSongs(before);setHome(h=>({...h,playlists:h.playlists.map(p=>p.id===id&&p.count!=null?{...p,count:p.count+1}:p)}))}
 }
 const refreshLibrary=()=>call(()=>api?.refreshHome())
 function importFiles(){call(async()=>{await api?.importFiles();navigate('Local music')})}
 function historyImport(){call(async()=>{const r=await api?.importHistory();if(r)notify(r.message||('Imported '+r.imported+' entries · '+r.skipped+' skipped'))})}
 const localMode=()=>{setLocal(true);navigate('Local music')}
 const noticeNow=notice || (shell&&state.error!==ignoredError?state.error:'')
 const libraryRows=(tracks:Track[],queue=false)=> <TrackRows tracks={tracks} saved={state.library} act={act} open={open} play={play} queue={queue}/>
 function libraryPage(){
   if(page==='Catalog'&&catalog)return <Catalog key={catalog.kind+JSON.stringify(catalog.ref)} api={api} kind={catalog.kind} reference={catalog.ref} pick={pickCatalog} play={play} back={()=>navigate('Home')} notify={notify} onArtwork={setCatalogArt}/>
   if(page==='Stats')return <Stats key={home.account.handle||home.account.name} api={api} play={play} navigateCatalog={pickCatalog}/>
   if(page==='Home')return <HomeView pickCatalog={pickCatalog} api={api} pickPlaylist={choosePlaylist} home={home} go={navigate} open={open} play={play} refresh={refreshLibrary} radio={radio}/>
   if(page==='Your Radio')return <><div className="view-intro">Made for you</div><h1>Your Radio</h1><RadioSection home={home} radio={radio}/>{state.current&&home.radioActive&&<><SectionHead title="Current pick"/>{libraryRows([state.current])}</>}</>
   if(page==='Account')return <><div className="view-intro">Your music</div><h1>Account</h1><div className="account-card">{home.account.connected?<Avatar account={home.account} large/>:<Mark size={39}/>}<div><h2>{home.account.connected?(home.account.name||'Your account'):'Connect your account'}</h2>
       {home.account.connected&&[home.account.handle,home.account.email].filter(Boolean).length>0&&<p className="identity-details">{[home.account.handle,home.account.email].filter(Boolean).join(' · ')}</p>}
       <p role="status">{home.account.syncing?syncText(home.account):home.account.message||(home.account.connected?'Connected to YouTube Music':'Sign in to sync your music and playlists.')}</p>
       {home.account.syncing&&!!home.account.collectionErrors?.length&&<p>Could not load {home.account.collectionErrors.join(', ').toLowerCase()}.</p>}</div></div>
     {!home.account.connected&&<div className="account-auth">
      {passkey&&<p role="status">{passkeyMessage}</p>}{waiting&&<p role="status">Finish signing in in the YouTube Music window.</p>}
      <AuthButtons {...authControls}/>{signError&&<p role="alert">{signError}</p>}
     </div>}
     <div className="settings-list">{home.account.connected?<><button disabled={home.account.syncing} onClick={refreshLibrary}><RefreshCw/>{home.account.syncing?'Refreshing library…':'Refresh account library'}<ChevronRight/></button>
     {!preview&&<button onClick={openAccount}><ArrowUpRight/>Open account player<ChevronRight/></button>}<button onClick={historyImport}><Import/>Import listening history<ChevronRight/></button><button onClick={()=>call(async()=>{await api?.signOut();setLocal(false);navigate('Home')})}><ArrowRight/>Sign out<ChevronRight/></button></>:null}
     <button onClick={()=>call(async()=>{const result=await api?.enableAudio?.();if(result)notify(result.message)})}><AudioLines/>Music-reactive glass<ChevronRight/></button>
     <button onClick={()=>navigate('Local music')}><Music2/>Local music<ChevronRight/></button>
     <div className="effect-setting"><div><strong>Appearance</strong><small>Motion and glass effects in this app</small></div><GlassSelect label="Motion and glass effects" value={fullEffects?'full':'system'} onChange={value=>act('effects',value)} options={[{value:'system',label:'Follow Mac settings'},{value:'full',label:'Full glass and motion'}]}/></div>
     </div>{home.account.connected&&<FollowedArtists api={api} pick={pickCatalog}/>}</>
   if(page==='Playlists'||page==='Library')return <PlaylistLibrary api={api} playlists={home.playlists} account={home.account} pick={choosePlaylist} refresh={refreshLibrary} notify={notify}/>
   if(page==='Local music'){
     const files=state.library.filter(t=>t.source==='local')
     return <><div className="view-intro">On this Mac</div><div className="page-heading"><h1>Local music</h1><Btn title="Import audio files" className="soft-button" onClick={importFiles}><ArrowDownToLine size={14}/>Import audio</Btn></div>{files.length?libraryRows(files):<Empty title="No local music yet" label="Import audio files" action={importFiles}>Choose audio files from your Mac.</Empty>}</>
   }
   if((page==='Playlist'||page==='Liked Songs')&&playlist){
     const sleeve={id:playlist.id,title:playlist.title,artist:'',artwork:playlist.artwork||songs[0]?.artwork}
     const count=playlistWait?(songs.length?songs.length+' tracks shown · Loading…':'Loading tracks…'):songs.length+' '+(songs.length===1?'track':'tracks')
     return <><Btn title="Back to library" className="back-button" onClick={()=>navigate('Library')}><ArrowLeft size={16}/>Library</Btn>
       <div className="detail playlist-detail"><Cover track={sleeve} size={600}/><div><div className="view-intro">{playlist.id==='LM'?'Liked songs':'Playlist'}</div><h1>{playlist.title}</h1><p>{[playlist.artist,count].filter(Boolean).join(' · ')}</p><PlaylistSettings playlist={playlist} api={api} notify={notify} onChange={p=>setPlaylist(p)}/></div></div>
       {playlistError&&<Empty title="Could not load the complete playlist" action={()=>choosePlaylist(playlist)} label="Try again">{playlistError}</Empty>}
       {songs.length&&api?<PlaylistTracks query={playlistQuery} key={playlist.id} tracks={songs} saved={state.library} act={act} allowDates={!preview} incomplete={playlistWait||!!playlistError} subscribe={api.onPlaylistUpdate} id={playlist.id}
        load={sort=>api.getPlaylist(playlist.id,sort)} save={async (ids,visibleRows)=>{
          const groups=new Map<string,Track[]>();for(const track of songs){const group=groups.get(track.id)||[];group.push(track);groups.set(track.id,group)}
          const ordered=visibleRows||ids.flatMap(id=>groups.get(id)?.shift()||[])
          await api.orderPlaylist(playlist.id,ids,ordered)
          if(ordered.length===ids.length)rememberPlaylist(playlist.id,ordered)
          notify('Playlist order saved in this app')
        }}
        play={(tracks,index,partial)=>{if(partial)send('playTrack',{...tracks[index],playlistId:playlist.id});else call(()=>api.playPlaylist(playlist.id,tracks.map(t=>t.id),index,tracks))}}/>:!playlistWait&&!playlistError&&<Empty title="This playlist has no available tracks"/>}</>

   }
   const tracks=page==='New Releases'?home.releases:page==='Discover'?home.discover:page==='Queue'?state.queue:page==='Liked Songs'?home.liked:state.library
   return <><div className="view-intro">{page==='Discover'||page==='New Releases'?'Browse':'Your music'}</div><h1>{page}</h1>
   {tracks.length?(page==='Discover'||page==='New Releases'?<div className="all-sleeves"><Shelf tracks={tracks} prefix={page} open={open}/></div>:libraryRows(tracks,page==='Queue')):
    page==='Liked Songs'?<CollectionEmpty account={home.account} collection="Liked songs" title="No liked songs yet" retry={refreshLibrary}>Songs you like in YouTube Music appear here.</CollectionEmpty>:
    <Empty title={page==='Queue'?'Your queue is empty':page==='New Releases'?'No verified new releases':'No recommendations yet'}>{page==='Queue'?'Add a track from its detail page.':'Your YouTube Music selections appear here.'}</Empty>}</>
 }
 return <FullEffects.Provider value={fullEffects}><MotionConfig reducedMotion={fullEffects?'never':'user'}><LayoutGroup><TrackActionsProvider api={api} state={state} home={home} notify={notify} navigateSearch={query=>{expandSearch();setSearchSeed(s=>({query,id:s.id+1}))}} openTrack={open} navigateCatalog={pickCatalog} onPlaylistRemove={removePlaylistRow} onPlaylistChanged={id=>{if(playlist?.id===id){const rows=playlistCache.current.get(id);if(rows)setSongs(rows)}}}><div className={'music-app '+(mini?'compact ':'')+(immersive?'immersive-open ':'')+(preview?'design-preview ':'')+(fullEffects?'full-effects':'system-effects')}>
 <GlassLighting enabled={!reduce}/><OpticalDefs/><Opal palette={shell?palette:opal} reduce={reduce}/>
 {!loaded?<div className="signin" aria-label="Opening your music"><div className="sign-center"><div className="sign-lens"><LaunchLens/></div></div></div>:!shell?<SignIn controls={authControls} local={localMode} error={signError||(!shell?notice:'')}/>:mini?<Mini state={state} act={act} mode={switchMode} search={expandSearch} open={()=>{switchMode('full');if(state.current)open(state.current)}} preview={preview}/>:
 <><Rail page={page==='Home'?section.name:page} go={navigate} home={home} playlist={playlist} openPlaylist={choosePlaylist} preview={preview}/><div className={'browse-layer'+(expanded&&expandedTrack?' player-open':'')} aria-hidden={expanded&&expandedTrack?true:undefined} inert={!!(expanded&&expandedTrack)}>
 <main ref={content} className="canvas">
 <AnimatePresence initial={false} mode="wait" presenceAffectsLayout={false}><motion.div className="page" key={page+(page==='Playlist'||page==='Liked Songs'?playlist?.id:page==='Catalog'?catalog?.kind+JSON.stringify(catalog?.ref):'')} initial={{opacity:0,y:reduce?0:14}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:-8,transition:{duration:reduce?0:.12}}} transition={{duration:reduce?0:.28,ease:[.22,1,.36,1]}}>{libraryPage()}</motion.div></AnimatePresence></main>
 <Dock feedback={state.current?<TrackFeedback track={state.current} compact/>:null} state={state} act={act} go={navigate} mode={switchMode} fullscreen={()=>{if(state.current){setDetail(null);setPanel(null);setExpanded(true);setImmersive(true)}}} pick={()=>state.current&&open(state.current)} openQueue={()=>{if(state.current){open(state.current);setPanel('queue')}else navigate('Queue')}}/></div>
 <div className={'global-toolbar'+(expanded&&expandedTrack?' in-player':'')}>
 {!expanded&&preview&&<span className="preview-tag">Design preview</span>}
 <GlobalSearch playlistContext={!expanded&&(page==='Playlist'||page==='Liked Songs')} onPlaylistQuery={setPlaylistQuery} pickCatalog={pickCatalog} seed={searchSeed} choosePlaylist={choosePlaylist} api={api} home={home} library={state.library} playlistTracks={songs} input={searchInput} context={page+(expanded?'player':'')+(playlist?.id||'')} reduce={reduce} play={toggleTrack} queue={t=>{send('queueTrack',t);notify('Added to your queue')}}/>
 {!expanded&&<Btn title="Open queue" className="top-round" onClick={()=>navigate('Queue')}><ListMusic size={16}/></Btn>}</div>
 <AnimatePresence>{expanded&&expandedTrack&&<ExpandedPlayer immersiveRequested={immersive} onImmersive={setImmersive} navigateCatalog={pickCatalog} key="expanded" track={expandedTrack} state={state} api={api} panel={panel} onPanel={setPanel} shared={anchor} reduce={reduce} close={closeExpanded} act={act} play={toggleTrack}/>}</AnimatePresence></>}
 {noticeNow&&shell&&<div className="toast" role="status"><span>{noticeNow}</span><Btn title="Dismiss" onClick={()=>{notify('');setIgnored(state.error)}}><X size={14}/></Btn></div>}
 </div></TrackActionsProvider></LayoutGroup></MotionConfig></FullEffects.Provider>
}
async function start(){
 let api=window.music
 if(preview){const {createPreview}=await import('./prototype');api=createPreview()}
 else if(api)await import('../playback.js')
 createRoot(document.getElementById('root')!).render(<App api={api}/>)
}
void start()

