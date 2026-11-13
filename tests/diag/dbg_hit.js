"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"..","..","temp","pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
await p.goto("http://127.0.0.1:8796/yurenbang-app.html",{waitUntil:"domcontentloaded"}).catch(()=>{});
await p.waitForTimeout(7000);
await p.evaluate(()=>{
  const f=document.querySelector("#feed");
  const sp=document.createElement("div"); sp.style.height="420px"; f.appendChild(sp);
  const d=document.createElement("div"); d.className="card"; d.dataset.id="9901";
  d.innerHTML='<div class="p-text">正文</div><div class="p-acts"><span class="helps-pill" data-act="cm">🤝 3 个帮忙</span></div>';
  f.appendChild(d);
  const pill=document.querySelector("#mfAuto");
  const pr=pill.getBoundingClientRect();
  const ph=document.querySelector("#page-home");
  const ar=d.querySelector(".p-acts").getBoundingClientRect();
  ph.scrollTop=Math.max(0,ar.top+ar.height/2-(pr.top+pr.bottom)/2);
});
await p.waitForTimeout(400);
console.log(JSON.stringify(await p.evaluate(()=>{
  const pill=document.querySelector("#mfAuto");
  const pr=pill.getBoundingClientRect();
  const x=pr.left+pr.width/2,y=pr.top+pr.height/2;
  const el=document.elementFromPoint(x,y);
  const hit=document.elementsFromPoint(x,y).slice(0,6).map(e=>(e.id||e.className||e.tagName).toString().slice(0,26));
  return {blocked:pill.className,pe:getComputedStyle(pill).pointerEvents,
    xy:[Math.round(x),Math.round(y)],top:el?(el.id||el.className||el.tagName):null,stack:hit,
    pillRect:[Math.round(pr.left),Math.round(pr.top),Math.round(pr.right),Math.round(pr.bottom)]};
}),null,1));
await b.close();
})();
