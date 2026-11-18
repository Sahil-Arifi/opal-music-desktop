const test=require('node:test'),assert=require('node:assert/strict');
const {recordingKey,mergeRecordingVariants}=require('../src/main/recording.cjs');
const song={source:'youtube',id:'abcdefghijk',title:'Yale',artist:'Ken Carson'};
test('song, official audio and official video are one recording without merging remixes',()=>{
 const video={...song,id:'0123456789a',title:'Ken Carson - Yale (Official Music Video)'};
 const bare={...video,title:'Yale - Official Music Video'};
 const remix={...song,id:'0123456789b',title:'Yale (Remix)'};
 for(const alt of [video,bare])assert.equal(recordingKey(alt),recordingKey(song));
 assert.notEqual(recordingKey(remix),recordingKey(song));
 assert.deepEqual(mergeRecordingVariants([video,bare,remix],song),[remix]);
 assert.deepEqual(mergeRecordingVariants([song,video,song]),[song,song]);
 assert.deepEqual(mergeRecordingVariants([song,video,remix],song),[remix]);
 const local={...song,source:'local',id:'local-a'};
 assert.deepEqual(mergeRecordingVariants([local,{...local,id:'local-b'}]),[local,{...local,id:'local-b'}]);
});

test('reordered collaborator credits merge a song and video without merging a remix',()=>{
 const a={source:'youtube',id:'abcdefghijk',title:'Party At My Place',artist:'xaviersobased, Skrillex & Dylan Brady'};
 const b={...a,id:'lmnopqrstuv',title:'Party At My Place (Official Video)',artist:'Skrillex, xaviersobased & Dylan Brady'};
 assert.equal(recordingKey(a),recordingKey(b));assert.deepEqual(mergeRecordingVariants([b],a),[]);
 assert.notEqual(recordingKey({...b,title:b.title+' (Remix)'}),recordingKey(a));
});

