import {research} from "./research.js";
import {inferenceReady,inferenceStatus,requestInference} from "./inference.js";
import {conversations} from "./chat_sessions.js";
import {repairFailedPR} from "./repair.js";
import {agentAction,agentStatus,gh} from "./agent.js";
import {githubSettings,githubEnvironment} from "./github_settings.js";
// manaGPT Cloudflare Worker: private, serverless, D1-backed chat.
const headers = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export default {
 async scheduled(event,env,ctx){
  if(!env.DB||!inferenceReady(env))return;
  ctx.waitUntil((async()=>{
   env=await githubEnvironment(env);
   if(!env.GITHUB_TOKEN||!env.GITHUB_REPOSITORY)return;
   await env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_repairs (pr INTEGER PRIMARY KEY, head_sha TEXT NOT NULL, checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
   const root="/repos/"+env.GITHUB_REPOSITORY;
   const prs=await gh(env,root+"/pulls?state=open&per_page=30");
   for(const pr of prs.filter(p=>p.head.ref.startsWith("managpt/agent-")&&p.head.repo?.full_name===env.GITHUB_REPOSITORY).slice(0,5)){
    const prev=await env.DB.prepare("SELECT head_sha FROM agent_repairs WHERE pr=?").bind(pr.number).first();
    if(prev?.head_sha===pr.head.sha)continue;
    const checks=await gh(env,root+"/commits/"+pr.head.sha+"/check-runs");
    const list=checks.check_runs||[];
    if(!list.length||list.some(c=>c.status!=="completed"))continue;
    // Record before calling the model to avoid repeated charges on transient failures.
    await env.DB.prepare("INSERT INTO agent_repairs(pr,head_sha) VALUES (?,?) ON CONFLICT(pr) DO UPDATE SET head_sha=excluded.head_sha,checked_at=CURRENT_TIMESTAMP").bind(pr.number,pr.head.sha).run();
    if(list.some(c=>c.conclusion==="failure")){
     try{await repairFailedPR(env,pr.number)}catch(e){console.error("Agent repair failed for PR",pr.number,String(e.message||e))}
    }
   }
  })());
 },
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health") return json({ok:true});
  if(!env.MANAGPT_ACCESS_TOKEN || !env.DB) return json({error:"Configure MANAGPT_ACCESS_TOKEN and DB first"},503);
  const token=request.headers.get("Authorization")?.replace(/^Bearer /,"");
  if(!token || token!==env.MANAGPT_ACCESS_TOKEN) return json({error:"Unauthorized"},401);
  if(url.pathname==="/api/model" && request.method==="GET")return json(inferenceStatus(env));
  if(url.pathname.startsWith("/api/github/"))return githubSettings(request,env,url);
  if(url.pathname.startsWith("/api/conversations")){
   if(url.pathname.endsWith("/messages")&&!inferenceReady(env))return json({error:"Configure MANAGPT_INFERENCE_BASE_URL and MANAGPT_INFERENCE_API_KEY for Huihui-Qwen3-Coder-Next-abliterated"},503);
   return conversations(request,env,url);
  }
  if(url.pathname==="/api/research" && request.method==="POST"){
   if(!inferenceReady(env))return json({error:"Configure MANAGPT_INFERENCE_BASE_URL and MANAGPT_INFERENCE_API_KEY for Huihui-Qwen3-Coder-Next-abliterated"},503);
   try{return json(await research(env,await request.json()))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  if(url.pathname==="/api/agent/run" && request.method==="POST"){
   try{return json(await agentAction(await githubEnvironment(env),await request.json()))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  if(url.pathname==="/api/agent/repair" && request.method==="POST"){
   try{const body=await request.json();const n=Number(body.pr);if(!Number.isSafeInteger(n)||n<1)return json({error:"Invalid PR"},400);return json(await repairFailedPR(await githubEnvironment(env),n))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  if(url.pathname==="/api/agent/status" && request.method==="GET"){
   const number=Number(url.searchParams.get("pr"));
   if(!Number.isSafeInteger(number)||number<1)return json({error:"Invalid PR number"},400);
   try{return json(await agentStatus(await githubEnvironment(env),number))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL CHECK(role IN (\'user\',\'assistant\')), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  if(url.pathname==="/api/history" && request.method==="GET"){
   const {results}=await env.DB.prepare("SELECT role,content,created_at FROM messages ORDER BY id DESC LIMIT 40").all();
   return json({messages:results.reverse()});
  }
  if(url.pathname==="/api/chat" && request.method==="POST"){
   if(!inferenceReady(env))return json({error:"Configure MANAGPT_INFERENCE_BASE_URL and MANAGPT_INFERENCE_API_KEY for Huihui-Qwen3-Coder-Next-abliterated"},503);
   let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400)}
   const prompt=body.message;
   if(typeof prompt!=="string" || !prompt.trim() || prompt.length>12000)return json({error:"Message must be 1–12000 characters"},400);
   const {results}=await env.DB.prepare("SELECT role,content FROM messages ORDER BY id DESC LIMIT 20").all();
   const messages=[{role:"system",content:"You are manaGPT. Respond accurately in the user's language."},...results.reverse(),{role:"user",content:prompt}];
   const resp=await requestInference(env,{messages,stream:false});
   if(!resp.ok)return json({error:"Inference provider unavailable",status:resp.status},502);
   const data=await resp.json();
   const answer=data.choices?.[0]?.message?.content;
   if(!answer)return json({error:"Empty inference response"},502);
   await env.DB.batch([env.DB.prepare("INSERT INTO messages(role,content) VALUES (?,?)").bind("user",prompt),env.DB.prepare("INSERT INTO messages(role,content) VALUES (?,?)").bind("assistant",answer)]);
   return json({answer});
  }
  if(url.pathname==="/api/clear" && request.method==="POST"){await env.DB.prepare("DELETE FROM messages").run();return json({ok:true})}
  return json({error:"Not found"},404);
 }
};
