// GitHub development agent: propose edits on a branch, never push directly to main.
export const gh = async (env,path,options={}) => {
  const response=await fetch("https://api.github.com"+path,{...options,headers:{
    "Accept":"application/vnd.github+json","Authorization":"Bearer "+env.GITHUB_TOKEN,
    "X-GitHub-Api-Version":"2022-11-28","User-Agent":"manaGPT-agent",
    ...(options.headers||{})}});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={message:text.slice(0,500)}}
  if(!response.ok)throw Error("GitHub "+response.status+": "+(data.message||"request failed"));
  return data;
};
export const encode=s=>btoa(Array.from(new TextEncoder().encode(s),b=>String.fromCharCode(b)).join(""));
export const safePath=p=>typeof p==="string" && p.length<200 && !p.startsWith("/") &&
 !p.split("/").some(x=>x===".."||x===".") && !p.startsWith(".github/workflows/") &&
 !/(^|\/)(\.env|\.git|node_modules)(\/|$)/.test(p);
export async function agentAction(env,body){
 const repo=env.GITHUB_REPOSITORY;
 if(!env.GITHUB_TOKEN||!repo||! /^[\w.-]+\/[\w.-]+$/.test(repo))throw Error("GitHub integration not configured");
 if(!body||typeof body.task!=="string"||body.task.trim().length<5||body.task.length>2000)throw Error("Task must contain 5–2000 characters");
 const root="/repos/"+repo;
 const info=await gh(env,root);
 const base=info.default_branch;
 const head=await gh(env,root+"/git/ref/heads/"+encodeURIComponent(base));
 const tree=await gh(env,root+"/git/trees/"+head.object.sha+"?recursive=1");
 const files=(tree.tree||[]).filter(f=>f.type==="blob"&&f.size<25000&&safePath(f.path)&&/\.(py|js|ts|tsx|jsx|json|md|html|css|yml|yaml)$/.test(f.path));
 if(tree.truncated)throw Error("Repository tree was truncated; refusing to edit with incomplete context");
 const terms=(body.task.toLowerCase().match(/[a-z][a-z0-9_.-]{2,}/g)||[]).slice(0,25);
 const ranked=files.map(f=>{
   const path=f.path.toLowerCase(),base=path.split("/").pop();
   let score=0;
   for(const t of terms){if(path.includes(t))score+=t.includes(".")?15:6;if(base.includes(t))score+=8}
   if(/(^|\/)(test|tests|src|lib|app|cloudflare|managpt)(\/|$)/.test(path))score+=2;
   if(/(^|\/)(readme|pyproject|package\.json|requirements)/.test(path))score+=4;
   return {...f,score};
 }).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
 const selected=ranked.slice(0,18);
 const sources=await Promise.all(selected.map(async f=>{
   const d=await gh(env,root+"/contents/"+f.path+"?ref="+encodeURIComponent(base));
   try{
     const bytes=Uint8Array.from(atob(d.content.replace(/\s/g,"")),c=>c.charCodeAt(0));
     return {path:f.path,content:new TextDecoder().decode(bytes).slice(0,14000)};
   }catch{return {path:f.path,content:"[unreadable]"}}
 }));
 const manifest=ranked.slice(0,350).map(f=>f.path);
 const instructions="You are a coding agent. Inspect provided files and repository manifest. If essential context is missing, return JSON {edits:[],reason:\"insufficient context\"} rather than guessing. Never claim tests passed without test output. Keep changes minimal and include relevant regression tests when possible.  Return ONLY a JSON object with an edits array of {path,content} (complete replacement file text). Modify at most 5 files. Use only paths from supplied files or add a new safe file. Do not edit workflows, secrets, or authentication. No markdown fences. No explanation.";
 const prompt=JSON.stringify({task:body.task,repository_files:manifest,files:sources,context_limit:"Only selected files have full contents. Do not invent facts about other files."});
 const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
   method:"POST",headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify({model:env.MANAGPT_MODEL||"qwen/qwen3.8-27b",messages:[{role:"system",content:instructions},{role:"user",content:prompt}],temperature:0.2,stream:false})});
 if(!response.ok)throw Error("AI generation failed ("+response.status+")");
 const ai=await response.json();const raw=ai.choices?.[0]?.message?.content||"";
 let proposal;try{proposal=JSON.parse(raw)}catch{throw Error("AI returned invalid edit JSON")}
 if(Array.isArray(proposal.edits)&&proposal.edits.length===0)throw Error(proposal.reason||"Insufficient context to make a reliable change");
 if(!Array.isArray(proposal.edits)||proposal.edits.length>5)throw Error("Invalid number of edits");
 const seen=new Set();
 for(const e of proposal.edits){
   if(!safePath(e.path)||typeof e.content!=="string"||e.content.length>80000||seen.has(e.path))throw Error("Unsafe edit proposal");
   seen.add(e.path);
 }
 const branch="managpt/agent-"+crypto.randomUUID().slice(0,12);
 await gh(env,root+"/git/refs",{method:"POST",body:JSON.stringify({ref:"refs/heads/"+branch,sha:head.object.sha})});
 const results=[];
 for(const e of proposal.edits){
   const current=tree.tree.find(f=>f.path===e.path);
   const payload={message:"manaGPT: "+body.task.slice(0,65),content:encode(e.content),branch};
   if(current)payload.sha=current.sha;
   const result=await gh(env,root+"/contents/"+e.path,{method:"PUT",body:JSON.stringify(payload)});
   results.push({path:e.path,sha:result.commit?.sha});
 }
 const pr=await gh(env,root+"/pulls",{method:"POST",body:JSON.stringify({
   title:"manaGPT: "+body.task.slice(0,70),head:branch,base,
   body:"AI-generated change. Review all diffs and CI checks before merging.\n\nTask: "+body.task})});
 return {branch,pr_url:pr.html_url,pr_number:pr.number,files:results,validation:"GitHub Actions will run on the pull request; merge requires manual approval"};
}
export async function agentStatus(env,number){
 if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY)throw Error("GitHub integration not configured");
 const root="/repos/"+env.GITHUB_REPOSITORY;
 const pr=await gh(env,root+"/pulls/"+number);
 const checks=await gh(env,root+"/commits/"+pr.head.sha+"/check-runs");
 return {pr_url:pr.html_url,state:pr.state,checks:(checks.check_runs||[]).map(c=>({name:c.name,status:c.status,conclusion:c.conclusion,url:c.html_url}))};
}
