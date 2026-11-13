"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"..","..","temp","pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
await p.goto("https://xn--gmqq09al6z.cn/",{waitUntil:"domcontentloaded",timeout:30000}).catch(()=>{});
await p.waitForTimeout(9000);
await p.evaluate(()=>{
  window.__trace=[];
  const log=(n)=>(e)=>{try{window.__trace.push(n+":"+String((e.target.className||e.target.tagName)).slice(0,30)+"@"+Date.now()%100000);}catch(err){}};
  ["pointerdown","pointerup","click","touchstart"].forEach(n=>{
    document.addEventListener(n,log(n),true);
  });
  // 关键：监听详情是否被短暂打开过
  const d=document.querySelector("#r23Detail");
  new MutationObserver(()=>{window.__trace.push("detailClass:"+d.className.slice(0,30)+"@"+Date.now()%100000);}).observe(d,{attributes:true,attributeFilter:["class"]});
  const s=document.querySelector("#commentSheet");
  new MutationObserver(()=>{window.__trace.push("sheetClass:"+s.className.slice(0,30)+"@"+Date.now()%100000);}).observe(s,{attributes:true,attributeFilter:["class"]});
  const el=document.querySelector("#feed .helps-pill");
  const r=el.getBoundingClientRect();
  window.__pill={x:r.x+r.width/2,y:r.y+r.height/2,link:!!el.closest(".card").querySelector("[data-r23detail]")};
});
const pill=await p.evaluate(()=>window.__pill);
console.log("pill center:",JSON.stringify(pill));
await p.touchscreen.tap(pill.x,pill.y);
await p.waitForTimeout(1600);
console.log(JSON.stringify(await p.evaluate(()=>window.__trace),null,0).replace(/","/g,'"\n "'));
await b.close();
})();
