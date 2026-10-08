import {gh,encode,safePath} from "./agent.js";
import {inferenceReady,requestInference} from "./inference.js";
const decode=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,"")),c=>c.charCodeAt(0)));
export async function repairFailedPR(env,number){
 if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY||!inferenceReady(env))throw Error("GitHub/inference not configured");
 const root="/repos/"+env.GITHUB_REPOSITORY;
 const pr=await gh(env,root+"/pulls/"+number);
 if(pr.state!=="open"||!pr.head.ref.startsWith("managpt/agent-")||pr.head.repo.full_name!==env.GITHUB_REPOSITORY)throw Error("Only open manaGPT agent PRs can be repaired");
 const runs=await gh(env,root+"/commits/"+pr.head.sha+"/check-runs");
 const checks=runs.check_runs||[];
 if(checks.some(c=>c.status!=="completed"))return {state:"pending",message:"Tests are still running",checks:checks.map(c=>({name:c.name,status:c.status}))};
 const failures=checks.filter(c=>c.conclusion==="failure");
 if(!checks.length)return {state:"unknown",message:"No CI checks found. Cannot claim tests passed"};
 if(!failures.length){
  const bad=checks.filter(c=>c.conclusion!=="success");
  if(bad.length)return {state:"unknown",message:"Checks did not all succeed",checks:bad.map(c=>({name:c.name,conclusion:c.conclusion}))};
  return {state:"passed",message:"All reported checks passed"};
 }
 const comments=await gh(env,root+"/issues/"+number+"/comments?per_page=100");
 const prior=(comments||[]).filter(c=>c.body?.startsWith("manaGPT repair attempt:")).length;
 if(prior>=3)return {state:"limit",message:"Maximum 3 repair attempts reached; manual review required"};
 const changed=await gh(env,root+"/pulls/"+number+"/files?per_page=30");
 const allowed=changed.filter(f=>safePath(f.filename)&&f.status!=="removed").slice(0,5);
 if(!allowed.length)throw Error("No repairable files");
 const sources=await Promise.all(allowed.map(async f=>{
   const d=await gh(env,root+"/contents/"+f.filename+"?ref="+encodeURIComponent(pr.head.ref));
   return {path:f.filename,content:decode(d.content).slice(0,14000),sha:d.sha};
 }));
 const workflowRuns=await gh(env,root+"/actions/runs?head_sha="+encodeURIComponent(pr.head.sha)+"&per_page=20");
 const workflowLogs=[];
 for(const run of (workflowRuns.workflow_runs||[]).filter(x=>x.conclusion==="failure").slice(0,2)){
  const jobs=await gh(env,root+"/actions/runs/"+run.id+"/jobs?per_page=30");
  for(const job of (jobs.jobs||[]).filter(j=>j.conclusion==="failure").slice(0,2)){
   const response=await fetch("https://api.github.com"+root+"/actions/jobs/"+job.id+"/logs",{
    headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","User-Agent":"manaGPT-agent"},
    redirect:"follow"});
   if(response.ok){
    const log=(await response.text()).slice(-16000);
    const lines=log.split("\\n").filter(x=>/error|failed|traceback|syntaxerror|assert|exception|cannot find|not found/i.test(x));
    workflowLogs.push({job:job.name,errors:lines.slice(-45).join("\\n").slice(-6500)});
   }
  }
 }
 const logs=await Promise.all(failures.slice(0,3).map(async c=>{
   const annotations=await gh(env,root+"/check-runs/"+c.id+"/annotations?per_page=30");
   return {name:c.name,summary:c.output?.summary||"",annotations:annotations.map(a=>({path:a.path,message:a.message,line:a.start_line})).slice(0,20)};
 }));
 const response=await requestInference(env,{temperature:0.1,stream:false,
     messages:[{role:"system",content:"Repair failing tests. Return ONLY JSON {edits:[{path,content}]} with complete file replacements. Use ONLY provided file paths. Maximum 5 files. Do not change authentication or workflows."},
       {role:"user",content:JSON.stringify({files:sources,failures:logs,workflowLogs})}]});
 if(!response.ok)throw Error("Inference HTTP "+response.status);
 const generated=await response.json();let proposal;
 try{proposal=JSON.parse(generated.choices?.[0]?.message?.content||"")}catch{throw Error("Invalid repair JSON")}
 if(!Array.isArray(proposal.edits)||!proposal.edits.length||proposal.edits.length>5)throw Error("Invalid repair proposal");
 const used=new Set();const edits=[];
 for(const e of proposal.edits){
   const original=sources.find(f=>f.path===e.path);
   if(!original||used.has(e.path)||typeof e.content!=="string"||e.content.length>80000)throw Error("Unsafe repair");
   used.add(e.path);edits.push({original,content:e.content});
 }
 // A single tree/commit update makes the repair atomic.
 const blobs=await Promise.all(edits.map(async e=>{
   const blob=await gh(env,root+"/git/blobs",{method:"POST",body:JSON.stringify({content:e.content,encoding:"utf-8"})});
   return {path:e.original.path,mode:"100644",type:"blob",sha:blob.sha};
 }));
 const baseCommit=await gh(env,root+"/git/commits/"+pr.head.sha);
 const tree=await gh(env,root+"/git/trees",{method:"POST",body:JSON.stringify({base_tree:baseCommit.tree.sha,tree:blobs})});
 const commit=await gh(env,root+"/git/commits",{method:"POST",body:JSON.stringify({message:"manaGPT: repair failing PR checks",tree:tree.sha,parents:[pr.head.sha]})});
 await gh(env,root+"/git/refs/heads/"+pr.head.ref,{method:"PATCH",body:JSON.stringify({sha:commit.sha,force:false})});
 await gh(env,root+"/issues/"+number+"/comments",{method:"POST",body:JSON.stringify({body:"manaGPT repair attempt: "+(prior+1)+"/3. Commit: "+commit.sha})});
 return {state:"repaired",pr_url:pr.html_url,commit:commit.sha,files:blobs.map(b=>b.path),message:"New commit pushed; PR checks will rerun"};
}
