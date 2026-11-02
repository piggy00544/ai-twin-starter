import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const self=fileURLToPath(import.meta.url);

/** Package acquisition stays outside; all repository runtime code runs after privilege drop. */
export async function sandboxCommand(command,args,env){
 const runtime={...env,DSH_CI_OS_SANDBOX:process.platform};
 if(process.platform==='darwin'){
  const directory=await mkdtemp(join(env.TMPDIR??tmpdir(),'dsh-ci-network-')),profile=join(directory,'network.sb');
  await writeFile(profile,'(version 1)\n(allow default)\n(deny network*)\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n');
  return{command:'/usr/bin/sandbox-exec',args:['-f',profile,command,...args],env:runtime};
 }
 if(process.platform==='linux'){
  const uid=process.getuid(),gid=process.getgid();assert.ok(uid>0,'Start the CI sandbox as the unprivileged runner');
  const setup='set -eu\n/usr/sbin/ip link set lo up\ntask_uid=$1\ntask_gid=$2\nshift 2\nexec /usr/bin/setpriv --reuid "$task_uid" --regid "$task_gid" --clear-groups --no-new-privs "$@"';
  return{command:'sudo',args:['-n','--','/usr/bin/unshare','--net','--','/bin/sh','-c',setup,'dsh-ci-network',String(uid),String(gid),'/usr/bin/env','-i',...Object.entries(runtime).map(([key,value])=>key+'='+String(value)),command,...args],env:runtime};
 }
 throw Error('No supported OS network sandbox; refusing unsandboxed runtime');
}
export async function runInSandbox(command,args,{cwd,env,timeout=240000,maxBuffer=4*1024*1024}){
 assert.ok(timeout>0&&timeout<=240000);const wrapped=await sandboxCommand(command,args,env);
 return new Promise((resolve,reject)=>{
  let timer,hardTimer;
  const child=execFile(wrapped.command,wrapped.args,{cwd,env:wrapped.env,maxBuffer,detached:true},(error,stdout,stderr)=>{
   clearTimeout(timer);clearTimeout(hardTimer);if(error){error.stdout=stdout;error.stderr=stderr;reject(error);}else resolve({stdout,stderr});
  });
  const kill=signal=>{if(child.pid)try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
  timer=setTimeout(()=>{kill('SIGTERM');hardTimer=setTimeout(()=>kill('SIGKILL'),1000);},timeout);
 });
}
export async function verifySandbox({cwd,env}){
 const result=await runInSandbox(process.execPath,['--max-old-space-size=128',self,'--self-test'],{cwd,env:{...env,NODE_OPTIONS:'--max-old-space-size=128'},timeout:10000,maxBuffer:65536});
 const proof=JSON.parse(result.stdout);assert.equal(proof.loopback,true);assert.equal(proof.customLookupDenied,true);assert.equal(proof.nonNodeChildDenied,true);return proof;
}
async function selfTest(){
 assert.equal(process.env.DSH_CI_OS_SANDBOX,process.platform,'Self-test must run through the OS sandbox wrapper');
 const {createServer,createConnection}=await import('node:net');
 const denied=new Set(['EPERM','EACCES','ENETUNREACH','EHOSTUNREACH']);
 const server=createServer(socket=>socket.end('synthetic-loopback'));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const value=await new Promise((resolve,reject)=>{let text='';const socket=createConnection(server.address().port,'127.0.0.1');socket.on('data',bytes=>text+=bytes);socket.once('end',()=>resolve(text));socket.once('error',reject);socket.setTimeout(1000,()=>socket.destroy(Error('Loopback probe timed out')));});assert.equal(value,'synthetic-loopback');
  let lookupCalled=false;
  const code=await new Promise((resolve,reject)=>{const socket=createConnection({host:'localhost',port:443,autoSelectFamily:false,lookup(_host,_options,callback){lookupCalled=true;callback(null,'192.0.2.1',4);}});socket.once('connect',()=>{socket.destroy();reject(Error('Custom lookup escaped network isolation'));});socket.once('error',error=>resolve(error.code));socket.setTimeout(1000,()=>socket.destroy(Error('External socket denial not established')));});
  assert.equal(lookupCalled,true);assert.ok(denied.has(code),'Missing OS denial after custom lookup: '+code);
  const python='import socket,errno,json\ns=socket.socket();s.settimeout(1)\ntry:\n s.connect(("192.0.2.1",443));raise AssertionError("Child escaped network isolation")\nexcept OSError as e:\n assert e.errno in (errno.EPERM,errno.EACCES,errno.ENETUNREACH,errno.EHOSTUNREACH),str(e)\n print(json.dumps({"denied":True,"errno":e.errno}))\nfinally:\n s.close()';
  const child=await new Promise((resolve,reject)=>execFile('python3',['-I','-S','-c',python],{env:{PATH:process.env.PATH,HOME:process.env.HOME},timeout:3000,maxBuffer:65536},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))));assert.equal(child.denied,true);
  console.log(JSON.stringify({platform:process.platform,loopback:true,customLookupDenied:true,customLookupError:code,nonNodeChildDenied:true,childErrno:child.errno,javascriptPreloadRequired:false,privateAccounts:false}));
 }finally{await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href&&process.argv[2]==='--self-test')await selfTest();
