const {readPlaylistDetails}=require('./history-reader.cjs');
const {clickPoint}=require('./site-rating.cjs');
const {replaceCover}=require('./playlist-cover.cjs');
const origin='https://music.youtube.com';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const playlistId=value=>typeof value==='string' && /^[\w-]{2,128}$/.test(value);
const videoId=value=>typeof value==='string' && /^[\w-]{11}$/.test(value);
const urlFor=id=>origin+'/playlist?list='+encodeURIComponent(id);

// Each call performs at most one deliberate interaction with a rendered site
// control, allowing the caller to recheck account identity between clicks.
function playlistControl(action, value) {
  const visible=el=>!!el?.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]');
  const all=(scope,selector)=>[...scope.querySelectorAll(selector)].filter(visible);
  const label=el=>(el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g,' ');
  const buttons='button,a[role="button"],tp-yt-paper-button,tp-yt-paper-icon-button,[role="button"]';
  const click=el=>{
    if(!el || el.disabled || el.getAttribute('aria-disabled')==='true')return false;
    el.scrollIntoView({behavior:'instant',block:'nearest',inline:'nearest'});
    const rect=el.getBoundingClientRect();
    const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2);
    const target=document.elementFromPoint(x,y);
    return target && el.contains(target) ? {clickAt:{x,y}}:false;
  };
  const controls=(scope,re)=>all(scope,buttons).find(el=>re.test(label(el)));
  const form=all(document,'ytmusic-playlist-form,yt-create-playlist-dialog-form-view-model')[0];
  const dialog=form?.closest('[role="dialog"],yt-dialog-view-model,ytmusic-dialog,tp-yt-paper-dialog') || form;
  const nativeInput=form?.querySelector('#title-input input,.ytCreatePlaylistDialogFormViewModelTitleField input,.ytCreatePlaylistDialogFormViewModelTitleField textarea,input[aria-label*="itle"],input[maxlength="150"],input[type="text"],textarea[aria-label*="itle"]');
  const privacyForm=form?.querySelector('.privacy-dropdown,.privacy-status-menu,.ytCreatePlaylistDialogFormViewModelVisibilityField,select[aria-label*="rivacy"],[role="combobox"]');
  const readPrivacy=()=>{
    const selected=form?.getCurrentPrivacyStatus?.() || form?.polymerController?.getCurrentPrivacyStatus?.() ||
      privacyForm?.querySelector('[aria-selected="true"],[selected]')?.textContent || privacyForm?.selectedItemLabel ||
      privacyForm?.querySelector('button,[role="combobox"]')?.innerText || '';
    const choice=String(selected).trim().match(/^(?:PLAYLIST_PRIVACY_|PRIVATE_STATUS_|PRIVACY_STATUS_)?(PRIVATE|PUBLIC|UNLISTED)\b/i);
    return choice?.[1].toLowerCase() || '';
  };
  const content=document.querySelector('ytmusic-browse-response:not([hidden])') || document;
  const menuSelector='ytmusic-menu-service-item-renderer,ytmusic-menu-navigation-item-renderer,yt-list-item-view-model';
  if(action==='create'){
    return click(controls(document,/^(?:new|create(?: a)?(?: new)?) playlist$/i) ||
      all(document,'ytmusic-guide-entry-renderer,ytmusic-two-row-item-renderer,ytmusic-navigation-button-renderer').find(el=>/^(?:new|create) playlist$/i.test(label(el))));
  }
  if(action==='edit'){
    const header=content.querySelector('ytmusic-editable-playlist-detail-header-renderer,ytmusic-responsive-header-renderer,ytmusic-detail-header-renderer');
    const edit=header?.querySelector('.edit-playlist-button button,#edit-playlist-button button,button.edit-playlist-button');
    if(visible(edit))return click(edit);
    return !!header && click(controls(header,/^edit playlist$/i));
  }
  const description=form?.querySelector('.description-input textarea,textarea[aria-label*="escription"]');
  if(action==='form')return form ? {title:nativeInput?.value||'',description:description?.value||'',privacy:readPrivacy()}:null;
  if(action==='description'){
    if(!description || description.disabled)return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(description,value);
    description.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    description.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    return description.value===value;
  }
  if(action==='libraryState' || action==='libraryToggle'){
    const header=content.querySelector('ytmusic-responsive-header-renderer,ytmusic-detail-header-renderer');
    if(!header)return null;
    const candidates=all(header,'button,[role="button"]');
    const added=candidates.find(el=>/^(?:remove from (?:your )?library|saved to (?:your )?library|remove (?:this )?playlist from (?:your )?library)/i.test(label(el)));
    const available=candidates.find(el=>/^(?:add to (?:your )?library|save (?:this )?playlist(?: to (?:your )?library)?|save to (?:your )?library)$/i.test(label(el)));
    if(!added && !available)return null;
    return action==='libraryState'?{saved:!!added}:click(added || available);
  }
  if(action==='title'){
    if(!nativeInput || nativeInput.disabled)return false;
    const prototype=nativeInput.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(nativeInput,value);
    nativeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    nativeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    return nativeInput.value===value;
  }
  if(action==='openPrivacy'){
    if(!privacyForm)return false;
    return click(privacyForm.querySelector('#dropdown-menu,[role="combobox"],button') || privacyForm);
  }
  if(action==='choosePrivacy'){
    if(!form)return false;
    const choices=all(document,'tp-yt-paper-item,[role="option"],yt-list-item-view-model');
    return click(choices.find(el=>label(el).toLowerCase()===value) || choices.find(el=>label(el).toLowerCase().startsWith(value+' ')));
  }
  if(action==='submit')return !!form && click(controls(dialog,/^(create(?: playlist)?|save(?: changes)?|done)$/i));
  if(action==='rowMenu'){
    const rows=all(content,'ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer');
    const row=rows.find(el=>el.data?.playlistItemData?.videoId===value.id && (!value.entry || el.data.playlistItemData.playlistSetVideoId===value.entry));
    if(!row)return false;
    row.scrollIntoView({block:'center',behavior:'instant'});
    // A row contains Like and Dislike buttons before its action menu; a
    // comma-delimited selector returns the first match in DOM order.
    const menu=row.querySelector('ytmusic-menu-renderer');
    const button=menu?.querySelector('#button-shape button') || menu?.querySelector('button[aria-label="Action menu"]');
    const point=click(button);
    if(point)return point;
    const rect=row.getBoundingClientRect();
    return rect.width && rect.height?{hoverAt:{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}}:false;
  }
  if(action==='recordingIds'){
    const row=document.querySelector('ytmusic-player-queue-item[selected]');
    if(row?.data?.videoId!==value)return null;
    const wrapper=row.closest('ytmusic-playlist-panel-video-wrapper-renderer')?.data;
    const alternate=(wrapper?.counterpart||[]).map(item=>item.counterpartRenderer?.playlistPanelVideoRenderer?.videoId);
    return [...new Set([value,wrapper?.primaryRenderer?.playlistPanelVideoRenderer?.videoId,...alternate].filter(id=>/^[\w-]{11}$/.test(id||'')))];
  }
  if(action==='watchMenu'){
    const player=document.querySelector('#movie_player');
    if(player?.getVideoData?.()?.video_id!==value)return false;
    const mini=document.querySelector('ytmusic-miniplayer');
    const more=mini && all(mini,'button').find(el=>/^(?:more|more actions|action menu)$/i.test(label(el)));
    if(more){
      const target=document.querySelector('ytmusic-player-queue-item[selected]')?.data?.videoId;
      // The miniplayer can mount one frame before its selected queue row. Its
      // More button has no bound recording until the site installs the queue.
      if(target!==value)return false;
    }
    return click(more || document.querySelector('ytmusic-player-bar ytmusic-menu-renderer #button-shape button,ytmusic-player-bar ytmusic-menu-renderer #button-shape'));
  }
  if(action==='menu'){
    const re=value==='add'?/^(?:add|save) to (?:a )?playlist$/i:/^remove from (?:this )?playlist$/i;
    return click(all(document,menuSelector).find(el=>re.test(label(el))));
  }
  if(action==='destination'){
    const options=all(document,'ytmusic-add-to-playlist-renderer ytmusic-playlist-add-to-option-renderer');
    const target=options.find(el=>{
      const data=el.data||{}, commands=[data.addToPlaylistServiceEndpoint];
      for(let i=0;i<commands.length && i<48;i++){
        const command=commands[i];if(!command)continue;
        if([data.playlistId,command.playlistEditEndpoint?.playlistId,command.addToPlaylistServiceEndpoint?.playlistId,command.playlistId].includes(value))return true;
        commands.push(...(command.commandExecutorCommand?.commands || []),...(command.signalServiceEndpoint?.actions || []));
      }
      return false;
    });
    if(!target){options.at(-1)?.scrollIntoView({block:'end',behavior:'instant'});return false;}
    return click(target.querySelector('button'));
  }
  if(action==='writeStart')return performance.now();
  if(action==='writeComplete'){
    return performance.getEntriesByType('resource').some(entry=>{
      if(entry.startTime<value || entry.responseEnd<=0 || (entry.responseStatus && (entry.responseStatus<200 || entry.responseStatus>=300)))return false;
      return /\/(?:browse\/edit_playlist|playlist\/edit|music\/edit_playlist)$/.test(new URL(entry.name).pathname);
    });
  }
  if(action==='pickerClosed')return !all(document,'ytmusic-add-to-playlist-renderer').length;
  if(action==='rowGone'){
    return ![...content.querySelectorAll('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer')].some(el=>
      value.entry?el.data?.playlistItemData?.playlistSetVideoId===value.entry:el.data?.playlistItemData?.videoId===value.id);
  }
  return false;
}

async function playlistAction(session,action,payload={}) {
  const id=payload.id;
  if(!['create','edit','share','add','remove','save','unsave','cover'].includes(action))throw Error('Unknown playlist action.');
  if(action!=='create' && !playlistId(id))throw Error('Invalid YouTube Music playlist.');
  if(action==='share')return {ok:true,url:urlFor(id)};
  if(!session.profile.connected)throw Error('Sign in to your YouTube Music account first.');
  const title=typeof payload.title==='string'?payload.title.trim():null;
  const privacy=payload.privacy ?? (action==='create'?'private':undefined);
  if((action==='create' || title!==null) && (!title || title.length>150))throw Error('Use a playlist name of 1–150 characters.');
  if(privacy!==undefined && !['public','private','unlisted'].includes(privacy))throw Error('Unknown playlist privacy setting.');
  if(payload.description!==undefined && (typeof payload.description!=='string' || payload.description.length>5000))throw Error('Keep the playlist description under 5,001 characters.');
  if(action==='edit' && !title && !privacy && payload.description===undefined)throw Error('Choose a playlist name or privacy setting.');
  const ids=payload.videoIds;
  if(['add','remove'].includes(action) && (!Array.isArray(ids) || !ids.length || ids.length>100 || !ids.every(videoId)))throw Error('Choose valid YouTube Music recordings.');
  const epoch=session.epoch;
  const assertAccount=()=>{if(session.epoch!==epoch || session.closed || !session.profile.connected)throw Error('The selected YouTube Music account changed.');};
  const execute=async()=>{
    assertAccount();
    const win=session.window('playlist-action');
    win.webContents.setAudioMuted(true);
    const navigate=async url=>{assertAccount();await win.loadURL(url);assertAccount();};
    const call=async(fn,...args)=>{assertAccount();const result=await session.run(win,fn,...args);assertAccount();return result;};
    const control=async(name,arg)=>{
      const result=await call(playlistControl,name,arg);
      if(result?.hoverAt){assertAccount();win.webContents.sendInputEvent({type:'mouseMove',...result.hoverAt});return false;}
      if(!result?.clickAt)return result;
      assertAccount();return clickPoint(win.webContents,result.clickAt);
    };
    const poll=async(read,message)=>{
      for(let i=0;i<45;i++){
        const result=await read();
        if(result)return result;
        await wait(140);
      }
      throw Error(message);
    };
    const readRows=()=>session.collect(win,'tracks',true,true).then(result=>{assertAccount();return result.tracks;});
    const page=async(field,all=true)=>{
      const result=await session.collect(win,field,all,field==='tracks');
      assertAccount();return result[field];
    };
    const openForm=async(name)=>{
      await poll(()=>control(name),'YouTube Music did not offer this playlist action.');
      return poll(()=>control('form'),'YouTube Music did not open the playlist form.');
    };
    try{
      if(action==='cover')return await replaceCover({win,call,control,poll,navigate,url:urlFor(id),payload,assertAccount});
      if(action==='save' || action==='unsave'){
        const desired=action==='save';
        await navigate(urlFor(id));const state=await poll(()=>control('libraryState'),'YouTube Music did not offer a library control.');
        if(state.saved!==desired){
          await poll(()=>control('libraryToggle'),'YouTube Music did not offer changing this playlist.');
          await poll(async()=>(await control('libraryState'))?.saved===desired,'YouTube Music did not acknowledge the change.');
          await navigate(urlFor(id));await poll(async()=>(await control('libraryState'))?.saved===desired,'YouTube Music did not save the library change.');
        }
        return {ok:true,saved:desired,playlist:{...await call(readPlaylistDetails),id,saved:desired,source:'youtube'}};
      }
      if(action==='create' || action==='edit'){
        let before=[];
        if(action==='create'){
          await navigate(origin+'/library/playlists');before=await page('playlists');
        }else await navigate(urlFor(id));
        const initial=await openForm(action);
        if(title && initial.title!==title && !await control('title',title))throw Error('YouTube Music could not set the playlist name.');
        if(payload.description!==undefined && initial.description!==payload.description && !await control('description',payload.description))throw Error('YouTube Music could not set the playlist description.');
        if(privacy && initial.privacy!==privacy){
          if(!await control('openPrivacy'))throw Error('YouTube Music did not offer a privacy control.');
          await poll(()=>control('choosePrivacy',privacy),'YouTube Music did not offer this privacy setting.');
        }
        await poll(async()=>{
          const current=await control('form');
          return current && (!title || current.title===title) && (!privacy || current.privacy===privacy) && (payload.description===undefined || current.description===payload.description);
        },'YouTube Music did not confirm the form values.');
        if(!await control('submit'))throw Error('YouTube Music did not offer a save button.');
        await poll(async()=>!await control('form'),'YouTube Music did not confirm saving. Refresh the playlist before retrying.');
        let target=id;
        if(action==='create'){
          await navigate(origin+'/library/playlists');
          const existing=new Set(before.map(p=>p.id));
          const matches=(await page('playlists')).filter(p=>!existing.has(p.id) && p.title===title);
          if(matches.length!==1)throw Error('Could not identify the newly created playlist. Refresh your library before retrying.');
          target=matches[0].id;
        }
        await navigate(urlFor(target));
        const details=await poll(()=>call(readPlaylistDetails),'YouTube Music did not confirm the saved playlist.');
        if(title && details.title!==title)throw Error('YouTube Music did not confirm the new name. Refresh before retrying.');
        if((privacy && privacy!==details.privacy) || payload.description!==undefined){
          const saved=await openForm('edit');
          if(privacy && saved.privacy!==privacy)throw Error('YouTube Music did not confirm the saved privacy setting.');
          if(privacy)details.privacy=privacy;
          if(payload.description!==undefined){if(saved.description!==payload.description)throw Error('YouTube Music did not confirm the saved description.');details.description=saved.description;}
        }
        return {ok:true,playlist:{...details,source:'youtube'}};
      }
      // A complete verified playlist is usable as the before-state. The
      // post-write check always opens a fresh source document.
      const known=session.playlistCache.get(epoch+'/'+id+'/default');
      let rows;
      if(known?.expires>Date.now() && action==='add')rows=known.tracks;
      else{await navigate(urlFor(id));rows=await readRows();}
      let applied=0;
      for(const requested of ids){
        const matchesEntry=track=>!payload.playlistEntryId || track.playlistEntryId===payload.playlistEntryId;
        let allowed=new Set([requested]),row=rows.find(track=>allowed.has(track.id) && matchesEntry(track));
        if(action==='add' && row)continue;
        // Music can store the catalog audio recording after an official music
        // video is added. Only accept alternatives named by the selected row.
        let onWatch=false;
        if(action==='add' || !row){
          await navigate(origin+'/watch?v='+requested);onWatch=true;
          const related=await poll(()=>control('recordingIds',requested),'YouTube Music did not identify the selected recording.');
          allowed=new Set(related);row=rows.find(track=>allowed.has(track.id) && matchesEntry(track));
          if(action==='add' && row)continue;
        }
        if(action==='remove' && !row)throw Error('The requested song is no longer in this playlist.');
        const previous=rows.filter(t=>allowed.has(t.id)).length;
        try{
          let started;
          if(action==='remove'){
            if(onWatch){await navigate(urlFor(id));await readRows();}
            const occurrence={id:row.id,entry:row.playlistEntryId};
            await poll(()=>control('rowMenu',occurrence),'YouTube Music did not offer this song’s menu.');
            started=await control('writeStart');
            await poll(()=>control('menu','remove'),'YouTube Music did not offer removal from this playlist.');
            await poll(()=>control('rowGone',occurrence),'YouTube Music did not acknowledge removal. Refresh before retrying.');
          }else{
            let opened=false;
            for(let attempt=0;attempt<3 && !opened;attempt++){
              await poll(()=>control('watchMenu',requested),'YouTube Music did not offer this recording’s menu.');
              for(let i=0;i<10 && !opened;i++){await wait(110);opened=await control('menu','add');}
            }
            if(!opened)throw Error('YouTube Music did not offer Save to playlist.');
            started=await control('writeStart');
            await poll(()=>control('destination',id),'YouTube Music did not offer this playlist as a destination.');
            await poll(()=>control('pickerClosed'),'YouTube Music did not acknowledge the selection. Refresh before retrying.');
          }
          if(typeof started==='number')await poll(()=>control('writeComplete',started),'YouTube Music did not finish saving the playlist change.');
          await navigate(urlFor(id));rows=await readRows();
          if(rows.filter(t=>allowed.has(t.id)).length!==previous+(action==='remove'?-1:1))throw Error('YouTube Music did not confirm the change. Refresh before retrying.');
          applied++;
        }catch(error){
          if(applied)throw Error('YouTube Music confirmed '+applied+' playlist change(s). '+error.message);
          throw error;
        }
      }
      const details=await call(readPlaylistDetails);
      return {ok:true,...(details?{playlist:{...details,count:rows.length,source:'youtube'}}:{})};
    }finally{
      if(epoch===session.epoch)session.playlistCache.clear();
      if(!win.isDestroyed())win.destroy();
    }
  };
  const result=(session.playlistMutation || Promise.resolve()).then(execute);
  session.playlistMutation=result.catch(()=>{});
  return result;
}
module.exports={playlistAction,playlistControl};

