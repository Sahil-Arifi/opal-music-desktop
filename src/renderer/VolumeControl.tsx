import {Volume1,Volume2,VolumeX} from 'lucide-react'
import {Btn,Range,type Act} from './ui'
import './volume-control.css'

export function VolumeControl({value,act,size=16}:{value:number;act:Act;size?:number}){
 const muted=value===0,Icon=muted?VolumeX:value<.5?Volume1:Volume2
 return <><Btn title={muted?'Unmute':'Mute'} pressed={muted} className="volume-toggle" onClick={()=>act('mute')}><Icon size={size} aria-hidden="true"/></Btn>
 <Range label="Volume" max={1} step={.01} value={value} change={level=>act('volume',level)}/></>
}

