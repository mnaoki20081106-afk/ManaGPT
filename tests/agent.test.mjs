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

// Full protocol tests with deterministic GitHub/model substitutes. These test the
// agent orchestration, not the coding ability of a live model.
import {validateEdits,modelConfig,LIMITS} from "../cloudflare/coding.js";
const codingEnv={GITHUB_TOKEN:"test",GITHUB_REPOSITORY:"owner/repo",GROQ_API_KEY:"test",AGENT_REQUIRED_CHECKS:'["test"]'};
const proposal=(content="export const answer = 42;\n")=>({action:"propose",summary:"Fix answer and cover regression",test_plan:["node --test"],edits:[{path:"src/answer.js",content},{path:"tests/answer.test.js",content:"import assert from 'node:assert/strict';\nimport {answer} from '../src/answer.js';\nassert.equal(answer,42);\n"}]});
async function mockAgent(replies,run,options={}) {
 const old=globalThis.fetch, calls=[];
 const source={"AGENTS.md":"Preserve public interfaces; add regression tests.","README.md":"Example project","package.json":"{}","src/answer.js":"export const answer = 0;\n",...options.source};
 const entries=Object.entries(source).map(([path,content],i)=>({path,type:"blob",mode:path==="src/answer.js"?"100755":"100644",size:new TextEncoder().encode(content).length,sha:"blob"+i}));
 globalThis.fetch=async (url,init={})=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;
  calls.push({path,body,method:init.method||"GET"});
  const response=x=>new Response(JSON.stringify(x));
  if(path.endsWith("/chat/completions")){
   assert.ok(replies.length,"Unexpected extra model call");
   return response({choices:[{finish_reason:"stop",message:{content:JSON.stringify(replies.shift())}}]});
  }
  if(path==="/repos/owner/repo")return response({default_branch:"main"});
  if(path.endsWith("/git/ref/heads/main"))return response({object:{sha:"base"}});
  if(path.endsWith("/git/commits/base"))return response({tree:{sha:"tree"}});
  if(path.endsWith("/git/trees/tree"))return response({tree:entries,truncated:false});
  const file=entries.find(f=>path.endsWith("/git/blobs/"+f.sha));
  if(file)return response({encoding:"base64",content:Buffer.from(source[file.path]).toString("base64")});
  if(path.endsWith("/git/blobs")&&init.method==="POST")return response({sha:"newblob"});
  if(path.endsWith("/git/trees")&&init.method==="POST")return response({sha:"newtree"});
  if(path.endsWith("/git/commits")&&init.method==="POST")return response({sha:"newcommit"});
  if(path.endsWith("/git/refs"))return response({});
  if(path.endsWith("/pulls"))return response({html_url:"https://github.com/owner/repo/pull/7",number:7});
  throw Error("Unexpected request "+path);
 };
 try {await run(calls,entries);}finally{globalThis.fetch=old;}
}
test("agent reads additional files, resolves review, adds tests and publishes atomically",async()=>{
 const first=proposal(), fixed=proposal("export const answer = 43;\n");
 fixed.edits[1]=({path:"tests/answer.test.js",content:"import assert from 'node:assert/strict';\nimport {answer} from '../src/answer.js';\nassert.equal(answer,43);\n"});
 await mockAgent([
  {action:"search",query:"answer"},{action:"read",paths:["src/answer.js"]},first,
  {approved:false,issues:["The expected answer is 43; add a test."]},fixed,{approved:true,issues:[]},{approved:true,issues:[]}
 ],async calls=>{
  const result=await agentAction(codingEnv,{task:"Correct answer to 43"});
  assert.equal(result.validation,"pending_ci");
  assert.equal(result.files.length,2);
  assert.ok(result.read_paths.includes("AGENTS.md"));
  assert.deepEqual(result.trace.filter(x=>x.action==="review").map(x=>x.approved),[false,true,true]);
  const writes=calls.filter(c=>c.method==="POST"&&!c.path.endsWith("chat/completions"));
  assert.equal(writes.filter(c=>c.path.endsWith("/git/commits")).length,1);
  assert.equal(writes.find(c=>c.path.endsWith("/git/refs")).body.sha,"newcommit");
  assert.equal(writes.find(c=>c.path.endsWith("/pulls")).body.draft,true);
  assert.equal(writes.find(c=>c.path.endsWith("/git/trees")).body.tree[0].mode,"100755");
  assert.ok(!calls.some(c=>c.method==="PUT"));
 });
});
test("rejected review exhausts budget without publishing",async()=>{
 const replies=Array.from({length:LIMITS.rounds},()=>[proposal(),{approved:false,issues:["Missing boundary test"]}]).flat();
 await mockAgent(replies,async calls=>{
  await assert.rejects(agentAction(codingEnv,{task:"Fix answer calculation"}),/budget/);
  assert.equal(calls.filter(c=>c.method!=="GET"&&!c.path.endsWith("chat/completions")).length,0);
 });
});
test("complete file content beyond the former 14000 character cutoff reaches model",async()=>{
 const content="// "+"x".repeat(15000)+"\nexport const TAIL_SENTINEL = 0;\n";
 await mockAgent([proposal(),{approved:true,issues:[]},{approved:true,issues:[]}],async calls=>{
  await agentAction(codingEnv,{task:"Fix answer calculation"});
  const request=calls.find(c=>c.path.endsWith("chat/completions"));
  assert.match(JSON.stringify(request.body.messages),/TAIL_SENTINEL/);
 },{source:{"src/answer.js":content}});
});
test("nested repository instructions are loaded before proposal review",async()=>{
 await mockAgent([proposal(),proposal(),{approved:true,issues:[]},{approved:true,issues:[]}],async calls=>{
  const result=await agentAction(codingEnv,{task:"Correct answer calculation"});
  assert.ok(result.read_paths.includes("src/AGENTS.md"));
  const reviews=calls.filter(c=>c.path.endsWith("chat/completions")&&c.body.messages[0].content.startsWith("Review"));
  assert.equal(reviews.length,1);
  assert.match(JSON.stringify(reviews[0]),/NESTED_INSTRUCTION/);
 },{source:{"src/AGENTS.md":"NESTED_INSTRUCTION" ,"a.md":"a","b.md":"b","c.md":"c"}});
});
test("unread files, duplicate edits, file-directory collisions and no-ops are rejected",()=>{
 const files=new Map([["src/answer.js",{mode:"100644"}]]),read=new Map();
 assert.throws(()=>validateEdits(proposal().edits,files,read),/Read existing/);
 read.set("src/answer.js","old");
 assert.throws(()=>validateEdits([...proposal().edits,...proposal().edits],files,read),/Unsafe/);
 assert.throws(()=>validateEdits([{path:"src",content:"bad"}],files,read),/conflicts/);
 assert.throws(()=>validateEdits([{path:"src/answer.js",content:"old"}],files,read),/no changes/);
 assert.equal(validateEdits([{path:"tests/new.js",content:"test"}],files,read).length,1);
});
test("model configuration supports a separate coding provider and review model",()=>{
 const config=modelConfig({AGENT_API_BASE_URL:"https://models.example/v1/",AGENT_API_KEY:"key",AGENT_MODEL:"coder",AGENT_REVIEW_MODEL:"reviewer"},true);
 assert.equal(config.model,"reviewer");
 assert.equal(config.url,"https://models.example/v1/chat/completions");
 assert.throws(()=>modelConfig({AGENT_API_BASE_URL:"http://example.com",AGENT_API_KEY:"x"}),/Invalid/);
});
test("encoded traversal, environment variants, empty components and private keys are rejected",()=>{
 for(const path of ["", "src//a.js", "a\\b.js", "a?ref=main", "%2e%2e/a", ".env.local", "keys/private.pem", "src/a\n.js"])
  assert.equal(safePath(path),false,path);
});

test("repair consumes multiline failure evidence and refuses a changed PR head",async()=>{
 const original=globalThis.fetch;let pulls=0, writes=0, modelCalls=0;
 const pr={state:"open",title:"Fix answer",body:"Return 43",head:{sha:"base",ref:"managpt/agent-test",repo:{full_name:"owner/repo"}}};
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(url).pathname,reply=x=>new Response(JSON.stringify(x));
  if(path.endsWith("chat/completions")) {
   modelCalls++;
   const body=JSON.parse(init.body);
   if(modelCalls===1){
    assert.match(body.messages[1].content,/AssertionError/);
    assert.doesNotMatch(body.messages[1].content,/unrelated log output/);
    return reply({choices:[{message:{content:JSON.stringify(proposal("export const answer = 43;"))}}]});
   }
   return reply({choices:[{message:{content:'{"approved":true,"issues":[]}'}}]});
  }
  if(init.method && init.method!=="GET")writes++;
  if(path.endsWith("/pulls/7")){pulls++;return reply(pulls===1?pr:{...pr,head:{...pr.head,sha:"other"}});}
  if(path.endsWith("/status"))return reply({sha:"base",total_count:0,statuses:[]});
  if(path.endsWith("/check-runs"))return reply({total_count:1,check_runs:[{id:9,name:"test",head_sha:"base",status:"completed",conclusion:"failure"}]});
  if(path.endsWith("/comments"))return reply([]);
  if(path.endsWith("/files"))return reply([{filename:"src/answer.js",status:"modified"}]);
  if(path.endsWith("/actions/runs"))return reply({workflow_runs:[{id:1,conclusion:"failure"}]});
  if(path.endsWith("/jobs"))return reply({jobs:[{id:2,name:"test",conclusion:"failure"}]});
  if(path.endsWith("/logs"))return new Response("unrelated log output\nAssertionError: expected 43\nmore ordinary output");
  if(path.endsWith("/annotations"))return reply([]);
  if(path.endsWith("/git/commits/base"))return reply({tree:{sha:"tree"}});
  if(path.endsWith("/git/trees/tree"))return reply({tree:[{path:"src/answer.js",mode:"100644",type:"blob",size:10,sha:"blob"}]});
  if(path.endsWith("/git/blobs/blob"))return reply({encoding:"base64",content:Buffer.from("export const answer = 0;").toString("base64")});
  throw Error("Unexpected request "+path);
 };
 try {
  await assert.rejects(repairFailedPR(codingEnv,7),/PR changed/);
  assert.equal(modelCalls,3);assert.equal(writes,0);
 }finally{globalThis.fetch=original;}
});

test("incomplete check list never becomes a successful status",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes("check-runs")?
  {total_count:101,check_runs:[{status:"completed",conclusion:"success"}]}:
  {head:{sha:"base"},state:"open",html_url:"https://github.com/owner/repo/pull/7"}));
 try{assert.equal((await agentStatus(codingEnv,7)).validation,"unknown");}finally{globalThis.fetch=original;}
});

import {collectCI} from '../cloudflare/ci.js';
const passedCheck=(id=1,name='test')=>({id,name,head_sha:'base',status:'completed',conclusion:'success'});
async function ciFixture(run,{checks=[passedCheck()],statuses=[],required='["test"]',override}={}) {
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async url=>{
  calls.push(String(url));const u=new URL(url),page=Number(u.searchParams.get('page')||1);
  let data=u.pathname.endsWith('/check-runs')?{total_count:checks.length,check_runs:checks.slice((page-1)*100,page*100)}:
   {sha:'base',total_count:statuses.length,statuses:statuses.slice((page-1)*100,page*100)};
  if(override)data=override(u,data);
  return new Response(JSON.stringify(data));
 };
 try {await run(await collectCI({...codingEnv,AGENT_REQUIRED_CHECKS:required},'/repos/owner/repo','base'),calls);}
 finally{globalThis.fetch=old;}
}
test('required CI and legacy statuses must all succeed on the exact commit',async()=>{
 await ciFixture(r=>assert.equal(r.validation,'passed'));
 await ciFixture(r=>assert.equal(r.validation,'not_passed'),{statuses:[{id:8,context:'external-ci',state:'failure'}]});
 await ciFixture(r=>assert.equal(r.validation,'pending'),{statuses:[{id:8,context:'external-ci',state:'pending'}]});
 await ciFixture(r=>assert.equal(r.validation,'passed'),{statuses:[{id:8,context:'external-ci',state:'success'}]});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{required:'["test","typecheck"]'});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{required:'[]'});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{required:'bad json'});
});
test('skipped, neutral, cancelled and timed-out checks are not passes',async()=>{
 for(const conclusion of ['skipped','neutral','cancelled','timed_out','failure','action_required',null])
  await ciFixture(r=>assert.equal(r.validation,'not_passed',String(conclusion)),{checks:[{...passedCheck(),conclusion}]});
 await ciFixture(r=>assert.equal(r.validation,'pending'),{checks:[{...passedCheck(),status:'queued',conclusion:null}]});
});
test('CI reads failures after page one rather than trusting first 100 successes',async()=>{
 const checks=Array.from({length:101},(_,i)=>passedCheck(i+1,i===0?'test':'job'+i));checks[100].conclusion='failure';
 await ciFixture((r,calls)=>{assert.equal(r.validation,'not_passed');assert.ok(calls.some(u=>u.includes('page=2')));},{checks});
 const statuses=Array.from({length:101},(_,i)=>({id:i+1,context:'external'+i,state:i===100?'error':'success'}));
 await ciFixture(r=>assert.equal(r.validation,'not_passed'),{statuses});
});
test('malformed, changing, duplicate and wrong-SHA CI evidence stays unknown',async()=>{
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{checks:[{...passedCheck(),head_sha:'old'}]});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{checks:[passedCheck(),passedCheck()]});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{override:(u,d)=>u.pathname.endsWith('/status')?{...d,sha:'old'}:d});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{checks:Array.from({length:101},(_,i)=>passedCheck(i+1)),override:(u,d)=>u.searchParams.get('page')==='2'?{...d,total_count:102}:d});
 await ciFixture(r=>assert.equal(r.validation,'unknown'),{override:(u,d)=>({...d,total_count:501})});
});
test('a newly pushed PR commit invalidates an otherwise successful CI observation',async()=>{
 const old=globalThis.fetch;let pulls=0;
 globalThis.fetch=async url=>{
  const path=new URL(url).pathname;let data;
  if(path.endsWith('/pulls/7'))data={head:{sha:++pulls===1?'base':'new'},state:'open'};
  else if(path.endsWith('/status'))data={sha:'base',total_count:0,statuses:[]};
  else data={total_count:1,check_runs:[passedCheck()]};
  return new Response(JSON.stringify(data));
 };
 try{const r=await agentStatus(codingEnv,7);assert.equal(r.validation,'pending');assert.equal(r.head_sha,'new');assert.deepEqual(r.checks,[]);}
 finally{globalThis.fetch=old;}
});
test('test audit can veto implementation approval and both reviews rerun on the fixed patch',async()=>{
 await mockAgent([proposal(),{approved:true,issues:[]},{approved:false,issues:['Test does not exercise error path']},
  proposal('export const answer = 43;'),{approved:true,issues:[]},{approved:true,issues:[]}],async calls=>{
  const r=await agentAction(codingEnv,{task:'Fix answer calculation'});
  assert.deepEqual(r.trace.filter(t=>t.action==='review').map(t=>[t.stage,t.approved]),[['implementation',true],['tests',false],['implementation',true],['tests',true]]);
  const firstWrite=calls.findIndex(c=>c.path.endsWith('/git/blobs')&&c.method==='POST');
  assert.equal(calls.slice(0,firstWrite).filter(c=>c.path.endsWith('chat/completions')).length,6);
 });
});
test('implementation without regression tests returns to the author before any reviewer or write',async()=>{
 const missing=proposal();missing.edits.pop();
 await mockAgent([missing,proposal(),{approved:true,issues:[]},{approved:true,issues:[]}],async calls=>{
  const r=await agentAction(codingEnv,{task:'Fix answer calculation'});
  assert.ok(r.trace.some(t=>t.action==='regression_gate'&&!t.approved));
  const model=calls.filter(c=>c.path.endsWith('chat/completions'));
  assert.match(JSON.stringify(model[1].body.messages),/require a changed or new regression test/);
 });
});
test('contradictory review approval does not publish a patch',async()=>{
 await mockAgent([proposal(),{approved:true,issues:['Unfixed bug']}],async calls=>{
  await assert.rejects(agentAction(codingEnv,{task:'Fix answer calculation'}),/Invalid review/);
  assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.endsWith('chat/completions')).length,0);
 });
});
test('invalid JSON replacements, empty files and embedded NULs fail deterministic validation',()=>{
 for(const e of [{path:'package.json',content:'{"broken":}'},{path:'src/new.js',content:'  '},{path:'src/new.js',content:'x\0y'}])
  assert.throws(()=>validateEdits([e],new Map(),new Map()));
 assert.equal(validateEdits([{path:'data.json',content:'{"x":0}'}],new Map(),new Map()).length,1);
});

test('scheduled repair retries transient errors and records only completed outcomes',async()=>{
 const old=globalThis.fetch;let attempts=0,recorded=null;
 const pr={number:7,state:'open',head:{sha:'base',ref:'managpt/agent-x',repo:{full_name:'owner/repo'}}};
 const DB={prepare(sql){return {bind(){return this;},async first(){return recorded?{head_sha:recorded}:null;},async run(){if(sql.startsWith('INSERT'))recorded='base';}};}};
 globalThis.fetch=async url=>{
  const path=new URL(url).pathname;let d;
  if(path.endsWith('/pulls'))d=[pr];
  else if(path.endsWith('/pulls/7'))d=pr;
  else if(path.endsWith('/check-runs'))d={total_count:1,check_runs:[{...passedCheck(),conclusion:'failure'}]};
  else if(path.endsWith('/status'))d={sha:'base',total_count:0,statuses:[]};
  else if(path.endsWith('/comments')){attempts++;if(attempts===1)return new Response('{"message":"temporarily unavailable"}',{status:503});d=Array.from({length:3},()=>({body:'manaGPT repair attempt: prior'}));}
  else throw Error('Unexpected URL '+url);
  return new Response(JSON.stringify(d));
 };
 const originalError=console.error;console.error=()=>{};
 try {
  async function tick(){let task;await worker.scheduled({}, {...codingEnv,DB},{waitUntil(p){task=p;}});await task;}
  await tick();assert.equal(recorded,null);assert.equal(attempts,1);
  await tick();assert.equal(recorded,'base');assert.equal(attempts,2);
  await tick();assert.equal(attempts,2);
 }finally{globalThis.fetch=old;console.error=originalError;}
});

test('repository CI definitions are read before either reviewer evaluates test coverage',async()=>{
 await mockAgent([{action:"read",paths:["src/answer.js"]},proposal(),proposal(),{approved:true,issues:[]},{approved:true,issues:[]}],async calls=>{
  const r=await agentAction(codingEnv,{task:'Correct answer calculation'});
  assert.ok(r.read_paths.includes('.github/workflows/test.yml'));
  const audit=calls.find(c=>c.path.endsWith('chat/completions')&&c.body.messages[0].content.startsWith('Audit'));
  assert.match(JSON.stringify(audit.body),/node --test tests/);
 },{source:{'.github/workflows/test.yml':'steps:\n  - run: node --test tests/*.test.js\n','answer-a.md':'a','answer-b.md':'b','answer-c.md':'c'}});
});
