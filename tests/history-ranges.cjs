const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readHistory}=require('../src/main/history-reader.cjs');
function play(heading){
 const row={data:{playlistItemData:{videoId:'abcdefghijk'},title:{runs:[{text:'Luna'}]}},querySelector:()=>null,closest:()=>({data:{title:{simpleText:heading}}})};
 const document={querySelector:()=>({querySelectorAll:()=>[row]})};
 return vm.runInNewContext('('+readHistory.toString()+')(stamp)',{stamp:new Date(2026,10,12,14).getTime(),document,location:{pathname:'/history'},Date}).history[0];
}
test('history interprets source calendar ranges without assigning an invented date or time',()=>{
 const last=play('Last month');assert.equal(last.playedRange.from,'2026-10-01');assert.equal(last.playedRange.to,'2026-10-31');assert.equal(last.playedOn,undefined);assert.equal(last.playedAt,undefined);
 const recent=play('Last 7 days');assert.equal(recent.playedRange.from,'2026-11-06');assert.equal(recent.playedRange.to,'2026-11-12');
 const named=play('September 2026');assert.equal(named.playedRange.from,'2026-09-01');assert.equal(named.playedRange.to,'2026-09-30');
 assert.equal(play('Earlier').playedRange,undefined);assert.equal(play('Today').playedOn,'2026-11-12');
});

