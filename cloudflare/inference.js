// One inference routing point shared by chat, research, coding and repair.
// The requested model is not offered through Groq or public HF inference providers.
// Serve it on a dedicated OpenAI-compatible HTTPS endpoint (e.g. vLLM).
export const DEFAULT_MODEL = "cooperleong00/Qwen3-8B-Jailbroken";

export const inferenceReady = env =>
 Boolean(env?.MANAGPT_INFERENCE_BASE_URL?.trim() && env?.MANAGPT_INFERENCE_API_KEY?.trim());

export function inferenceSettings(env, {vision=false}={}) {
 if (vision) {
  if (!env.MANAGPT_VISION_MODEL || !env.GROQ_API_KEY)
   throw Error("MANAGPT_VISION_MODEL and GROQ_API_KEY are required for image requests");
  return {url:"https://api.groq.com/openai/v1/chat/completions",key:env.GROQ_API_KEY,model:env.MANAGPT_VISION_MODEL};
 }
 if (!inferenceReady(env))
  throw Error("Configure MANAGPT_INFERENCE_BASE_URL and MANAGPT_INFERENCE_API_KEY to serve cooperleong00/Qwen3-8B-Jailbroken");
 let url;
 try { url=new URL(env.MANAGPT_INFERENCE_BASE_URL); }
 catch { throw Error("Invalid MANAGPT_INFERENCE_BASE_URL"); }
 if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || !url.hostname)
  throw Error("MANAGPT_INFERENCE_BASE_URL must be a clean HTTPS URL");
 const base=url.toString().replace(/\/+$/,"");
 if(!base.endsWith("/v1"))throw Error("MANAGPT_INFERENCE_BASE_URL must end with /v1");
 return {url:base+"/chat/completions",key:env.MANAGPT_INFERENCE_API_KEY,model:env.MANAGPT_MODEL||DEFAULT_MODEL};
}

export function requestInference(env, payload, options={}) {
 const {url,key,model}=inferenceSettings(env,options);
 return fetch(url,{
  method:"POST",
  headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({...payload,model})
 });
}
