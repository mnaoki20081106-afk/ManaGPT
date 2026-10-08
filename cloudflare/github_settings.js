const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const repoPattern=/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const enc=new TextEncoder();
async function init(db){
 await db.prepare("CREATE TABLE IF NOT EXISTS github_connection (id INTEGER PRIMARY KEY CHECK(id=1), login TEXT NOT NULL DEFAULT '', cipher TEXT NOT NULL DEFAULT '', repository TEXT NOT NULL DEFAULT '')").run();
}
async function key(env){
 if(!env.MANAGPT_ACCESS_TOKEN)throw Error("Access token secret is not configured");
 const bytes=await crypto.subtle.digest("SHA-256",enc.encode("manaGPT github settings v1:"+env.MANAGPT_ACCESS_TOKEN));
 return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
const base64=arr=>btoa(Array.from(arr,b=>String.fromCharCode(b)).join(""));
const unbase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function sealToken(env,token){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(env),enc.encode(token)));
 return base64(iv)+"."+base64(cipher);
}
export async function openToken(env,value){
 const [iv,cipher]=value.split(".");
 if(!iv||!cipher)throw Error("Stored GitHub credential is invalid");
 const text=await crypto.subtle.decrypt({name:"AES-GCM",iv:unbase64(iv)},await key(env),unbase64(cipher));
 return new TextDecoder().decode(text);
}
export async function githubRequest(token,path,options={}){
 const res=await fetch("https://api.github.com"+path,{...options,headers:{"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"manaGPT-settings",...(options.headers||{})}});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error("GitHub API "+res.status+": "+(data.message||"request failed"));
 return data;
}
async function readRow(env){await init(env.DB);return env.DB.prepare("SELECT login,cipher,repository FROM github_connection WHERE id=1").first()}
export async function githubEnvironment(env){
 const row=await readRow(env);
 if(!row)return env;
 return {...env,GITHUB_TOKEN:row.cipher?await openToken(env,row.cipher):"",GITHUB_REPOSITORY:row.repository||""};
}
export async function githubSettings(request,env,url){
 try{
 const action=url.pathname.slice("/api/github/".length),method=request.method;
 if(action==="status"&&method==="GET"){
  const row=await readRow(env);
  if(row)return json({connected:!!row.cipher,login:row.login||null,repository:row.repository||null,source:"settings"});
  return json({connected:!!(env.GITHUB_TOKEN&&env.GITHUB_REPOSITORY),login:null,repository:env.GITHUB_REPOSITORY||null,source:"environment"});
 }
 if(action==="connect"&&method==="POST"){
  const b=await request.json().catch(()=>({}));
  const token=b.token;
  if(typeof token!=="string"||token.length<12||token.length>512||!token.trim()||token!==token.trim())return json({error:"GitHub token is invalid"},400);
  const user=await githubRequest(token,"/user");
  if(!user||typeof user.login!=="string")throw Error("GitHub account could not be verified");
  const cipher=await sealToken(env,token);
  await init(env.DB);
  await env.DB.prepare("INSERT INTO github_connection(id,login,cipher,repository) VALUES (1,?,?,'') ON CONFLICT(id) DO UPDATE SET login=excluded.login,cipher=excluded.cipher,repository=''").bind(user.login,cipher).run();
  return json({connected:true,login:user.login,repository:null});
 }
 if(action==="repositories"&&method==="GET"){
  const resolved=await githubEnvironment(env);
  if(!resolved.GITHUB_TOKEN)return json({error:"Connect GitHub in Settings first"},409);
  const repos=[];
  for(let page=1;page<=5;page++){
   const data=await githubRequest(resolved.GITHUB_TOKEN,"/user/repos?per_page=100&page="+page+"&sort=updated&affiliation=owner,collaborator,organization_member");
   if(!Array.isArray(data))throw Error("Unexpected GitHub response");
   for(const r of data)if(r.permissions?.push&&!r.archived&&repoPattern.test(r.full_name))repos.push({full_name:r.full_name,private:!!r.private,default_branch:r.default_branch||"main"});
   if(data.length<100)break;
  }
  return json({repositories:repos});
 }
 if(action==="select"&&method==="POST"){
  const b=await request.json().catch(()=>({}));
  if(typeof b.repository!=="string"||!repoPattern.test(b.repository))return json({error:"Invalid repository"},400);
  const resolved=await githubEnvironment(env);
  if(!resolved.GITHUB_TOKEN)return json({error:"Connect GitHub first"},409);
  const repo=await githubRequest(resolved.GITHUB_TOKEN,"/repos/"+b.repository);
  if(repo.full_name!==b.repository||repo.archived||repo.permissions?.push!==true)return json({error:"Write access to this repository is required"},403);
  await init(env.DB);
  const row=await readRow(env);
  if(!row||!row.cipher){
   const user=await githubRequest(resolved.GITHUB_TOKEN,"/user");
   await env.DB.prepare("INSERT INTO github_connection(id,login,cipher,repository) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,cipher=excluded.cipher,repository=excluded.repository").bind(user.login,await sealToken(env,resolved.GITHUB_TOKEN),b.repository).run();
  }else await env.DB.prepare("UPDATE github_connection SET repository=? WHERE id=1").bind(b.repository).run();
  return json({connected:true,repository:b.repository});
 }
 if(action==="disconnect"&&method==="POST"){
  await init(env.DB);
  await env.DB.prepare("INSERT INTO github_connection(id,login,cipher,repository) VALUES(1,'','','') ON CONFLICT(id) DO UPDATE SET login='',cipher='',repository=''").run();
  return json({connected:false,repository:null});
 }
 return json({error:"Not found"},404);
 }catch(e){return json({error:String(e.message||e)},400)}
}
