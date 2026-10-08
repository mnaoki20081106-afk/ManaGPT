import {collectCI} from "./ci.js";
import {gh,modelConfig,propose,commitEdits,pathURL} from "./coding.js";
export {gh,encode,safePath} from "./coding.js";
export async function agentAction(env,body) {
 const repo = env.GITHUB_REPOSITORY;
 if (!env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw Error("GitHub integration not configured");
 if (!body || typeof body.task !== "string" || body.task.trim().length < 5 || body.task.length > 12000) throw Error("Task must contain 5–12000 characters");
 modelConfig(env);
 const root = "/repos/" + repo;
 const info = await gh(env,root);
 const head = await gh(env,root + "/git/ref/heads/" + pathURL(info.default_branch));
 const base = await gh(env,root + "/git/commits/" + head.object.sha);
 const tree = await gh(env,root + "/git/trees/" + base.tree.sha + "?recursive=1");
 if (tree.truncated) throw Error("Repository tree was truncated");
 const proposal = await propose(env,root,head.object.sha,tree.tree,body.task);
 const commit = await commitEdits(env,root,head.object.sha,base.tree.sha,tree.tree,proposal.edits,"manaGPT: " + body.task.slice(0,65));
 const branch = "managpt/agent-" + crypto.randomUUID().slice(0,12);
 // Publish the complete change once: no partially edited branch or repeated CI runs.
 await gh(env,root + "/git/refs",{method:"POST",body:JSON.stringify({ref:"refs/heads/" + branch,sha:commit.sha})});
 let pr;
 try {
  pr = await gh(env,root + "/pulls",{method:"POST",body:JSON.stringify({title:"manaGPT: " + body.task.slice(0,70),head:branch,base:info.default_branch,draft:true,
   body:proposal.summary + "\n\nTask: " + body.task + "\n\nPlanned validation (not executed by the model):\n" + proposal.test_plan.map(x=>"- " + x).join("\n") + "\n\nModel: " + proposal.model + "\nTests: pending repository CI. Model review is not test execution."})});
 } catch (e) { throw Error("Commit saved on " + branch + " (" + commit.sha + "), but PR creation failed: " + e.message); }
 return {branch,commit:commit.sha,pr_url:pr.html_url,pr_number:pr.number,files:proposal.edits.map(e=>({path:e.path,sha:commit.sha})),
  read_paths:proposal.read_paths,trace:proposal.trace,validation:"pending_ci",test_plan:proposal.test_plan};
}
export async function agentStatus(env,number) {
 if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) throw Error("GitHub integration not configured");
 const root = "/repos/" + env.GITHUB_REPOSITORY;
 const pr = await gh(env,root + "/pulls/" + number);
 const evidence = await collectCI(env,root,pr.head.sha);
 const current = await gh(env,root + "/pulls/" + number);
 if(current.head.sha!==pr.head.sha) return {pr_url:pr.html_url,state:current.state,head_sha:current.head.sha,checks:[],validation:"pending",reason:"PR head changed during validation; check again"};
 return {pr_url:pr.html_url,state:pr.state,head_sha:pr.head.sha,...evidence};
}
