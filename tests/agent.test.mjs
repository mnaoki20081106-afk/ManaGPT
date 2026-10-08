import "./integrations.test.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {safePath,agentAction,agentStatus} from "../cloudflare/agent.js";
import {repairFailedPR} from "../cloudflare/repair.js";
import worker from "../cloudflare/worker.js";
import {research,citationIds,publicSource,extractPageText,fetchPublicPage} from "../cloudflare/research.js";
import {conversations} from "../cloudflare/chat_sessions.js";

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
 await assert.rejects(research({}, {query:"privacy research"}),/inference endpoint/);
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
  const result=await research({MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",MANAGPT_INFERENCE_API_KEY:"test",BRAVE_SEARCH_API_KEY:"test"}, {query:"privacy research"});
  assert.equal(requests,2);
  assert.equal(result.sources.length,1);
  assert.equal(result.sources[0].url,"https://example.org/guide");
  assert.equal(result.answer,"Answer [1]");
  assert.equal(result.verified,false);
 }finally{globalThis.fetch=original}
});

test("citation integrity and unsafe URL filtering",()=>{
 assert.deepEqual(citationIds("A [1], B [2], A [1]"),[1,2]);
 for(const url of ["https://localhost/x","https://127.0.0.1/x","https://10.0.0.1/x","https://192.168.1.1/x","http://example.org","https://sample.onion"]){
  assert.equal(publicSource({url}),false,url);
 }
});
test("deep research uses two searches and deduplicates sources",async()=>{
 const original=globalThis.fetch;
 let searches=0;
 globalThis.fetch=async url=>{
  if(String(url).includes("search.brave.com")){
   searches++;
   return new Response(JSON.stringify({web:{results:[{title:"Source",url:"https://example.org/a?utm_source=x",description:"Facts"}]}}));
  }
  return new Response(JSON.stringify({choices:[{message:{content:"Evidence [1]"}}]}));
 };
 try{
  const result=await research({GROQ_API_KEY:"test",BRAVE_SEARCH_API_KEY:"test"},{query:"privacy research",deep:true});
  assert.equal(searches,2);
  assert.equal(result.sources.length,1);
  assert.equal(result.citation_valid,true);
  assert.equal(result.sources[0].url,"https://example.org/a");
 }finally{globalThis.fetch=original}
});

test("HTML extraction removes active content and navigation",()=>{
 const text=extractPageText("<html><script>evil()</script><nav>Menu</nav><main><h1>Research</h1><p>Facts &amp; sources</p></main></html>");
 assert.equal(text.includes("evil"),false);
 assert.equal(text.includes("Menu"),false);
 assert.match(text,/Research Facts & sources/);
});
test("full text rejects unsafe destinations before network access",async()=>{
 await assert.rejects(fetchPublicPage("https://localhost/article"),/Unsafe/);
 await assert.rejects(fetchPublicPage("https://example.org:8443/article"),/Unsafe/);
});
test("research reads search-derived public HTML pages",async()=>{
 const original=globalThis.fetch;let pages=0;
 globalThis.fetch=async url=>{
  if(String(url).includes("search.brave.com"))return new Response(JSON.stringify({web:{results:[
   {title:"Trusted",url:"https://trusted.org/a",description:"Excerpt"},
   {title:"Other",url:"https://other.org/b",description:"Excerpt"}
  ]}}));
  if(String(url).includes("trusted.org")){pages++;return new Response("<html><main><p>"+("Verified text ".repeat(20))+"</p></main></html>",{headers:{"content-type":"text/html"}})}
  return new Response(JSON.stringify({choices:[{message:{content:"Evidence [1]"}}]}));
 };
 try{
  const result=await research({GROQ_API_KEY:"test",BRAVE_SEARCH_API_KEY:"test"},{query:"research privacy",fulltext:true});
  assert.equal(pages,1);
  assert.equal(result.fulltext_count,1);
  assert.equal(result.sources[1].page_text,undefined);
 }finally{globalThis.fetch=original}
});

test("conversation API rejects invalid ids and missing sessions",async()=>{
 const db={prepare(sql){return {run:async()=>({}),bind(){return this},first:async()=>null,all:async()=>({results:[]})}}};
 const env={DB:db};
 const list=await conversations(new Request("https://test/api/conversations"),env,new URL("https://test/api/conversations"));
 assert.equal(list.status,200);
 assert.deepEqual((await list.json()).conversations,[]);
 const invalid=await conversations(new Request("https://test/api/conversations/bad"),env,new URL("https://test/api/conversations/bad"));
 assert.equal(invalid.status,400);
 const missing=await conversations(new Request("https://test/api/conversations/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),env,new URL("https://test/api/conversations/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
 assert.equal(missing.status,404);
});
