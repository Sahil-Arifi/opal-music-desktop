import {Repeat,Repeat1,Shuffle} from 'lucide-react'
import type {State} from './types'
import {Btn,type Act} from './ui'
import './playback-modes.css'

export function PlaybackModeButton({mode,state,act,size=16}:{mode:'shuffle'|'repeat';state:State;act:Act;size?:number}){
 if(mode==='shuffle'){
   const on=!!state.shuffle
   return <Btn className="playback-mode" title={on?'Turn shuffle off':'Turn shuffle on'} pressed={on} onClick={()=>act('shuffle',!on)}><Shuffle size={size}/></Btn>
 }
 const repeat=state.repeat||'off'
 const next=repeat==='off'?'all':repeat==='all'?'one':'off'
 const label=repeat==='off'?'Repeat off · Repeat all next':repeat==='all'?'Repeat all · Repeat one next':'Repeat one · Turn repeat off'
 const Icon=repeat==='one'?Repeat1:Repeat
 return <Btn className="playback-mode" title={label} pressed={repeat!=='off'} onClick={()=>act('repeat',next)}><Icon size={size}/></Btn>
}

