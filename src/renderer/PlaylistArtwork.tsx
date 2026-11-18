import {useState} from 'react'
import {Disc3,Headphones,Layers3,ListMusic,Music2,Waves} from 'lucide-react'
import {artURL,type Playlist} from './types'
import './playlist-artwork.css'

const glyphs=[ListMusic,Disc3,Layers3,Headphones,Music2,Waves]
function PlaylistImage({id,src,mosaic=[]}:{id:string;src?:string;mosaic?:string[]}){
 const [failed,setFailed]=useState<string[]>([])
 const markFailed=(url:string)=>setFailed(prev=>prev.includes(url)?prev:[...prev,url])
 const source=artURL(src,640)
 if(source&&!failed.includes(source))return <img src={source} alt="" draggable="false" onError={()=>markFailed(source)}/>
 const tiles=[...new Set(mosaic.filter(Boolean).map(url=>artURL(url,300)))].filter(url=>!failed.includes(url)).slice(0,4)
 if(tiles.length===1)return <img src={tiles[0]} alt="" draggable="false" onError={()=>markFailed(tiles[0])}/>
 if(tiles.length)return <span className={'playlist-art-mosaic tiles-'+tiles.length}>{tiles.map(url=><img key={url} src={url} alt="" draggable="false" onError={()=>markFailed(url)}/>)}</span>
 let seed=0;for(const char of id)seed=(Math.imul(seed,31)+char.charCodeAt(0))>>>0
 const hue=seed%360,Icon=glyphs[seed%glyphs.length]
 return <span className="playlist-art-glyph" aria-hidden="true" style={{backgroundImage:'linear-gradient(140deg,hsl('+hue+' 30% 79%),hsl('+((hue+24)%360)+' 23% 58%))'}}><Icon strokeWidth={1.05}/></span>
}
export function PlaylistArtwork({playlist}:{playlist:Playlist}){
 return <span className="collection-art"><PlaylistImage key={playlist.id} id={playlist.id} src={playlist.artwork} mosaic={playlist.mosaic}/></span>
}

