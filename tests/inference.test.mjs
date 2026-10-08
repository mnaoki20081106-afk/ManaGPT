import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_MODEL,inferenceReady,inferenceSettings,requestInference} from "../cloudflare/inference.js";

const env={
 MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",
 MANAGPT_INFERENCE_API_KEY:"demo-key"
};

test("requested model is the default and missing dedicated endpoint never falls back to Groq",()=>{
 assert.equal(DEFAULT_MODEL,"cooperleong00/Qwen3-8B-Jailbroken");
 assert.equal(inferenceReady({GROQ_API_KEY:"legacy"}),false);
 assert.throws(()=>inferenceSettings({GROQ_API_KEY:"legacy"}),/MANAGPT_INFERENCE_BASE_URL/);
 assert.equal(inferenceSettings(env).model,DEFAULT_MODEL);
});
test("requests go to the configured HTTPS endpoint with the requested model",async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{message:{content:"ok"}}]}))};
 try {
  const r=await requestInference(env,{messages:[{role:"user",content:"hi"}],stream:false});
  assert.equal(r.status,200);
  assert.equal(captured.url,"https://gpu.example.com/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization,"Bearer demo-key");
  const body=JSON.parse(captured.options.body);
  assert.equal(body.model,DEFAULT_MODEL);
  assert.equal(body.stream,false);
  assert.equal(body.messages[0].content,"hi");
 } finally {globalThis.fetch=original}
});
test("inference endpoint rejects non-HTTPS URLs and URL credentials",()=>{
 for(const u of ["http://gpu.example.com/v1","https://user:pass@gpu.example.com/v1","https://gpu.example.com/api","garbage","https://gpu.example.com/v1?key=secret"]){
  assert.throws(()=>inferenceSettings({...env,MANAGPT_INFERENCE_BASE_URL:u}),/URL|HTTPS|\/v1/);
 }
});
test("optional image routing uses the configured vision model without changing the text model",()=>{
 const cfg=inferenceSettings({...env,MANAGPT_VISION_MODEL:"vision-id",GROQ_API_KEY:"vision-key"},{vision:true});
 assert.equal(cfg.model,"vision-id");
 assert.equal(cfg.url,"https://api.groq.com/openai/v1/chat/completions");
 assert.equal(inferenceSettings(env).model,DEFAULT_MODEL);
});
