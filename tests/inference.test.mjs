import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_MODEL,LEGACY_GROQ_MODEL,inferenceReady,inferenceSettings,inferenceStatus,requestInference}
 from "../cloudflare/inference.js";

const env={
 MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",
 MANAGPT_INFERENCE_API_KEY:"demo-key"
};

test("exact requested model is preferred; Groq-only installations remain operational and explicitly report the fallback",()=>{
 assert.equal(DEFAULT_MODEL,"cooperleong00/Qwen3-8B-Jailbroken");
 assert.equal(inferenceReady({GROQ_API_KEY:"legacy"}),true);
 assert.equal(inferenceReady({}),false);
 const status=inferenceStatus({GROQ_API_KEY:"legacy",MANAGPT_MODEL:DEFAULT_MODEL});
 assert.deepEqual(status,{ready:true,provider:"groq",model:LEGACY_GROQ_MODEL,
  preferred_model:DEFAULT_MODEL,fallback:true});
 assert.equal(inferenceSettings(env).model,DEFAULT_MODEL);
 assert.equal(inferenceStatus({}).ready,false);
 assert.throws(()=>inferenceSettings({}),/FEATHERLESS_API_KEY/);
});
test("custom endpoint is used when configured",async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:"ok"}}]}))};
 try {
  const r=await requestInference({...env,GROQ_API_KEY:"groq"}, {messages:[{role:"user",content:"hi"}],stream:false});
  assert.equal(r.status,200);
  assert.equal(captured.url,"https://gpu.example.com/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization,"Bearer demo-key");
  const body=JSON.parse(captured.options.body);
  assert.equal(body.model,DEFAULT_MODEL);
  assert.equal(body.stream,false);
  assert.equal(body.messages[0].content,"hi");
 } finally {globalThis.fetch=original}
});
test("Featherless hosts the requested model using only FEATHERLESS_API_KEY",async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response("{}")};
 try{
  await requestInference({FEATHERLESS_API_KEY:"featherless-token",GROQ_API_KEY:"legacy"},
    {messages:[{role:"user",content:"hello"}],stream:true});
  assert.equal(captured.url,"https://api.featherless.ai/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization,"Bearer featherless-token");
  assert.equal(JSON.parse(captured.options.body).model,DEFAULT_MODEL);
  assert.equal(inferenceStatus({FEATHERLESS_API_KEY:"token"}).fallback,false);
 }finally{globalThis.fetch=original}
});
test("Groq-only deployment uses previous model, not the requested HF model",async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response("{}")};
 try {
  await requestInference({GROQ_API_KEY:"old-key",MANAGPT_MODEL:DEFAULT_MODEL},
    {messages:[{role:"user",content:"hello"}],stream:false});
  assert.equal(captured.url,"https://api.groq.com/openai/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization,"Bearer old-key");
  assert.equal(JSON.parse(captured.options.body).model,LEGACY_GROQ_MODEL);
 }finally{globalThis.fetch=original}
});
test("explicit endpoint takes priority over Featherless and Groq",()=>{
 const c=inferenceSettings({...env,FEATHERLESS_API_KEY:"f",GROQ_API_KEY:"g"});
 assert.equal(c.provider,"custom");
 assert.equal(c.fallback,false);
});
test("inference endpoint rejects non-HTTPS URLs and URL credentials",()=>{
 for(const u of ["http://gpu.example.com/v1","https://user:pass@gpu.example.com/v1","https://gpu.example.com/api","garbage","https://gpu.example.com/v1?key=secret"]){
  assert.throws(()=>inferenceSettings({...env,MANAGPT_INFERENCE_BASE_URL:u}),/URL|HTTPS|\/v1/);
 }
});
test("optional image routing uses separately configured vision model",()=>{
 const cfg=inferenceSettings({...env,MANAGPT_VISION_MODEL:"vision-id",GROQ_API_KEY:"vision-key"},{vision:true});
 assert.equal(cfg.model,"vision-id");
 assert.equal(cfg.url,"https://api.groq.com/openai/v1/chat/completions");
 assert.equal(inferenceSettings(env).model,DEFAULT_MODEL);
});
