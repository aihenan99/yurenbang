"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"..","..","temp","pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
const errs=[];
p.on("pageerror",e=>errs.push(String(e.message).slice(0,200)));
p.on("console",m=>{if(m.type()==="error")errs.push("[console] "+m.text().slice(0,200));});
await p.goto("https://xn--gmqq09al6z.cn/",{waitUntil:"domcontentloaded",timeout:30000}).catch(e=>errs.push("goto:"+e.message.slice(0,80)));
await p.waitForTimeout(9000);
// 真触摸点第一张卡的 helps-pill
const box=await p.evaluate(()=>{const el=document.querySelector("#feed .helps-pill");const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
await p.touchscreen.tap(box.x,box.y);
await p.waitForTimeout(1500);
const st=await p.evaluate(()=>({
  detail:document.querySelector("#r23Detail")?document.querySelector("#r23Detail").className.slice(0,40):"missing",
  detailFs:!!(document.querySelector("#r23Detail")&&document.querySelector("#r23Detail").classList.contains("mf-fs")),
  sheetOpen:!!(document.querySelector("#commentSheet")&&document.querySelector("#commentSheet").classList.contains("open")),
  lock:!!document.querySelector("#cmLock"),
  viewer:!!(document.querySelector("#r23Viewer")&&document.querySelector("#r23Viewer").classList.contains("open"))
}));
console.log("touch tap pill:",JSON.stringify(st,null,1));
console.log("errors:",errs.length?errs.slice(0,8):"none");
await b.close();
})();
