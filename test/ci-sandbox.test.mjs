import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {runInSandbox,verifySandbox} from '../scripts/ci-sandbox.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function running(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dsh-ci-controller-'));
 const env={PATH:dirname(process.execPath)+':'+(process.env.PATH??'/usr/bin:/bin'),HOME:root,USERPROFILE:root,XDG_CONFIG_HOME:root,DSH_HOME:join(root,'dsh'),TMPDIR:root,NODE_OPTIONS:'--max-old-space-size=128'};
 return{root,env,cwd:root};
}
const grandchild=`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send('ready');`;
function program(file,mode){return `
 const {spawn,execFile}=require('node:child_process');
 const {writeFileSync}=require('node:fs');
 process.on('SIGTERM',()=>{});
 const child=spawn(process.execPath,['--max-old-space-size=128','-e',${JSON.stringify(grandchild)}],{stdio:${JSON.stringify(mode==='exit-pipes'?['ignore','inherit','inherit','ipc']:['ignore','ignore','ignore','ipc'])}});
 const record=(ready,pgid)=>writeFileSync(${JSON.stringify(file)},JSON.stringify({parent:process.pid,grandchild:child.pid,pgid,ready}));
 record(false);
 child.once('message',()=>execFile('python3',['-I','-S','-c','import os;print(os.getpgrp())'],{timeout:1000,maxBuffer:1024},(error,stdout)=>{
  if(error)throw error;record(true,Number(stdout.trim()));
  child.disconnect();
  ${mode.startsWith('exit')?'process.exit(0);':mode==='overflow'?"setInterval(()=>process.stdout.write('x'.repeat(2048)),1);":"setInterval(()=>{},1000);"}
 }));`;}
async function ownedProcesses(file){try{return JSON.parse(await readFile(file,'utf8'));}catch{return {};}}
async function cleanup(file){const pids=await ownedProcesses(file);for(const pid of [pids.parent,pids.grandchild].filter(Number.isSafeInteger))if(running(pid))try{process.kill(pid,'SIGKILL');}catch{}}
async function checkStopped(pids){
 for(let i=0;i<50&&[pids.parent,pids.grandchild].some(running);i++)await pause(20);
 assert.equal(running(pids.parent),false,'Owned parent survived');assert.equal(running(pids.grandchild),false,'Owned grandchild survived');
}
async function exercise(mode){
 const context=await fixture(),file=join(context.root,'owned.json');
 // Independent safety stop makes this regression fail safely even with a broken controller.
 const watchdog=setTimeout(()=>{void cleanup(file);},4500);
 const started=Date.now();let result,error;
 try{
  try{result=await runInSandbox(process.execPath,['--max-old-space-size=128','-e',program(file,mode)],{...context,timeout:mode==='timeout'?1000:4000,maxBuffer:mode==='overflow'?1024:65536});}catch(value){error=value;}
  const pids=await ownedProcesses(file);assert.ok(pids.parent>0&&pids.grandchild>0,'Both owned processes must have started: '+String(error)+' '+String(error?.stderr??''));
  assert.equal(pids.ready,true,'Grandchild must install its SIGTERM handler');assert.equal(pids.pgid,result?.pid??error?.pid,'Controller must own a detached process group');
  assert.ok(Date.now()-started<3300,'Controller must stop descendants within the deadline and one-second kill grace');
  await checkStopped(pids);
  if(mode.startsWith('exit')){assert.equal(error,undefined);assert.equal(result.stdout,'');}
  else{assert.equal(error?.code,mode==='timeout'?'ETIMEDOUT':'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');assert.ok(Buffer.byteLength(error.stdout??'')<=1024);}
 }finally{clearTimeout(watchdog);await cleanup(file);await rm(context.root,{recursive:true,force:true});}
}

test('controller preserves loopback and kernel denial through nested runtime invocation',async()=>{
 const context=await fixture();try{const proof=await verifySandbox(context);assert.equal(proof.loopback,true);assert.equal(proof.customLookupDenied,true);assert.equal(proof.nonNodeChildDenied,true);}finally{await rm(context.root,{recursive:true,force:true});}
});
test('deadline kills a SIGTERM-resistant owned parent and grandchild',()=>exercise('timeout'));
test('successful parent exit cleans resistant grandchildren with closed or inherited output pipes',async()=>{await exercise('exit');await exercise('exit-pipes');});
test('bounded output stops the whole owned process group',()=>exercise('overflow'));
