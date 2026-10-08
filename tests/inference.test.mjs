import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_MODEL,inferenceReady,inferenceSettings,inferenceStatus,requestInference} from "../cloudflare/inference.js";

const target="huihui-ai/Huihui-Qwen3-Coder-Next-abliterated";
const env={MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",
 MANAGPT_INFERENCE_API_KEY:"demo-key"};

test("only Huihui Coder Next is allowed",()=>{
 assert.equal(DEFAULT_MODEL,target);
 assert.equal(inferenceReady(env),true);
 assert.equal(inferenceReady({}),false);
 assert.equal(inferenceReady({GROQ_API_KEY:"legacy"}),false);
 assert.equal(inferenceReady({FEATHERLESS_API_KEY:"legacy"}),false);
 assert.deepEqual(inferenceStatus({}),{ready:false,provider:null,model:null,preferred_model:target,fallback:false});
 assert.throws(()=>inferenceSettings({}),/Huihui inference endpoint is not configured/);
});

test("inference calls use the exact target model regardless of override variables",async()=>{
 const original=globalThis.fetch;let seen;
 globalThis.fetch=async(url,options)=>{seen={url,options};return new Response("{}")};
 try{
  const r=await requestInference({...env,MANAGPT_MODEL:"some-other-model",
    MANAGPT_INFERENCE_MODEL:"alias",FEATHERLESS_API_KEY:"ignored",GROQ_API_KEY:"ignored"},
    {messages:[{role:"user",content:"Hello"}],stream:false});
  assert.equal(r.status,200);
  assert.equal(seen.url,"https://gpu.example.com/v1/chat/completions");
  assert.equal(seen.options.headers.Authorization,"Bearer demo-key");
  const body=JSON.parse(seen.options.body);
  assert.equal(body.model,target);
  assert.equal(body.messages[0].content,"Hello");
  assert.equal(inferenceStatus(env).model,target);
  assert.equal(inferenceStatus(env).fallback,false);
 }finally{globalThis.fetch=original}
});

test("bad endpoint is not silently replaced by an old provider",()=>{
 for(const url of ["http://gpu.example.com/v1",
  "https://user:pass@gpu.example.com/v1","https://gpu.example.com/api",
  "not-a-url","https://gpu.example.com/v1?token=abc"]){
  assert.throws(()=>inferenceSettings({...env,MANAGPT_INFERENCE_BASE_URL:url,
   GROQ_API_KEY:"old"}),/URL|HTTPS|\/v1/);
 }
});

test("image inference never uses a different model",()=>{
 assert.throws(()=>inferenceSettings({...env,MANAGPT_VISION_MODEL:"old-vision",GROQ_API_KEY:"old-key"},
  {vision:true}),/does not support image inputs/);
});
