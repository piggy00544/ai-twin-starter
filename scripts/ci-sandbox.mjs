import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const self=fileURLToPath(import.meta.url);

/** Package acquisition stays outside; all repository runtime code runs after privilege drop. */
export async function sandboxCommand(command,args,env){
 const runtime={...env,DSH_CI_OS_SANDBOX:process.platform};
 // Nested controllers inherit the existing kernel boundary and dropped privileges.
 // Re-entering sudo inside Linux no-new-privs is forbidden; the gate probes this boundary.
 if(['darwin','linux'].includes(process.platform)&&process.env.DSH_CI_OS_SANDBOX===process.platform)return{command,args,env:runtime};
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
 assert.ok(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=240000);
 assert.ok(Number.isSafeInteger(maxBuffer)&&maxBuffer>0&&maxBuffer<=4*1024*1024);
 const wrapped=await sandboxCommand(command,args,env);
 return new Promise((resolve,reject)=>{
  // execFile ignores detached; spawn must create the owned process group itself.
  const child=spawn(wrapped.command,wrapped.args,{cwd,env:wrapped.env,detached:true,stdio:['ignore','pipe','pipe']});
  const stdout=[],stderr=[];let bytes=0,failure,closed=false,settled=false,cleanup,deadline,closeDeadline;
  const fail=(message,code)=>{if(!failure){failure=Error(message);failure.code=code;failure.killed=true;}};
  const signal=kind=>{
   if(!child.pid)return false;
   try{process.kill(-child.pid,kind);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
  };
  const finish=()=>{
   if(settled||!closed||!cleanup)return;
   void cleanup.then(()=>{
    if(settled)return;settled=true;clearTimeout(deadline);clearTimeout(closeDeadline);
    const result={stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),pid:child.pid};
    if(failure){Object.assign(failure,result);reject(failure);}else resolve(result);
   });
  };
  const stop=()=>{
   if(cleanup)return;
   cleanup=(async()=>{
    try{
     if(!signal('SIGTERM'))return;
     const until=performance.now()+1000;
     while(performance.now()<until){await new Promise(resolve=>setTimeout(resolve,20));if(!signal(0))return;}
     signal('SIGKILL');
    }catch(error){fail('Unable to stop owned process group: '+error.message,'ERR_SANDBOX_CLEANUP');}
   })();
   // Descendants may retain pipes after their parent exits. Never await those pipes forever.
   void cleanup.then(()=>{if(!closed)closeDeadline=setTimeout(()=>{
    fail('Owned process pipes remained open after group termination','ERR_SANDBOX_CLEANUP');
    child.stdout.destroy();child.stderr.destroy();closed=true;finish();
   },500);});
   finish();
  };
  const capture=target=>chunk=>{
   const remaining=maxBuffer-bytes;if(remaining>0)target.push(chunk.subarray(0,remaining));
   bytes+=chunk.length;
   if(bytes>maxBuffer){fail('Owned process output exceeded its byte limit','ERR_CHILD_PROCESS_STDIO_MAXBUFFER');stop();}
  };
  child.stdout.on('data',capture(stdout));child.stderr.on('data',capture(stderr));
  child.on('error',error=>{failure??=error;stop();});
  child.on('exit',(code,signal)=>{
   if(code!==0){fail('Owned process exited with '+(signal??code),code??signal);if(failure)failure.signal=signal;}
   // A successful parent must not leave background descendants alive either.
   stop();
  });
  child.on('close',()=>{closed=true;stop();finish();});
  deadline=setTimeout(()=>{fail('Owned process exceeded '+timeout+'ms deadline','ETIMEDOUT');stop();},timeout);
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
