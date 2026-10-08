import {gh} from './coding.js';

// Read the complete bounded list. Missing/moving/duplicate pages never certify a commit.
async function pages(env, url, key, sha) {
 const rows=[], ids=new Set(); let total;
 for(let page=1;page<=5;page++) {
  const data=await gh(env,url+(url.includes('?')?'&':'?')+'per_page=100&page='+page);
  const list=data[key];
  if(!Number.isSafeInteger(data.total_count)||data.total_count<0||data.total_count>500||!Array.isArray(list)||
     (total!==undefined&&data.total_count!==total)||(key==='statuses'&&data.sha!==sha)) return {rows,complete:false};
  total=data.total_count;
  for(const row of list) {
   if(!Number.isSafeInteger(row.id)||ids.has(row.id)||(key==='check_runs'&&row.head_sha!==sha)) return {rows,complete:false};
   ids.add(row.id);rows.push(row);
  }
  if(rows.length===total)return {rows,complete:true};
  if(rows.length>total||list.length!==100)return {rows,complete:false};
 }
 return {rows,complete:false};
}
export async function collectCI(env,root,sha) {
 const [runs,statuses]=await Promise.all([
  pages(env,root+'/commits/'+sha+'/check-runs?filter=latest','check_runs',sha),
  pages(env,root+'/commits/'+sha+'/status','statuses',sha)
 ]);
 const checks=runs.rows.map(c=>({...c,kind:'check',url:c.html_url}));
 checks.push(...statuses.rows.map(s=>({id:s.id,name:s.context,kind:'status',status:s.state==='pending'?'in_progress':'completed',
  conclusion:s.state,url:s.target_url,output:{summary:s.description||''}})));
 let required;
 try {required=JSON.parse(env.AGENT_REQUIRED_CHECKS||'[]');}catch{return {checks,validation:'unknown',reason:'Invalid AGENT_REQUIRED_CHECKS'};}
 if(!Array.isArray(required)||!required.length||required.some(n=>typeof n!=='string'||!n.trim()))
  return {checks,validation:'unknown',reason:'Configure AGENT_REQUIRED_CHECKS with mandatory test names'};
 if(!runs.complete||!statuses.complete)return {checks,validation:'unknown',reason:'Incomplete or inconsistent CI evidence'};
 if(checks.some(c=>typeof c.name!=='string'||!c.name))return {checks,validation:'unknown',reason:'Invalid CI check names'};
 // Multiple workflows can have the same job name: all reported jobs must succeed.
 const missing=required.filter(name=>!checks.some(c=>c.name===name));
 if(missing.length)return {checks,validation:'unknown',reason:'Missing required checks: '+missing.join(', ')};
 if(checks.some(c=>c.status!=='completed'))return {checks,validation:'pending',reason:'Checks are still running'};
 if(checks.some(c=>c.conclusion!=='success'))return {checks,validation:'not_passed',reason:'One or more checks did not succeed'};
 return {checks,validation:'passed',reason:'All configured checks and reported statuses passed for this SHA'};
}
