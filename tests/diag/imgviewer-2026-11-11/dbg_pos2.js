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
await p.waitForTimeout(700);
console.log(JSON.stringify(await p.evaluate(()=>{
  const v=document.querySelector("#r23Viewer");
  const vr=v.getBoundingClientRect();
  const cs=getComputedStyle(v);
  const img=document.querySelector("#r23Big img");
  const ir=img?img.getBoundingClientRect():null;
  return {cls:v.className, viewer:{x:vr.x,y:vr.y,w:vr.width,h:vr.height},
    pos:cs.position, z:cs.zIndex, bg:cs.backgroundColor, inset:cs.inset,
    img: ir?{x:Math.round(ir.x),y:Math.round(ir.y),w:Math.round(ir.width),h:Math.round(ir.height)}:null};
}),null,1));
await p.screenshot({path:"temp/imgviewer-1-open.png"});
await b.close();
})();
