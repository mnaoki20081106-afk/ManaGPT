import {repairFailedPR} from "./repair.js";
import {agentAction,agentStatus} from "./agent.js";
// manaGPT Cloudflare Worker: private, serverless, D1-backed chat.
const headers = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health") return json({ok:true});
  if(!env.MANAGPT_ACCESS_TOKEN || !env.GROQ_API_KEY || !env.DB) return json({error:"Configure MANAGPT_ACCESS_TOKEN, GROQ_API_KEY and DB first"},503);
  const token=request.headers.get("Authorization")?.replace(/^Bearer /,"");
  if(!token || token!==env.MANAGPT_ACCESS_TOKEN) return json({error:"Unauthorized"},401);
  if(url.pathname==="/api/agent/run" && request.method==="POST"){
   try{return json(await agentAction(env,await request.json()))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  if(url.pathname==="/api/agent/repair" && request.method==="POST"){
   try{const body=await request.json();const n=Number(body.pr);if(!Number.isSafeInteger(n)||n<1)return json({error:"Invalid PR"},400);return json(await repairFailedPR(env,n))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  if(url.pathname==="/api/agent/status" && request.method==="GET"){
   const number=Number(url.searchParams.get("pr"));
   if(!Number.isSafeInteger(number)||number<1)return json({error:"Invalid PR number"},400);
   try{return json(await agentStatus(env,number))}
   catch(e){return json({error:String(e.message||e)},400)}
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL CHECK(role IN (\'user\',\'assistant\')), content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  if(url.pathname==="/api/history" && request.method==="GET"){
   const {results}=await env.DB.prepare("SELECT role,content,created_at FROM messages ORDER BY id DESC LIMIT 40").all();
   return json({messages:results.reverse()});
  }
  if(url.pathname==="/api/chat" && request.method==="POST"){
   let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400)}
   const prompt=body.message;
   if(typeof prompt!=="string" || !prompt.trim() || prompt.length>12000)return json({error:"Message must be 1–12000 characters"},400);
   const {results}=await env.DB.prepare("SELECT role,content FROM messages ORDER BY id DESC LIMIT 20").all();
   const messages=[{role:"system",content:"You are manaGPT. Respond accurately in the user's language."},...results.reverse(),{role:"user",content:prompt}];
   const resp=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+env.GROQ_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:env.MANAGPT_MODEL||"qwen/qwen3.8-27b",messages,stream:false})});
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
