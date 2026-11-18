const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

test('desktop preload owns Space before focused button defaults while text entry remains editable',()=>{
 const events=new Map(),calls=[];
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/preload.cjs'),'utf8'),{
   process:{isMainFrame:true},location:{href:'http://127.0.0.1:1234/'},window:{addEventListener:(name,fn,capture)=>{assert.equal(capture,true);events.set(name,fn);}},
   require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve();}}}),
 });
 const key=events.get('keydown');let prevented=0,stopped=0;
 const event={code:'Space',key:' ',target:{closest:()=>null},preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++};
 key(event);assert.deepEqual(calls,[['music:command','toggle']]);assert.equal(prevented,1);assert.equal(stopped,1);
 key({...event,repeat:true});assert.equal(calls.length,1);
 key({...event,target:{closest:()=>({tagName:'INPUT'})}});assert.equal(calls.length,1);
 key({...event,metaKey:true});assert.equal(calls.length,1);
});

