"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
await p.goto("http://127.0.0.1:8796/yurenbang-app.html",{waitUntil:"domcontentloaded"}).catch(()=>{});
await p.waitForTimeout(3500);
for(let i=0;i<5;i++){
  const okk=await p.evaluate(()=>{
    const f=document.querySelector("#feed"); if(!f) return false;
    if(!document.querySelector("#feed .card[data-id='9901']")){
      const d=document.createElement("div"); d.className="card"; d.dataset.id="9901";
      d.innerHTML='<div class="media m-imgs n1"><img class="real-img" src="assets/icon-192.png" data-full="assets/icon-512.png"></div>';
      f.appendChild(d);
    }
    const m=document.querySelector("#feed .card[data-id='9901'] .media");
    if(m){m.click();return "clicked";}
    return false;
  });
  if(okk==="clicked")break;
  await p.waitForTimeout(500);
}
await p.waitForTimeout(600);
console.log(JSON.stringify(await p.evaluate(()=>{
  const v=document.querySelector("#r23Viewer"), ph=document.querySelector("#phone");
  const vr=v.getBoundingClientRect(), pr=ph.getBoundingClientRect();
  const cs=getComputedStyle(v);
  return {viewer:{x:vr.x,y:vr.y,w:vr.width,h:vr.height},
    phone:{x:pr.x,y:pr.y,w:pr.width,h:pr.height},
    pos:cs.position, inset:cs.inset, z:cs.zIndex, bg:cs.backgroundColor,
    parent:v.parentElement.id||v.parentElement.className,
    cls:v.className};
}),null,1));
await b.close();
})();
