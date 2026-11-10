"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
p.on("pageerror",e=>console.log("[err]",String(e.message).slice(0,200)));
await p.goto("http://127.0.0.1:8796/yurenbang-app.html",{waitUntil:"domcontentloaded"}).catch(e=>console.log("goto",e.message.slice(0,80)));
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(()=>({
  feed: !!document.querySelector("#feed"),
  feedKids: document.querySelector("#feed")?document.querySelector("#feed").children.length:null,
  app: (document.querySelector("#app")||{}).className,
  splash: (document.querySelector("#splash")||{}).className,
  phone: !!document.querySelector("#phone"),
  viewer: !!document.querySelector("#r23Viewer"),
  mf: !!(window.YRB_MEDIAFULL&&window.YRB_MEDIAFULL.image),
  ver: window.YRB_MEDIAFULL&&window.YRB_MEDIAFULL.version
})),null,1));
// 注入并观察存活
console.log(await p.evaluate(()=>{
  const f=document.querySelector("#feed");
  const d=document.createElement("div");
  d.className="card"; d.dataset.id="9901";
  d.innerHTML='<div class="p-text">t</div><div class="media m-imgs n1"><img class="real-img" src="assets/icon-192.png" data-full="assets/icon-512.png"></div>';
  f.appendChild(d);
  return "after inject kids="+f.children.length;
}));
await p.waitForTimeout(300);
console.log(await p.evaluate(()=>{
  const f=document.querySelector("#feed");
  return "after 300ms kids="+f.children.length+" found="+!!document.querySelector("#feed .card[data-id='9901'] img");
}));
await b.close();
})();
