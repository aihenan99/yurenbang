"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
await p.goto("http://127.0.0.1:8796/yurenbang-app.html",{waitUntil:"domcontentloaded"}).catch(()=>{});
await p.waitForTimeout(4000);
let handle=null;
for(let i=0;i<6&&!handle;i++){
  handle=await p.evaluate(()=>{
    const f=document.querySelector("#feed"); if(!f) return false;
    if(!document.querySelector("#feed .card[data-id='9901']")){
      const d=document.createElement("div"); d.className="card"; d.dataset.id="9901";
      d.innerHTML='<div class="media m-imgs n1"><img class="real-img" src="assets/icon-192.png" data-full="assets/icon-512.png"></div>';
      f.appendChild(d);
    }
    return !!document.querySelector("#feed .card[data-id='9901'] .media");
  })?await p.$("#feed .card[data-id='9901'] .media"):null;
  if(!handle)await p.waitForTimeout(600);
}
await handle.tap({force:true});
await p.waitForTimeout(800);
console.log(JSON.stringify(await p.evaluate(()=>{
  const v=document.querySelector("#r23Viewer");
  const cs=getComputedStyle(v);
  return {opacity:cs.opacity, bg:cs.backgroundColor, z:cs.zIndex, cls:v.className,
    topAt:(function(){const el=document.elementFromPoint(195,100);return el?(el.id||el.className||el.tagName):null})(),
    viewers:document.querySelectorAll("#r23Viewer").length,
    sheets:document.querySelectorAll(".sheet.open,#modal.open").length};
}),null,1));
await p.locator("#r23Viewer").screenshot({path:"temp/imgviewer-elem.png"});
await b.close();
})();
