import test from "node:test";
import assert from "node:assert/strict";
import {
 DEFAULT_MODEL,LEGACY_FEATHERLESS_MODEL,LEGACY_GROQ_MODEL,
 inferenceReady,inferenceSettings,inferenceStatus,requestInference
} from "../cloudflare/inference.js";

const exact="huihui-ai/Huihui-Qwen3-Coder-Next-abliterated";
const custom={MANAGPT_INFERENCE_BASE_URL:"https://gpu.example.com/v1",MANAGPT_INFERENCE_API_KEY:"test-token"};

test("Huihui Qwen3 Coder Next is the target, but no unsupported provider is selected automatically",()=>{
 assert.equal(DEFAULT_MODEL,exact);
 assert.equal(inferenceReady({}),false);
 assert.equal(inferenceReady({GROQ_API_KEY:"g"}),true);
 assert.equal(inferenceReady({FEATHERLESS_API_KEY:"f"}),true);
 assert.equal(inferenceReady(custom),true);
 assert.deepEqual(inferenceStatus({}),{ready:false,provider:null,model:null,preferred_model:exact,fallback:false});
 assert.throws(()=>inferenceSettings({}),/No inference provider/);
});

test("configured OpenAI-compatible endpoint serves the exact new model and wins over legacy keys",async()=>{
 let upstream;const original=globalThis.fetch;
 globalThis.fetch=async (url,opts)=>{upstream={url,opts};return new Response("{}")};
 try{
  await requestInference({...custom,FEATHERLESS_API_KEY:"legacy",GROQ_API_KEY:"legacy"},
    {messages:[{role:"user",content:"hello"}],stream:false});
  assert.equal(upstream.url,"https://gpu.example.com/v1/chat/completions");
  assert.equal(upstream.opts.headers.Authorization,"Bearer test-token");
  assert.equal(JSON.parse(upstream.opts.body).model,exact);
  assert.deepEqual(inferenceStatus(custom),{ready:true,provider:"custom",model:exact,preferred_model:exact,fallback:false});
 }finally{globalThis.fetch=original}
});

test("custom endpoint model alias is explicit and status marks it as a different model",()=>{
 const configured={...custom,MANAGPT_INFERENCE_MODEL:"deployed-alias"};
 const result=inferenceSettings(configured);
 assert.equal(result.model,"deployed-alias");
 assert.equal(result.fallback,true);
 assert.equal(inferenceStatus(configured).model,"deployed-alias");
});

test("previous Featherless credentials still use the previous model unless explicitly overridden",async()=>{
 const original=globalThis.fetch;let upstream;
 globalThis.fetch=async(url,opts)=>{upstream={url,opts};return new Response("{}")};
 try{
  const env={FEATHERLESS_API_KEY:"old-key",MANAGPT_MODEL:exact,GROQ_API_KEY:"g"};
  await requestInference(env,{messages:[{role:"user",content:"hello"}],stream:true});
  assert.equal(upstream.url,"https://api.featherless.ai/v1/chat/completions");
  assert.equal(upstream.opts.headers.Authorization,"Bearer old-key");
  assert.equal(JSON.parse(upstream.opts.body).model,LEGACY_FEATHERLESS_MODEL);
  assert.equal(inferenceStatus(env).fallback,true);
  assert.equal(inferenceStatus(env).preferred_model,exact);
  assert.equal(inferenceSettings({...env,MANAGPT_FEATHERLESS_MODEL:exact}).model,exact);
 }finally{globalThis.fetch=original}
});

test("existing Groq credentials remain usable with the previous model, not 80B HF weights",async()=>{
 const original=globalThis.fetch;let upstream;
 globalThis.fetch=async(url,opts)=>{upstream={url,opts};return new Response("{}")};
 try{
  await requestInference({GROQ_API_KEY:"old-key",MANAGPT_MODEL:exact},
    {messages:[{role:"user",content:"hello"}],stream:false});
  assert.equal(upstream.url,"https://api.groq.com/openai/v1/chat/completions");
  assert.equal(upstream.opts.headers.Authorization,"Bearer old-key");
  assert.equal(JSON.parse(upstream.opts.body).model,LEGACY_GROQ_MODEL);
  assert.equal(inferenceStatus({GROQ_API_KEY:"old-key"}).fallback,true);
 }finally{globalThis.fetch=original}
});

test("custom inference endpoint must be a clean HTTPS /v1 URL",()=>{
 for (const value of [
  "http://gpu.example.com/v1","https://user:pass@gpu.example.com/v1",
  "https://gpu.example.com/other","invalid","https://gpu.example.com/v1?k=secret"
 ]){
  assert.throws(()=>inferenceSettings({...custom,MANAGPT_INFERENCE_BASE_URL:value}),/URL|HTTPS|\/v1/);
 }
});

test("vision still routes through separately configured vision-capable provider",()=>{
 const result=inferenceSettings({...custom,GROQ_API_KEY:"vision-key",MANAGPT_VISION_MODEL:"vision-model"},{vision:true});
 assert.equal(result.model,"vision-model");
 assert.equal(result.provider,"groq-vision");
 assert.equal(result.url,"https://api.groq.com/openai/v1/chat/completions");
});
