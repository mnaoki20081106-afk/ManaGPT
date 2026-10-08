import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../cloudflare/public/index.html",import.meta.url),"utf8");
const extras=readFileSync(new URL("../cloudflare/public/extras.js",import.meta.url),"utf8");
test("all expected attachment and GitHub UI controls exist and helper is loaded",()=>{
 for(const id of ["attach-btn","file-input","attachments","github-token","github-connect","github-repository","github-save-repository","github-disconnect"]){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(html,/src="\/extras\.js"/);
 assert.match(extras,/window\.manaAttachments=/);
 assert.match(extras,/window\.loadGithubSettings=/);
});
test("switching GitHub repository resets previously selected PR actions",()=>{
 assert.match(extras,/previousRepo!==selectedRepo/);
 assert.match(extras,/dispatchEvent\(new Event\("managpt:repository-change"\)\)/);
 assert.match(html,/addEventListener\("managpt:repository-change"/);
 assert.match(html,/activePR=0/);
 assert.match(html,/\$\("#agent-controls"\)\.classList\.add\("hidden"\)/);
});

test("coding view offers independent attachments and selected GitHub target",()=>{
 for(const id of ["agent-dropzone","agent-attach-btn","agent-file-input","agent-attachments","agent-repository","agent-repo-refresh","agent-open-settings"]){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(html,/attachments:files/);
 assert.match(html,/repository,attachments:files/);
 assert.match(html,/window\.manaAgentFilesLoading/);
 assert.match(extras,/window\.manaAgentAttachments=/);
 assert.match(extras,/window\.renderManaAgentFiles=/);
 assert.match(extras,/addFiles\(e\.target\.files,"agent"\)/);
 assert.match(extras,/saveRepo\(e\.target\.value\)/);
 assert.match(extras,/window\.manaSelectedRepo=selectedRepo/);
});
