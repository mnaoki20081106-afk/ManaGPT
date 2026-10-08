// ManaGPT: strict single-model inference. Never silently use other model weights.
export const DEFAULT_MODEL = "huihui-ai/Huihui-Qwen3-Coder-Next-abliterated";
const present = value => typeof value === "string" && value.trim().length > 0;

export const inferenceReady = env =>
 Boolean(present(env?.MANAGPT_INFERENCE_BASE_URL) && present(env?.MANAGPT_INFERENCE_API_KEY));

export function inferenceSettings(env, {vision=false}={}) {
 if(vision) throw Error("Huihui-Qwen3-Coder-Next-abliterated does not support image inputs in ManaGPT");
 if(!inferenceReady(env))
  throw Error("Huihui inference endpoint is not configured: set MANAGPT_INFERENCE_BASE_URL and MANAGPT_INFERENCE_API_KEY");
 let url;
 try { url=new URL(env.MANAGPT_INFERENCE_BASE_URL); }
 catch { throw Error("Invalid MANAGPT_INFERENCE_BASE_URL"); }
 if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || !url.hostname)
  throw Error("MANAGPT_INFERENCE_BASE_URL must be a clean HTTPS URL");
 const base=url.toString().replace(/\/+$/,"");
 if(!base.endsWith("/v1"))
  throw Error("MANAGPT_INFERENCE_BASE_URL must end with /v1");
 return {url:base+"/chat/completions",key:env.MANAGPT_INFERENCE_API_KEY,
  model:DEFAULT_MODEL,provider:"custom",fallback:false};
}

// Only authenticated callers see model status; never expose credentials or endpoint URLs.
export function inferenceStatus(env) {
 if(!inferenceReady(env))return {ready:false,provider:null,model:null,
  preferred_model:DEFAULT_MODEL,fallback:false};
 const {provider,model,fallback}=inferenceSettings(env);
 return {ready:true,provider,model,preferred_model:DEFAULT_MODEL,fallback};
}

export function requestInference(env,payload,options={}) {
 const {url,key,model}=inferenceSettings(env,options);
 return fetch(url,{
  method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({...payload,model})
 });
}
