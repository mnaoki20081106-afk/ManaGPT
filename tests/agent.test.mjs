import test from "node:test";
import assert from "node:assert/strict";
import {safePath,agentAction,agentStatus} from "../cloudflare/agent.js";
import {repairFailedPR} from "../cloudflare/repair.js";
import worker from "../cloudflare/worker.js";
import {research} from "../cloudflare/research.js";

test("unsafe paths are rejected",()=>{
 for(const p of ["../secret",".env","node_modules/a.js",".github/workflows/evil.yml","/root/x"]){
  assert.equal(safePath(p),false,p);
 }
 assert.equal(safePath("src/index.js"),true);
});
test("agent requires valid task and credentials",async()=>{
 await assert.rejects(agentAction({}, {task:"fix a bug"}),/not configured/);
 await assert.rejects(agentAction({GITHUB_TOKEN:"x",GITHUB_REPOSITORY:"owner/repo"}, {task:"no"}),/5/);
});
test("repair requires integration",async()=>{
 await assert.rejects(repairFailedPR({},1),/not configured/);
});
test("health and auth do not expose private endpoints",async()=>{
 const env={MANAGPT_ACCESS_TOKEN:"private",GROQ_API_KEY:"key",DB:{}};
 const health=await worker.fetch(new Request("https://test/health"),env);
 assert.equal(health.status,200);
 const unauth=await worker.fetch(new Request("https://test/api/history"),env);
 assert.equal(unauth.status,401);
});
test("missing CI checks are not a pass",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
  const path=new URL(url).pathname;
  const data=path.endsWith("/pulls/2")?{html_url:"https://github.com/x/y/pull/2",head:{sha:"abc"},state:"open"}:{check_runs:[]};
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  const result=await agentStatus({GITHUB_TOKEN:"x",GITHUB_REPOSITORY:"x/y"},2);
  assert.equal(result.checks.length,0);
 }finally{globalThis.fetch=original}
});

test("research requires credentials and rejects short questions",async()=>{
 await assert.rejects(research({}, {query:"hi"}),/3/);
 await assert.rejects(research({}, {query:"privacy research"}),/GROQ_API_KEY/);
});
test("research preserves citations and filters unsafe search links",async()=>{
 const original=globalThis.fetch;
 let requests=0;
 globalThis.fetch=async (url)=>{
  requests++;
  if(String(url).includes("search.brave.com"))return new Response(JSON.stringify({web:{results:[
   {title:"Valid source",url:"https://example.org/guide",description:"A useful guide"},
   {title:"Onion gateway",url:"http://example.onion",description:"Blocked"},
   {title:"Injected credentials",url:"https://user:pass@example.com",description:"Blocked"}
  ]}}),{status:200});
  return new Response(JSON.stringify({choices:[{message:{content:"Answer [1]"}}]}),{status:200});
 };
 try{
  const result=await research({GROQ_API_KEY:"test",BRAVE_SEARCH_API_KEY:"test"}, {query:"privacy research"});
  assert.equal(requests,2);
  assert.equal(result.sources.length,1);
  assert.equal(result.sources[0].url,"https://example.org/guide");
  assert.equal(result.answer,"Answer [1]");
  assert.equal(result.verified,false);
 }finally{globalThis.fetch=original}
});
