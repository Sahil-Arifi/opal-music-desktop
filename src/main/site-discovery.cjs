// Read shelf labels and destinations that YouTube Music exposes in its Home view.
function discoveryShelves(advance=false){
  const main=document.querySelector('ytmusic-browse-response:not([hidden])') || document;
  const shelves=[...main.querySelectorAll('ytmusic-carousel-shelf-renderer,ytmusic-shelf-renderer')];
  const data=shelves.map((shelf,index)=>{
    const header=shelf.querySelector('ytmusic-carousel-shelf-basic-header-renderer,ytmusic-shelf-basic-header-renderer,#header');
    const runs=header?.data?.title?.runs || shelf.data?.title?.runs || [];
    const title=runs.map(r=>r.text).join('').trim() || header?.querySelector('h2,#title')?.textContent.trim() || '';
    const more=header?.data?.moreContentButton?.buttonRenderer?.navigationEndpoint;
    const endpoint=runs[0]?.navigationEndpoint?.browseEndpoint || more?.browseEndpoint;
    const collection=more?.watchPlaylistEndpoint?.playlistId || more?.watchEndpoint?.playlistId;
    const href=header?.querySelector('a[href^="/browse/"],a[href^="/playlist?"]')?.href;
    const url=href || (endpoint?.browseId?'https://music.youtube.com/browse/'+encodeURIComponent(endpoint.browseId):collection?'https://music.youtube.com/playlist?list='+encodeURIComponent(collection):undefined);
    return {index,title,url};
  });
  if(advance){
    const more=main.querySelector('ytmusic-section-list-renderer > #continuations yt-next-continuation,ytmusic-section-list-renderer > #contents > ytmusic-continuation-item-renderer');
    (more || shelves.at(-1))?.scrollIntoView({behavior:'instant',block:'end'});
  }
  return data;
}
module.exports={discoveryShelves};

// Keep a per-shelf set of choices seen this session. On a refresh, favor real
// items outside the current page, then cycle through the same source catalog
// only when its unseen supply is exhausted.
function nextShelfBatch(incoming,visible,seen,limit=18){
  const distinct=[...new Map(incoming.filter(item=>item?.id).map(item=>[item.id,item])).values()];
  const current=new Set(visible.map(item=>item.id));
  for(const id of current)seen.add(id);
  let fresh=distinct.filter(item=>!seen.has(item.id));
  const other=distinct.filter(item=>!current.has(item.id));
  if(!fresh.length && other.length){
    seen.clear();for(const id of current)seen.add(id);
    fresh=other;
  }
  const taken=new Set();
  const batch=[...fresh,...other,...distinct].filter(item=>!taken.has(item.id) && taken.add(item.id)).slice(0,limit);
  for(const item of batch)seen.add(item.id);
  return batch;
}
module.exports.nextShelfBatch=nextShelfBatch;

