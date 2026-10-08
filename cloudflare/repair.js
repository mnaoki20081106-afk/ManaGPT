import {gh,safePath,propose,commitEdits,pathURL,modelConfig} from "./coding.js";
export async function repairFailedPR(env,number){
 if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY)throw Error("GitHub/Groq not configured");
 modelConfig(env);
 const root="/repos/"+env.GITHUB_REPOSITORY;
 const pr=await gh(env,root+"/pulls/"+number);
 if(pr.state!=="open"||!pr.head.ref.startsWith("managpt/agent-")||pr.head.repo?.full_name!==env.GITHUB_REPOSITORY)throw Error("Only open manaGPT agent PRs can be repaired");
 const runs=await gh(env,root+"/commits/"+pr.head.sha+"/check-runs?per_page=100");
 const checks=runs.check_runs||[];
 if(runs.total_count>checks.length)return {state:"unknown",message:"Incomplete CI check listing"};
 if(checks.some(c=>c.status!=="completed"))return {state:"pending",message:"Tests are still running",checks:checks.map(c=>({name:c.name,status:c.status}))};
 const failures=checks.filter(c=>c.conclusion==="failure");
 if(!checks.length)return {state:"unknown",message:"No CI checks found. Cannot claim tests passed"};
 if(!failures.length){
  const bad=checks.filter(c=>c.conclusion!=="success");
  if(bad.length)return {state:"unknown",message:"Checks did not all succeed",checks:bad.map(c=>({name:c.name,conclusion:c.conclusion}))};
  return {state:"passed",message:"All reported checks passed"};
 }
 const comments=await gh(env,root+"/issues/"+number+"/comments?per_page=100");
 if(comments.length>=100)return {state:"limit",message:"Repair history exceeds inspection budget"};
 const prior=(comments||[]).filter(c=>c.body?.startsWith("manaGPT repair attempt:")).length;
 if(prior>=3)return {state:"limit",message:"Maximum 3 repair attempts reached; manual review required"};
 const changed=await gh(env,root+"/pulls/"+number+"/files?per_page=30");
 const allowed=changed.filter(f=>safePath(f.filename)&&f.status!=="removed").slice(0,5);
 if(!allowed.length)throw Error("No repairable files");
 const workflowRuns=await gh(env,root+"/actions/runs?head_sha="+encodeURIComponent(pr.head.sha)+"&per_page=20");
 const workflowLogs=[];
 for(const run of (workflowRuns.workflow_runs||[]).filter(x=>x.conclusion==="failure").slice(0,2)){
  const jobs=await gh(env,root+"/actions/runs/"+run.id+"/jobs?per_page=30");
  for(const job of (jobs.jobs||[]).filter(j=>j.conclusion==="failure").slice(0,2)){
   const response=await fetch("https://api.github.com"+root+"/actions/jobs/"+job.id+"/logs",{
    headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","User-Agent":"manaGPT-agent"},
    signal:AbortSignal.timeout(30000),redirect:"follow"});
   if(response.ok){
    const log=(await response.text()).slice(-16000);
    const lines=log.split("\n").filter(x=>/error|failed|traceback|syntaxerror|assert|exception|cannot find|not found/i.test(x));
    workflowLogs.push({job:job.name,errors:lines.slice(-45).join("\n").slice(-6500)});
   }
  }
 }
 const logs=await Promise.all(failures.slice(0,3).map(async c=>{
   const annotations=await gh(env,root+"/check-runs/"+c.id+"/annotations?per_page=30");
   return {name:c.name,summary:c.output?.summary||"",annotations:annotations.map(a=>({path:a.path,message:a.message,line:a.start_line})).slice(0,20)};
 }));
 const baseCommit=await gh(env,root+"/git/commits/"+pr.head.sha);
 const tree=await gh(env,root+"/git/trees/"+baseCommit.tree.sha+"?recursive=1");
 if(tree.truncated)throw Error("Repository tree was truncated");
 const proposal=await propose(env,root,pr.head.sha,tree.tree,
  "Repair the failing CI for this original task: "+pr.title+"\n"+(pr.body||"").slice(0,12000),
  {failures:logs,workflowLogs},allowed.map(f=>f.filename));
 const current=await gh(env,root+"/pulls/"+number);
 if(current.state!=="open"||current.head.sha!==pr.head.sha)throw Error("PR changed during repair; retry against the latest head");
 const commit=await commitEdits(env,root,pr.head.sha,baseCommit.tree.sha,tree.tree,proposal.edits,"manaGPT: repair failing PR checks");
 await gh(env,root+"/git/refs/heads/"+pathURL(pr.head.ref),{method:"PATCH",body:JSON.stringify({sha:commit.sha,force:false})});
 await gh(env,root+"/issues/"+number+"/comments",{method:"POST",body:JSON.stringify({body:"manaGPT repair attempt: "+(prior+1)+"/3. Commit: "+commit.sha})});
 return {state:"repaired",pr_url:pr.html_url,commit:commit.sha,files:proposal.edits.map(e=>e.path),trace:proposal.trace,message:"New commit pushed; PR checks will rerun"};
}
