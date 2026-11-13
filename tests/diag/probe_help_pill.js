"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"..","..","temp","pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
const errs=[];
p.on("pageerror",e=>errs.push(String(e.message).slice(0,150)));
p.on("console",m=>{if(m.type()==="error")errs.push("[console] "+m.text().slice(0,150));});
await p.goto("https://xn--gmqq09al6z.cn/",{waitUntil:"domcontentloaded",timeout:30000}).catch(e=>errs.push("goto:"+e.message.slice(0,80)));
await p.waitForTimeout(9000);
const st1=await p.evaluate(()=>({
  cards:document.querySelectorAll("#feed .card").length,
  pills:document.querySelectorAll("#feed .helps-pill").length,
  paHelp:document.querySelectorAll("#feed .pa-help").length
}));
console.log("cards:",JSON.stringify(st1));
// 点击第一张卡的 helps-pill（没有就用 pa-help，再没有就注入一个桩卡）
let clicked=await p.evaluate(()=>{
  const pill=document.querySelector("#feed .helps-pill")||document.querySelector("#feed .pa-help");
  if(!pill){
    const f=document.querySelector("#feed");
    const d=document.createElement("div");d.className="card";d.dataset.id="9901";
    d.innerHTML='<div class="p-text">测试</div><div class="p-acts"><span class="helps-pill" data-act="cm">🤝 3 个帮忙</span></div>';
    f.appendChild(d);
    return "injected";
  }
  return "found:"+pill.className;
});
console.log("pill:",clicked);
await p.waitForTimeout(300);
await p.evaluate(()=>{const x=document.querySelector("#feed .helps-pill")||document.querySelector("#feed .pa-help");x.click();});
await p.waitForTimeout(1200);
const st2=await p.evaluate(()=>({
  sheet:document.querySelector("#commentSheet")?document.querySelector("#commentSheet").className:"missing",
  open:!!(document.querySelector("#commentSheet")&&document.querySelector("#commentSheet").classList.contains("open")),
  lock:!!document.querySelector("#cmLock"),
  cmItems:document.querySelectorAll("#cmList .cm-item").length,
  curPost:(window.S&&S.curPost)||null
}));
console.log("after click:",JSON.stringify(st2));
console.log("errors:",errs.length?errs.slice(0,6):"none");
await b.close();
})();
