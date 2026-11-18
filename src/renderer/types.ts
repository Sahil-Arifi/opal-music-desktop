export type CatalogKind='artist'|'album'|'song'
export type ReleaseType='album'|'single'|'ep'
export type CatalogRef={releaseType?:ReleaseType;id?:string;title?:string;artist?:string;artwork?:string}
export type CatalogCard=CatalogRef&{kind:CatalogKind;id:string;title:string;year?:string}
export type Artist={id:string;title:string;artwork?:string}
export type CatalogPage={releaseType?:ReleaseType;kind:CatalogKind;id:string;title:string;artist?:string;artwork?:string;description?:string;audience?:string;followed?:boolean;year?:string;tracks:Track[];albums:CatalogCard[];singles:CatalogCard[];artists:CatalogCard[];playlists:Playlist[]}
export type PlayContext={releaseType?:ReleaseType;kind:'album'|'playlist';id:string;title:string;artist?:string;artwork?:string}
export type Track = { releaseType?:ReleaseType; playContext?:PlayContext; id:string;title:string;artist:string;artwork?:string;duration:number;playCountLabel?:string;album?:string;albumId?:string;channelId?:string;playlistId?:string;mediaType?:'song'|'video';source:'youtube'|'local';url?:string }
export type Playlist={description?:string;saved?:boolean;id:string;title:string;artist?:string;artwork?:string;mosaic?:string[];count?:number;countSource?:'youtube'|'music';owned?:boolean;privacy?:'public'|'unlisted'|'private'}
export type DiscoverySection={id:string;title:string;tracks:Track[];playlists?:Playlist[];url?:string}
export type SearchResults={songs:Track[];artists:CatalogCard[];albums:CatalogCard[];playlists:Playlist[]}
export type SearchRecent={kind:'catalog';card:CatalogCard}|{kind:'track';track:Track}|{kind:'playlist';playlist:Playlist}|{kind:'query';query:string}
export type StatsPeriod='week'|'month'
export type ListeningStats={time?:{measuredSeconds:number;measuredPlays:number;estimatedSeconds:number;estimatedPlays:number;unknownPlays:number};period:StatsPeriod;totals:{plays:number;seconds:number;artists:number;songs:number;albums:number};artists:{id:string;name:string;artwork?:string;plays:number;seconds:number;listeningSeconds?:number;estimatedSeconds?:number}[];songs:(Track&{plays:number;seconds:number})[];albums:{id:string;name:string;artist:string;artwork?:string;plays:number;seconds:number;listeningSeconds?:number;estimatedSeconds?:number}[];coverage:{accountEntries?:number;from?:string;to?:string;scope:string;untimedPlays:number;loading?:boolean}}
export type PlaylistAction='create'|'edit'|'share'|'add'|'remove'|'save'|'unsave'
export type PlaylistActionPayload={tracks?:Track[];description?:string;id?:string;title?:string;privacy?:'public'|'unlisted'|'private';videoIds?:string[]}
export type Mode='mini'|'full'
export type RepeatMode='off'|'all'|'one'
export type Energy={bass:number;mid:number;treble:number}
export type LyricWord={text:string;start:number;end?:number}
export type LyricsResult={lines:{time:number;text:string;adlibs?:string[];words?:LyricWord[];backing?:{text:string;start:number;end?:number;words?:LyricWord[]}[]}[];plain?:string;source?:string;synced:boolean;instrumental?:boolean;error?:string}
export type BrowserSignIn={active:boolean;phase:'idle'|'opening'|'waiting'|'finishing'|'complete'|'error';message?:string}
export type Account={id?:string;restoring?:boolean;identityChecked?:boolean;configured:boolean;connected:boolean;name:string;message?:string;syncing?:boolean;syncStage?:string;collectionErrors?:string[];avatar?:string;email?:string;handle?:string;browserSignIn?:BrowserSignIn}
export type Home={recentArtists?:Artist[];recentItems?:((Track&{kind:'song'})|(Playlist&{kind:'playlist';track?:Track})|(CatalogCard&{kind:'album';track?:Track}))[];account:Account;recent:Track[];liked:Track[];playlists:Playlist[];releases:Track[];discover:Track[];releaseLabel:string;radioActive:boolean;historyAvailable:boolean}
export type State={shuffle?:boolean;repeat?:RepeatMode;currentRating?:'like'|'dislike'|'none';disliked?:string[];fullscreen?:boolean;current:Track|null;playing:boolean;position:number;duration:number;volume:number;queue:Track[];serviceQueue?:Track[];queueCategories?:{id:string;title:string;selected:boolean}[];playbackMode?:'song'|'video';videoAvailable?:boolean;library:Track[];loading:boolean;error:string;pinned?:boolean;streamingAvailable?:boolean;effects?:'system'|'full'}
export type Command='videoOnly'|'mute'|'shuffle'|'repeat'|'playTrack'|'queueTrack'|'playNext'|'playQueue'|'saveTrack'|'removeSaved'|'removeQueued'|'removeQueue'|'toggle'|'next'|'previous'|'seek'|'volume'|'pin'|'effects'|'fullscreen'|'rateTrack'
export type Desktop={
 onProgress?(cb:(progress:{id:string|null;position:number;duration:number})=>void):()=>void
 onExitCinema?(callback:()=>void):()=>void;getState():Promise<State>;onState(cb:(s:State)=>void):()=>void;getHome():Promise<Home>;onHome(cb:(h:Home)=>void):()=>void
 getMode():Promise<Mode>;setMode(mode:Mode):Promise<void>;onMode(cb:(m:Mode)=>void):()=>void
 onEnergy(cb:(v:Energy)=>void):()=>void;onFocusSearch?(cb:()=>void):()=>void
 command(name:Command,value?:unknown):Promise<void>;signIn():Promise<void>;startPasskeySignIn():Promise<Account>;completePasskeySignIn():Promise<Account>;cancelPasskeySignIn():Promise<Account>;signOut():Promise<void>;openAccount?():Promise<void>;cancelSignIn?():Promise<void>;refreshHome():Promise<void>
 getPlaylist(id:string,sort?:'default'|'newest'|'oldest',refresh?:boolean):Promise<Track[]>;playSequence?(tracks:Track[],index:number):Promise<void>;artistTopSongs?(ref:CatalogRef):Promise<Track[]>;orderPlaylist(id:string,ids:string[],view?:Track[]):Promise<void>;playPlaylist(id:string,ids:string[],index:number,view?:Track[]):Promise<void>;radio(vote:'start'|'like'|'dislike'|'undo'):Promise<void>;importHistory():Promise<void|{imported:number;skipped:number;message?:string}>;importFiles():Promise<void>
 onPlaylistUpdate(cb:(update:{id:string;sort:'default'|'newest'|'oldest';tracks:Track[];complete:boolean})=>void):()=>void
 search(query:string):Promise<Track[]>;searchCatalog?(query:string):Promise<SearchResults>
 lyrics(track:Track):Promise<LyricsResult>
 discovery(refresh?:boolean,sectionId?:string):Promise<DiscoverySection[]>;stats(period:StatsPeriod,refresh?:boolean):Promise<ListeningStats>
 onStats(cb:(report:ListeningStats)=>void):()=>void
 recentSearches():Promise<SearchRecent[]>;removeSearch?(item:SearchRecent):Promise<void>;rememberSearch(item:SearchRecent):Promise<void>
 choosePlaylistCover?(id:string):Promise<Playlist|null>
 playlistDetails(id:string):Promise<Playlist>;playlistAction(action:PlaylistAction,payload:PlaylistActionPayload):Promise<{ok:true;playlist?:Playlist;url?:string}>
 orderQueue(indices:number[],keys:string[]):Promise<void>;queueCategory(id:string):Promise<void>
 setPlaybackMode(mode:'song'|'video'):Promise<{mode:'song'|'video';videoAvailable:boolean}>;setVideoBounds(bounds:{x:number;y:number;width:number;height:number;presentation?:'cinema'|'embedded'}|null):Promise<void>
 catalog?(kind:CatalogKind,ref:CatalogRef):Promise<CatalogPage>;artistFollow?(id:string,enabled:boolean):Promise<{followed:boolean}>;followedArtists?():Promise<Artist[]>
 enableAudio?():Promise<{ok:boolean;message:string}>
 radioFromTrack(track:Track):Promise<void>
}
declare global { interface Window{music?:Desktop;prism?:Desktop} }
export const blankHome:Home={account:{configured:false,connected:false,name:''},recent:[],liked:[],playlists:[],releases:[],discover:[],releaseLabel:'New from artists you follow',radioActive:false,historyAvailable:false}
export const blankState:State={shuffle:false,repeat:'off',current:null,playing:false,position:0,duration:0,volume:.7,queue:[],library:[],loading:false,error:'',pinned:false,effects:'full'}
export const stamp=(seconds:number)=>Number.isFinite(seconds)?Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'):'0:00'

export function artURL(src?:string,size?:number){
 if(!src)return ''
 try{
  const url=new URL(src)
  if(url.protocol==='https:' && /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname)){
   if(size && Number.isFinite(size) && size>0){
    const target=Math.min(1600,Math.max(1,Math.round(size)))
    if(/(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(url.hostname)){
     // Resize only a recognized Google image-options suffix. Image identifiers
     // may themselves contain hyphens; the '=' or complete path segment matters.
     url.pathname=url.pathname.replace(/([=/])((?:(?:c|p|d|k|no|v\d+)-)*)(?:w(\d+)-h(\d+)|s(\d+))(?=(?:-[\w-]+)?(?:\/[^/]+)?$)/,
      (original,separator,prefix,w,h,s)=>{
       if(s)return Number(s)>0 && Number(s)<target ? separator+prefix+'s'+target : original
       const width=Number(w),height=Number(h)
       if(!width || !height || Math.max(width,height)>=target)return original
       const factor=target/Math.max(width,height)
       return separator+prefix+'w'+Math.max(1,Math.round(width*factor))+'-h'+Math.max(1,Math.round(height*factor))
      })
    }else if(target>480 && !url.search && /^\/vi(?:_webp)?\/[\w-]{11}\/(?:default|mqdefault|hqdefault|sddefault)\.(?:jpg|webp)$/.test(url.pathname)){
     // The same video's published high-resolution still. Signed/timed/cropped
     // images retain their original resource, and Cover retries it on failure.
     url.pathname=url.pathname.replace(/\/[^/.]+\.(jpg|webp)$/, '/maxresdefault.$1')
    }
   }
   return '/artwork?url='+encodeURIComponent(url.href)
  }
 }catch{}
 return src
}

export const releaseLabel=(type?:ReleaseType)=>type==='single'?'Single':type==='ep'?'EP':type==='album'?'Album':'Release'

