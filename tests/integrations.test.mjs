import test from "node:test";
import assert from "node:assert/strict";
import {buildAttachments,visibleText} from "../cloudflare/attachments.js";
import {agentAction} from "../cloudflare/agent.js";
import {githubSettings,githubEnvironment,sealToken,openToken} from "../cloudflare/github_settings.js";
import {conversations} from "../cloudflare/chat_sessions.js";
import worker from "../cloudflare/worker.js";

function mockDb(){
 const state={row:null,messages:[],session:{id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",title:"新しいチャット"}};
 const db={prepare(sql){
  let args=[];
  return {
   bind(...values){args=values;return this},
   async run(){
    if(sql.includes("INSERT INTO github_connection")){
     if(sql.includes("VALUES(1,'','','')"))state.row={login:"",cipher:"",repository:""};
     else if(sql.includes("VALUES (1,?,?,'')"))state.row={login:args[0],cipher:args[1],repository:""};
     else state.row={login:args[0],cipher:args[1],repository:args[2]};
    }
    if(sql.startsWith("UPDATE github_connection"))state.row.repository=args[0];
    if(sql.includes("INSERT INTO chat_turns"))state.messages.push({role:sql.includes("'user'")?"user":"assistant",content:args.at(-1)});
    return {};
   },
   async first(){
    if(sql.includes("FROM github_connection"))return state.row;
    if(sql.includes("FROM chat_sessions"))return state.session;
    return null;
   },
   async all(){if(sql.includes("FROM chat_turns"))return {results:[]};return {results:[]}}
  };
 },async batch(queries){for(const x of queries)await x.run()}};
 return {db,state};
}
const request=(path,method="GET",body)=>new Request("https://mana.test"+path,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
const path=r=>new URL(r.url);

test("text files are included for inference and retained but hidden in chat bubbles",()=>{
 const p=buildAttachments("説明して",[{name:"a.py",kind:"text",text:"print('hello')"}]);
 assert.match(p.modelContent,/print\('hello'\)/);
 assert.match(p.storedContent,/print\('hello'\)/);
 assert.equal(visibleText(p.storedContent),"説明して\n\n📎 a.py");
 assert.equal(p.images.length,0);
});
test("rejects oversized files, traversal filenames, unsupported binary and excessive count",()=>{
 assert.throws(()=>buildAttachments("x",Array(5).fill({name:"a.txt",kind:"text",text:"a"})),/four/);
 assert.throws(()=>buildAttachments("x",[{name:"../x",kind:"text",text:"a"}]),/filename/);
 assert.throws(()=>buildAttachments("x",[{name:"x.zip",kind:"binary",data:"a"}]),/Unsupported/);
 assert.throws(()=>buildAttachments("x",[{name:"x.txt",kind:"text",text:"x".repeat(30001)}]),/too long/);
});
test("accepts real PNG bytes and rejects mime mismatch",()=>{
 const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8R20AAAAASUVORK5CYII=";
 assert.equal(buildAttachments("画像",[{name:"one.png",kind:"image",mime:"image/png",data:png}]).images.length,1);
 assert.throws(()=>buildAttachments("画像",[{name:"fake.jpg",kind:"image",mime:"image/jpeg",data:png}]),/match/);
});
test("github token encryption round trip never exposes plaintext",async()=>{
 const env={MANAGPT_ACCESS_TOKEN:"long-encryption-key"};
 const ciphertext=await sealToken(env,"github_pat_sensitive_demo");
 assert.ok(!ciphertext.includes("sensitive"));
 assert.equal(await openToken(env,ciphertext),"github_pat_sensitive_demo");
 await assert.rejects(openToken({MANAGPT_ACCESS_TOKEN:"wrong"},ciphertext));
});
test("github connect, repo listing and selection, disconnect, and env override",async()=>{
 const original=globalThis.fetch,calls=[],{db,state}=mockDb();
 const env={DB:db,MANAGPT_ACCESS_TOKEN:"secret-value",GITHUB_TOKEN:"legacy",GITHUB_REPOSITORY:"old/old"};
 globalThis.fetch=async(url,options)=>{
  calls.push({url:String(url),header:options.headers.Authorization});
  const key=new URL(url).pathname;
  const value=key==="/user"?{login:"octocat"}:key==="/user/repos"?[
   {full_name:"octocat/repo",private:true,default_branch:"main",permissions:{push:true}},
   {full_name:"octocat/readonly",permissions:{push:false}}
  ]:{full_name:"octocat/repo",permissions:{push:true}};
  return new Response(JSON.stringify(value),{status:200});
 };
 try{
  const post=(name,body)=>githubSettings(request("/api/github/"+name,"POST",body),env,new URL("https://mana.test/api/github/"+name));
  let r=await post("connect",{token:"github_pat_sensitive_demo"});assert.equal(r.status,200);
  assert.ok(state.row.cipher&&!state.row.cipher.includes("sensitive"));
  r=await githubSettings(request("/api/github/status"),env,new URL("https://mana.test/api/github/status"));
  const status=await r.json();assert.equal(status.login,"octocat");assert.equal(status.repository,null);assert.equal(JSON.stringify(status).includes("github_pat"),false);
  r=await githubSettings(request("/api/github/repositories"),env,new URL("https://mana.test/api/github/repositories"));
  assert.deepEqual((await r.json()).repositories.map(x=>x.full_name),["octocat/repo"]);
  r=await post("select",{repository:"octocat/repo"});assert.equal(r.status,200);
  assert.equal((await githubEnvironment(env)).GITHUB_REPOSITORY,"octocat/repo");
  assert.equal((await githubEnvironment(env)).GITHUB_TOKEN,"github_pat_sensitive_demo");
  r=await post("disconnect",{});assert.equal(r.status,200);
  assert.equal((await githubEnvironment(env)).GITHUB_TOKEN,"");
  assert.ok(calls.every(c=>c.header==="Bearer github_pat_sensitive_demo"));
 }finally{globalThis.fetch=original}
});
test("chat PDF-extracted text reaches the model and streams into saved conversation",async()=>{
 const original=globalThis.fetch,{db,state}=mockDb();let upstream;
 const env={DB:db,MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",MANAGPT_INFERENCE_API_KEY:"dummy",MANAGPT_MODEL:"test-model"};
 globalThis.fetch=async(_url,options)=>{
  upstream=JSON.parse(options.body);
  const s='data: {"choices":[{"delta":{"content":"読みました"}}]}\n\ndata: [DONE]\n\n';
  return new Response(s,{status:200,headers:{"content-type":"text/event-stream"}});
 };
 try{
  const r=await conversations(request("/api/conversations/"+state.session.id+"/messages","POST",{message:"確認",attachments:[{name:"test.pdf",kind:"text",text:"PDFの本文"}]}),env,new URL("https://mana.test/api/conversations/"+state.session.id+"/messages"));
  const text=await r.text();assert.match(text,/event: done/);
  assert.match(upstream.messages.at(-1).content,/PDFの本文/);
  assert.equal(state.messages.length,2);
  assert.match(state.messages[0].content,/test.pdf/);
 }finally{globalThis.fetch=original}
});
test("worker GitHub settings endpoint works before Groq is configured",async()=>{
 const {db}=mockDb();const env={DB:db,MANAGPT_ACCESS_TOKEN:"secret"};
 const r=await worker.fetch(new Request("https://mana.test/api/github/status",{headers:{Authorization:"Bearer secret"}}),env);
 assert.equal(r.status,200);assert.equal((await r.json()).connected,false);
});

test("coding mode validates selected repo and attached image model before network calls",async()=>{
 const base={GITHUB_TOKEN:"test",GITHUB_REPOSITORY:"owner/demo"};
 await assert.rejects(agentAction(base,{task:"Fix the tests",repository:"owner/other"}),/Selected repository changed/);
 await assert.rejects(agentAction(base,{task:"Fix the tests",attachments:[{name:"../../oops",kind:"text",text:"x"}]}),/filename/);
 const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8R20AAAAASUVORK5CYII=";
 await assert.rejects(agentAction(base,{task:"Fix the tests",attachments:[{name:"bug.png",kind:"image",mime:"image/png",data:png}]}),/MANAGPT_VISION_MODEL/);
});
test("coding-mode attachments reach model and selected repository is used in PR creation",async()=>{
 const original=globalThis.fetch,seen=[];
 const base64=Buffer.from("export const answer = 1;\n").toString("base64");
 globalThis.fetch=async (url,options={})=>{
  const u=String(url),method=options.method||"GET";
  seen.push({url:u,method,body:options.body});
  const data=u.includes("gpu.example.com")?
   {choices:[{message:{content:JSON.stringify({edits:[{path:"src/index.js",content:"export const answer = 2;\n"}]})}}]}:
   u.endsWith("/repos/owner/demo")?{default_branch:"main"}:
   u.endsWith("/git/ref/heads/main")?{object:{sha:"commit-sha"}}:
   u.endsWith("/git/commits/commit-sha")?{tree:{sha:"tree-sha"}}:
   u.includes("/git/trees/tree-sha")?{tree:[{type:"blob",size:100,path:"src/index.js",sha:"blob-sha"}],truncated:false}:
   u.includes("/contents/src/index.js")&&method==="GET"?{content:base64}:
   u.endsWith("/git/refs")?{ref:"refs/heads/managpt/agent-test"}:
   u.endsWith("/contents/src/index.js")&&method==="PUT"?{commit:{sha:"new-commit"}}:
   u.endsWith("/pulls")&&method==="POST"?{html_url:"https://github.com/owner/demo/pull/7",number:7}:
   {message:"Unexpected "+u};
  return new Response(JSON.stringify(data),{status:data.message?404:200});
 };
 try{
  const env={GITHUB_TOKEN:"fake",GITHUB_REPOSITORY:"owner/demo",MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",MANAGPT_INFERENCE_API_KEY:"fake",MANAGPT_MODEL:"test-model"};
  const result=await agentAction(env,{task:"Fix the index output",repository:"owner/demo",attachments:[
   {name:"error.log",kind:"text",text:"Expected answer to be 2, received 1"}
  ]});
  assert.equal(result.pr_number,7);
  const inference=JSON.parse(seen.find(x=>x.url.includes("gpu.example.com")).body);
  assert.match(inference.messages[1].content,/Expected answer to be 2/);
  assert.match(inference.messages[1].content,/error.log/);
  assert.equal(inference.model,"huihui-ai/Huihui-Qwen3-Coder-Next-abliterated");
  assert.ok(seen.some(x=>x.url.endsWith("/repos/owner/demo/pulls")&&x.method==="POST"));
  assert.ok(!seen.some(x=>x.url.includes("/repos/owner/other")));
  const pr=JSON.parse(seen.find(x=>x.url.endsWith("/pulls")&&x.method==="POST").body);
  assert.ok(!pr.body.includes("received 1"),"attachment contents must not leak into PR description");
 }finally{globalThis.fetch=original}
});
test("coding mode never forwards images to an old vision model",async()=>{
 const original=globalThis.fetch;let inferenceCalls=0;
 const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8R20AAAAASUVORK5CYII=";
 globalThis.fetch=async (url)=>{
  const u=String(url);
  if(u.includes("groq.com")||u.includes("gpu.example.com")){
    inferenceCalls++;return new Response("{}");
  }
  const data=u.endsWith("/repos/owner/demo")?{default_branch:"main"}:
   u.endsWith("/git/ref/heads/main")?{object:{sha:"commit-sha"}}:
   u.endsWith("/git/commits/commit-sha")?{tree:{sha:"tree-sha"}}:
   u.includes("/git/trees/tree-sha")?{tree:[{type:"blob",size:100,path:"src/index.js",sha:"blob-sha"}],truncated:false}:
   u.includes("/contents/src/index.js")?{content:Buffer.from("console.log(1)").toString("base64")}:
   {message:"Unexpected request"};
  return new Response(JSON.stringify(data),{status:data.message?404:200});
 };
 try{
  await assert.rejects(agentAction({GITHUB_TOKEN:"fake",GITHUB_REPOSITORY:"owner/demo",
    MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",MANAGPT_INFERENCE_API_KEY:"key",
    GROQ_API_KEY:"old",MANAGPT_VISION_MODEL:"old-vision"},{
    task:"Fix screenshot layout",attachments:[{name:"screenshot.png",kind:"image",mime:"image/png",data:png}]
  }),/does not support image inputs/);
  assert.equal(inferenceCalls,0);
 }finally{globalThis.fetch=original}
});
