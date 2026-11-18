// Sign outside cloud-synced folders, which can attach Finder metadata during signing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const run = (bin,args)=>execFileSync(bin,args,{stdio:'inherit'});
const root = path.resolve(__dirname,'..');
const output = path.join(root,'release');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'music-sign-'));
const source = path.join(output,'mac-arm64','Opal Music Desktop.app');
const clean = path.join(temp,'Opal Music Desktop.app');
try {
  run('ditto',['--noextattr','--norsrc',source,clean]);
  run('codesign',['--force','--deep','--sign','-',clean]);
  run('codesign',['--verify','--deep','--strict',clean]);
  run('ditto',['-c','-k','--keepParent','--noextattr','--norsrc',clean,path.join(output,'Opal-Music-Desktop-mac-arm64.zip')]);
  run('ditto',['--noextattr','--norsrc',clean,source]);
} finally {fs.rmSync(temp,{recursive:true,force:true});}

