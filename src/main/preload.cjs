const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame&&location.href.startsWith('http://127.0.0.1:')){
  const invoke=(name,...args)=>ipcRenderer.invoke('music:'+name,...args);
  // Own unmodified Space before a focused transport button can activate itself.
  window.addEventListener('keydown',event=>{
    if((event.code!=='Space'&&event.key!==' ')||event.metaKey||event.ctrlKey||event.altKey)return;
    if(event.target?.closest?.('input:not([type=range]),textarea,[contenteditable=true]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat)void invoke('command','toggle').catch(()=>{});
  },true);
  const listen=(name,callback)=>{
    const listener=(_event,value)=>callback(value);
    ipcRenderer.on('music:'+name,listener);
    return ()=>ipcRenderer.removeListener('music:'+name,listener);
  };
  contextBridge.exposeInMainWorld('music',{
    getState:()=>invoke('state'),onExitCinema:cb=>listen('exitCinema',cb),onState:cb=>listen('state',cb),onProgress:cb=>listen('progress',cb),
    getHome:()=>invoke('home'),onHome:cb=>listen('home',cb),
    searchCatalog:q=>invoke('searchCatalog',q),search:q=>invoke('search',q),getPlaylist:(id,sort,refresh)=>invoke('playlist',id,sort,refresh),
    playSequence:(tracks,index)=>invoke('playSequence',tracks,index),artistTopSongs:ref=>invoke('artistTopSongs',ref),
    orderPlaylist:(id,ids,view)=>invoke('orderPlaylist',id,ids,view),playPlaylist:(id,ids,index,view)=>invoke('playPlaylist',id,ids,index,view),
    onPlaylistUpdate:cb=>listen('playlistUpdate',cb),
    lyrics:track=>invoke('lyrics',track),
    catalog:(kind,ref)=>invoke('catalog',kind,ref),artistFollow:(id,enabled)=>invoke('artistFollow',id,enabled),followedArtists:()=>invoke('followedArtists'),
    discovery:(refresh,sectionId)=>invoke('discovery',refresh,sectionId),stats:(period,refresh)=>invoke('stats',period,refresh),
    onStats:cb=>listen('stats',cb),
    recentSearches:()=>invoke('recentSearches'),removeSearch:item=>invoke('removeSearch',item),rememberSearch:item=>invoke('rememberSearch',item),
    choosePlaylistCover:id=>invoke('choosePlaylistCover',id),
    playlistDetails:id=>invoke('playlistDetails',id),playlistAction:(action,payload)=>invoke('playlistAction',action,payload),
    orderQueue:(indices,keys)=>invoke('orderQueue',indices,keys),queueCategory:id=>invoke('queueCategory',id),
    setPlaybackMode:mode=>invoke('setPlaybackMode',mode),setVideoBounds:bounds=>invoke('setVideoBounds',bounds),
    radioFromTrack:track=>invoke('radioFromTrack',track),
    command:(name,value)=>invoke('command',name,value),
    setMode:mode=>invoke('mode',mode),getMode:()=>invoke('getMode'),onMode:cb=>listen('mode',cb),
    onEnergy:cb=>listen('energy',cb),onFocusSearch:cb=>listen('searchFocus',cb),
    onEngine:cb=>listen('engine',cb),reportPlayer:(id,data)=>invoke('report',id,data),
    reportEnergy:bands=>ipcRenderer.send('music:bands',bands),
    signIn:()=>invoke('signIn'),signOut:()=>invoke('signOut'),
    startPasskeySignIn:()=>invoke('passkeyStart'),completePasskeySignIn:()=>invoke('passkeyComplete'),cancelPasskeySignIn:()=>invoke('passkeyCancel'),openAccount:()=>invoke('openAccount'),cancelSignIn:()=>invoke('cancelSignIn'),
    refreshHome:()=>invoke('refreshHome'),importHistory:()=>invoke('importHistory'),
    importFiles:()=>invoke('import'),radio:vote=>invoke('radio',vote),
    openTrack:track=>invoke('openTrack',track),enableAudio:()=>invoke('enableAudio'),
  });
}

