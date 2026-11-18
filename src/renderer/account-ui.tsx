import {useState} from 'react'
import {UserRound} from 'lucide-react'
import {artURL,type Account} from './types'
import {Empty} from './ui'

export type Collection='Recently played'|'Liked songs'|'Library songs'|'Playlists'|'Subscriptions'
export function Avatar({account,large=false}:{account:Account;large?:boolean}){
 const [failed,setFailed]=useState('')
 const image=account.connected?artURL(account.avatar):''
 const initial=(account.name||account.handle?.replace(/^@/,'')||account.email||'').trim()[0]
 return <span className={'avatar'+(large?' large':'')}>{image&&failed!==image
  ?<img src={image} onError={()=>setFailed(image)} alt=""/>
  :initial&&account.connected?initial.toUpperCase():<UserRound size={large?23:15}/>}</span>
}
export function syncText(account:Account){
 return account.syncStage?'Syncing '+account.syncStage.toLowerCase()+'…':'Syncing your music library…'
}
export function collectionStatus(account:Account,collection:Collection){
 if(!account.connected)return 'offline'
 if(account.collectionErrors?.includes(collection))return 'error'
 if(account.syncing)return 'syncing'
 return 'ready'
}
export function CollectionEmpty({account,collection,title,children,retry}:{account:Account;collection:Collection;title:string;children:React.ReactNode;retry:()=>void}){
 const status=collectionStatus(account,collection)
 if(status==='error')return <Empty title={'Could not load '+collection.toLowerCase()} action={account.syncing?undefined:retry} label="Retry sync">Your account is connected. {account.syncing?syncText(account):'Refresh to try this collection again.'}</Empty>
 if(status==='syncing')return <Empty title={'Loading '+collection.toLowerCase()+'…'}>{syncText(account)}</Empty>
 return <Empty title={title}>{children}</Empty>
}

