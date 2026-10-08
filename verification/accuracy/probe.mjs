// Same regression probe runs against original, modified, and restored source trees.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {agentStatus}=await import(pathToFileURL(resolve(process.argv[2],'cloudflare/agent.js')));
const original=globalThis.fetch;
let failed=0;
for(const scenario of [
 {name:'legacy_failure',required:['test'],statuses:[{id:2,context:'external',state:'failure'}],expected:'not_passed'},
 {name:'missing_required',required:['test','typecheck'],statuses:[],expected:'unknown'}
]) {
 globalThis.fetch=async url=>{
  const path=new URL(url).pathname;
  const body=path.endsWith('/pulls/1')?{state:'open',head:{sha:'base'}}:
   path.endsWith('/status')?{sha:'base',total_count:scenario.statuses.length,statuses:scenario.statuses}:
   {total_count:1,check_runs:[{id:1,name:'test',head_sha:'base',status:'completed',conclusion:'success'}]};
  return new Response(JSON.stringify(body));
 };
 const result=await agentStatus({GITHUB_TOKEN:'fixture',GITHUB_REPOSITORY:'fixture/repo',AGENT_REQUIRED_CHECKS:JSON.stringify(scenario.required)},1);
 const ok=result.validation===scenario.expected;
 console.log(`${scenario.name}: actual=${result.validation} expected=${scenario.expected} ${ok?'PASS':'FAIL'}`);
 if(!ok)failed++;
}
globalThis.fetch=original;
process.exitCode=failed?1:0;
