// Shared OpenAI-compatible inference router. Report the model actually requested.
// New exact model requires an inference server that really hosts these HF weights.
// Keep legacy Featherless and Groq working unless users explicitly configure new hosting.
export const DEFAULT_MODEL = "huihui-ai/Huihui-Qwen3-Coder-Next-abliterated";
export const LEGACY_FEATHERLESS_MODEL = "cooperleong00/Qwen3-8B-Jailbroken";
export const LEGACY_GROQ_MODEL = "qwen/qwen3.8-27b";
const present = value => typeof value === "string" && value.trim().length > 0;

export function inferenceReady(env) {
 return Boolean(
  (present(env?.MANAGPT_INFERENCE_BASE_URL) && present(env?.MANAGPT_INFERENCE_API_KEY)) ||
  present(env?.FEATHERLESS_API_KEY) ||
  present(env?.GROQ_API_KEY)
 );
}

export function inferenceSettings(env, {vision=false}={}) {
 if (vision) {
  if (!present(env?.MANAGPT_VISION_MODEL) || !present(env?.GROQ_API_KEY))
   throw Error("MANAGPT_VISION_MODEL and GROQ_API_KEY are required for image requests");
  return {url:"https://api.groq.com/openai/v1/chat/completions",
    key:env.GROQ_API_KEY,model:env.MANAGPT_VISION_MODEL,provider:"groq-vision",fallback:false};
 }
 if (present(env?.MANAGPT_INFERENCE_BASE_URL) && present(env?.MANAGPT_INFERENCE_API_KEY)) {
  let url;
  try { url=new URL(env.MANAGPT_INFERENCE_BASE_URL); }
  catch { throw Error("Invalid MANAGPT_INFERENCE_BASE_URL"); }
  if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || !url.hostname)
   throw Error("MANAGPT_INFERENCE_BASE_URL must be a clean HTTPS URL");
  const base=url.toString().replace(/\/+$/,"");
  if(!base.endsWith("/v1"))throw Error("MANAGPT_INFERENCE_BASE_URL must end with /v1");
  const model=env.MANAGPT_INFERENCE_MODEL || env.MANAGPT_MODEL || DEFAULT_MODEL;
  return {url:base+"/chat/completions",key:env.MANAGPT_INFERENCE_API_KEY,
    model,provider:"custom",fallback:model!==DEFAULT_MODEL};
 }
 if (present(env?.FEATHERLESS_API_KEY)) {
  // Do not assume the new 80B model is available on Featherless.
  // Preserve the former served model by default; changing it is explicit.
  const model=env.MANAGPT_FEATHERLESS_MODEL || LEGACY_FEATHERLESS_MODEL;
  return {url:"https://api.featherless.ai/v1/chat/completions",
    key:env.FEATHERLESS_API_KEY,model,provider:"featherless",fallback:model!==DEFAULT_MODEL};
 }
 if (present(env?.GROQ_API_KEY)) {
  // The exact HF model is not served by Groq. Preserve the previous provider.
  const model=env.MANAGPT_GROQ_MODEL || LEGACY_GROQ_MODEL;
  return {url:"https://api.groq.com/openai/v1/chat/completions",
    key:env.GROQ_API_KEY,model,provider:"groq",fallback:model!==DEFAULT_MODEL};
 }
 throw Error("No inference provider configured: set MANAGPT_INFERENCE_BASE_URL and MANAGPT_INFERENCE_API_KEY for the Huihui model, or configure an existing compatible provider");
}

// No credentials, internal URLs, or tokens are exposed by the authenticated status API.
export function inferenceStatus(env) {
 if(!inferenceReady(env)) return {ready:false,provider:null,model:null,
   preferred_model:DEFAULT_MODEL,fallback:false};
 const {provider,model,fallback}=inferenceSettings(env);
 return {ready:true,provider,model,preferred_model:DEFAULT_MODEL,fallback};
}

export function requestInference(env, payload, options={}) {
 const {url,key,model}=inferenceSettings(env,options);
 return fetch(url,{
  method:"POST",
  headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({...payload,model})
 });
}
