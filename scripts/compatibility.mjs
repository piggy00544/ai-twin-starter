import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
const matrixVersions=JSON.parse(readFileSync(new URL('../compatibility.json',import.meta.url),'utf8'));
const sdkPeers=["@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-llm"];
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// These contracts intentionally enumerate validated prereleases. Never bypass
// Host admission or silently widen compatibility after an upstream release.
export function validateCompatibility(metadata,version,verified=matrixVersions){
 if(!Array.isArray(verified)||!verified.length||verified.length>20||new Set(verified).size!==verified.length||verified.some(v=>typeof v!=='string'||!/^0\.\d+\.\d+-(?:rc|alpha)\.\d+$/.test(v)))throw Error('Invalid SDK matrix');
 const listed=range=>typeof range==='string'?range.split(/\s*\|\|\s*/).sort():[];
 const exact=range=>JSON.stringify(listed(range))===JSON.stringify([...verified].sort());
 if(!exact(metadata.engines?.dsh)||sdkPeers.some(name=>!exact(metadata.peerDependencies?.[name]))||Object.entries(metadata.devDependencies??{}).some(([name,range])=>name.startsWith('@deepseek-ai/dsh-')&&!exact(range)))throw Error('Host and all SDK peers must exactly match the tested matrix');
 if(!verified.includes(version))throw Error('Official version is absent from the tested matrix: '+version);
 if(!/^0\.\d+\.\d+-(?:rc|alpha)\.\d+$/.test(version))throw Error('Invalid exact SDK version');
 const admits=range=>typeof range==='string'&&range.split(/\s*\|\|\s*/).includes(version);
 if(!admits(metadata.engines?.dsh))throw Error('Latest official SDK is outside validated host compatibility: '+version);
 for(const [name,range] of Object.entries(metadata.peerDependencies??{}))if(name.startsWith('@deepseek-ai/dsh-')&&!admits(range))throw Error('Required peer is outside validated compatibility: '+name+' '+version);
 return version;
}
async function main(){
 const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
 let version=process.argv[2];
 if(version==='--matrix'){validateCompatibility(metadata,matrixVersions.at(-1));console.log(JSON.stringify({sdk:matrixVersions}));return;}
 if(version==='--latest'){
  const response=await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Official version lookup failed: '+response.status);
  const value=await response.json();version=value['dist-tags']?.latest;
 }
 validateCompatibility(metadata,version);console.log(JSON.stringify({supportedOfficialVersion:version,compatibilityOverride:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
