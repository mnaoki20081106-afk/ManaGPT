(()=>{"use strict";
 const $=id=>document.getElementById(id);
 window.manaAttachments=[];
 let repositories=[],selectedRepo="";
 const message=text=>{$("status").textContent=String(text).slice(0,210)};
 window.renderManaFiles=()=>{
  const root=$("attachments");root.replaceChildren();
  for(const [index,file] of window.manaAttachments.entries()){
   const chip=document.createElement("span");chip.className="file-chip";
   const name=document.createElement("span");name.textContent="📎 "+file.name;
   const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label",file.name+"を削除");
   remove.onclick=()=>{window.manaAttachments.splice(index,1);window.renderManaFiles()};
   chip.append(name,remove);root.append(chip);
  }
 };
 async function pdfText(file){
  if(!Promise.withResolvers)Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
  const pdf=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
  pdf.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
  const doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  let result="";
  try{
   for(let page=1;page<=Math.min(doc.numPages,60);page++){
    const p=await doc.getPage(page),items=(await p.getTextContent()).items;
    result+="\n[Page "+page+"]\n"+items.map(x=>x.str||"").join(" ");
    if(result.length>=29500)break;
   }
  }finally{await doc.destroy()}
  if(!result.trim())throw Error("文字を抽出できないPDFです。スキャンPDFにはOCRが必要です");
  return result.slice(0,29500)+(result.length>29500?"\n[以降の本文を省略しました]":"");
 }
 async function addFiles(list){
  const problems=[];
  for(const file of Array.from(list)){
   if(window.manaAttachments.length>=4){problems.push("添付は最大4件です");break}
   try{
    let item;
    if(/^image\/(png|jpeg|webp|gif)$/.test(file.type)){
     if(file.size>1600000)throw Error("画像は1.6MB以下にしてください");
     if(window.manaAttachments.filter(x=>x.kind==="image").length>=2)throw Error("画像は最大2枚です");
     const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error("読込エラー"));reader.readAsDataURL(file)});
     item={name:file.name,kind:"image",mime:file.type,data:String(dataUrl).split(",")[1]};
    }else if(/\.pdf$/i.test(file.name)||file.type==="application/pdf"){
     if(file.size>12000000)throw Error("PDFは12MB以下にしてください");
     item={name:file.name,kind:"text",text:await pdfText(file)};
    }else if(/\.(txt|md|json|csv|ts|tsx|js|jsx|py|html|css|xml|yaml|yml|sql|log)$/i.test(file.name)){
     if(file.size>1000000)throw Error("テキストファイルは1MB以下にしてください");
     const text=(await file.text()).slice(0,29500);
     if(!text.trim())throw Error("空のファイルです");
     item={name:file.name,kind:"text",text};
    }else throw Error("対応形式：テキスト・コード・CSV・PDF・画像");
    if(window.manaAttachments.some(x=>x.name===item.name))throw Error("同名ファイルが既にあります");
    window.manaAttachments.push(item);
   }catch(e){problems.push(file.name+": "+e.message)}
  }
  window.renderManaFiles();
  if(problems.length)message(problems.join(" / "));else message(window.manaAttachments.length+"ファイルを添付済み");
 }
 const api=async(path,options={})=>{
  const token=sessionStorage.getItem("mana-token")||"";
  const r=await fetch("/api/"+path,{...options,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json",...(options.headers||{})}});
  const d=await r.json();if(!r.ok)throw Error(d.error||"HTTP "+r.status);return d;
 };
 function filterRepos(){
  const menu=$("github-repository"),q=$("github-search").value.trim().toLowerCase();
  menu.replaceChildren();const placeholder=document.createElement("option");placeholder.textContent="リポジトリを選択";placeholder.value="";menu.append(placeholder);
  for(const r of repositories.filter(x=>x.full_name.toLowerCase().includes(q))){
   const option=document.createElement("option");option.value=r.full_name;option.textContent=r.full_name+(r.private?" 🔒":"");menu.append(option);
  }
  if([...menu.options].some(x=>x.value===selectedRepo))menu.value=selectedRepo;
 }
 async function refreshRepos(){const d=await api("github/repositories");repositories=d.repositories||[];filterRepos()}
 window.loadGithubSettings=async()=>{
  try{
   const d=await api("github/status");selectedRepo=d.repository||"";
   $("github-state").textContent=d.connected?("接続済み"+(d.login?"："+d.login:"（環境変数）")+(selectedRepo?"\n選択中："+selectedRepo:"\nリポジトリを選択してください")):"未接続";
   $("agent-selected-repo").textContent=selectedRepo?"対象： "+selectedRepo:"設定画面でGitHubの接続先を選択してください";
   if(d.connected)await refreshRepos();else{repositories=[];filterRepos()}
  }catch(e){$("github-state").textContent=e.message}
 };
 async function connect(){
  const button=$("github-connect");button.disabled=true;
  try{
   const token=$("github-token").value.trim();if(!token)throw Error("GitHubトークンを入力してください");
   await api("github/connect",{method:"POST",body:JSON.stringify({token})});
   $("github-token").value="";await window.loadGithubSettings();
  }catch(e){$("github-state").textContent="接続失敗："+e.message}finally{button.disabled=false}
 }
 async function saveRepo(){
  const repository=$("github-repository").value;
  if(!repository){$("github-state").textContent="リポジトリを選んでください";return}
  try{await api("github/select",{method:"POST",body:JSON.stringify({repository})});selectedRepo=repository;await window.loadGithubSettings()}
  catch(e){$("github-state").textContent="選択失敗："+e.message}
 }
 async function disconnect(){
  if(!confirm("保存したGitHubトークンとリポジトリ設定を削除しますか？"))return;
  try{await api("github/disconnect",{method:"POST"});repositories=[];selectedRepo="";await window.loadGithubSettings()}
  catch(e){$("github-state").textContent=e.message}
 }
 $("attach-btn").onclick=()=>$("file-input").click();
 $("file-input").onchange=async e=>{await addFiles(e.target.files);e.target.value=""};
 const composer=$("form");
 composer.ondragover=e=>{e.preventDefault();composer.classList.add("dragging")};
 composer.ondragleave=()=>composer.classList.remove("dragging");
 composer.ondrop=async e=>{e.preventDefault();composer.classList.remove("dragging");await addFiles(e.dataTransfer.files)};
 $("github-connect").onclick=connect;
 $("github-refresh").onclick=()=>refreshRepos().catch(e=>{$("github-state").textContent=e.message});
 $("github-search").oninput=filterRepos;
 $("github-save-repository").onclick=saveRepo;
 $("github-disconnect").onclick=disconnect;
})();
