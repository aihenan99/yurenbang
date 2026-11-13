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
  window.__ev=[];
  ["pointerdown","pointerup","touchstart","touchend","click","mousedown","mouseup"].forEach(n=>{
    document.addEventListener(n,e=>{window.__ev.push(n+"->"+String((e.target.className||e.target.tagName)).slice(0,24)+" pe:"+getComputedStyle(e.target).pointerEvents);},true);
  });
});
await p.waitForTimeout(400);
const xy=await p.evaluate(()=>{const r=document.querySelector("#mfAuto").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
await p.touchscreen.tap(xy.x,xy.y);
await p.waitForTimeout(600);
console.log(await p.evaluate(()=>JSON.stringify(window.__ev,null,0)));
await b.close();
})();
