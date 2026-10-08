import test from "node:test";
import assert from "node:assert/strict";
import {validateCredentials, injectDatabaseId, findDatabase, cloudflareRequest, prepareDeployment} from "./cloudflare-preflight.mjs";

const account = "a".repeat(32);
const uuid = "12345678-1234-1234-1234-123456789abc";
const config = JSON.stringify({d1_databases:[{binding:"DB",database_name:"managpt"}]});
const good = result => ({ok:true,status:200,json:async()=>({success:true,result})});

test("validates account ID and token whitespace",()=>{
 assert.doesNotThrow(()=>validateCredentials("token123",account));
 assert.throws(()=>validateCredentials(" token123 ",account),/whitespace/);
 assert.throws(()=>validateCredentials("token123","not-an-account-id"),/32-character/);
});
test("adds verified D1 database id without mutating input",()=>{
 assert.equal(JSON.parse(injectDatabaseId(config,uuid)).d1_databases[0].database_id,uuid);
 assert.equal(JSON.parse(config).d1_databases[0].database_id,undefined);
 assert.throws(()=>injectDatabaseId(config,"invalid"),/UUID/);
});
test("selects matching database only",()=>{
 assert.equal(findDatabase([{name:"other",uuid},{name:"managpt",uuid}],"managpt"),uuid);
 assert.throws(()=>findDatabase([],"managpt"),/not found/);
});
test("reports invalid API Token 9109 without leaking credentials",async()=>{
 await assert.rejects(cloudflareRequest(async()=>({ok:false,status:403,json:async()=>({success:false,errors:[{code:9109}]})}),"private-token","/user/tokens/verify"),/INVALID/);
});
test("preflight reuses existing D1 database",async()=>{
 const calls=[];let written;
 const fetchFn=async(url,opts)=>{
  calls.push([url,opts.method||"GET"]);
  if(url.endsWith("/user/tokens/verify"))return good({status:"active"});
  if(url.includes("/d1/database?"))return good([{name:"managpt",uuid}]);
  throw Error("unexpected request");
 };
 await prepareDeployment({token:"token123",accountId:account,fetchFn,readFile:async()=>config,writeFile:async(path,value)=>{written=[path,value]}});
 assert.equal(calls.length,2);
 assert.equal(written[0],"wrangler.deploy.jsonc");
 assert.equal(JSON.parse(written[1]).d1_databases[0].database_id,uuid);
});
test("preflight creates D1 database once when missing",async()=>{
 const methods=[];
 const fetchFn=async(url,opts)=>{
  methods.push(opts.method||"GET");
  if(url.endsWith("/user/tokens/verify"))return good({status:"active"});
  if(url.includes("/d1/database?"))return good([]);
  if(url.endsWith("/d1/database")&&opts.method==="POST")return good({name:"managpt",uuid});
  throw Error("unexpected request");
 };
 await prepareDeployment({token:"token123",accountId:account,fetchFn,readFile:async()=>config,writeFile:async()=>{}});
 assert.deepEqual(methods,["GET","GET","POST"]);
});
