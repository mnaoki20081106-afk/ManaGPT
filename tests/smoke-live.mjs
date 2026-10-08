// Public production smoke test. Does not require API keys or expose secrets.
import assert from "node:assert/strict";
const origin=(process.env.MANAGPT_LIVE_URL||"https://managpt.mnaoki0021.workers.dev").replace(/\/$/,"");
if(!origin.startsWith("https://"))throw Error("HTTPS URL required");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function probe(path){
 const response=await fetch(origin+path,{signal:AbortSignal.timeout(12000),redirect:"error",headers:{"cache-control":"no-cache"}});
 return {status:response.status,type:response.headers.get("content-type")||"",text:await response.text()};
}
async function check(){
 const health=await probe("/health");
 assert.equal(health.status,200,"health HTTP");
 assert.equal(JSON.parse(health.text).ok,true,"health body");
 const page=await probe("/");
 assert.equal(page.status,200,"index HTTP");
 for(const id of ['id="attach-btn"','id="file-input"','id="github-repository"','id="github-connect"']){
  assert.ok(page.text.includes(id),"Missing UI control: "+id);
 }
 assert.ok(page.text.includes('src="/extras.js"'),"UI helper not loaded");
 const extras=await probe("/extras.js");
 assert.equal(extras.status,200,"extras.js HTTP");
 assert.ok(extras.text.includes("window.loadGithubSettings"),"Settings UI helper absent");
 const denied=await probe("/api/github/status");
 assert.equal(denied.status,401,"GitHub API must require MANAGPT_ACCESS_TOKEN");
 return {health:health.status,ui:page.status,extras:extras.status,auth:denied.status};
}
let last;
for(let attempt=1;attempt<=6;attempt++){
 try{
  const state=await check();
  console.log("PASS live production smoke:",origin,JSON.stringify(state));
  process.exit(0);
 }catch(error){
  last=error;
  console.error("Smoke attempt",attempt,"failed:",String(error.message||error));
  if(attempt<6)await wait(3000);
 }
}
throw last;
