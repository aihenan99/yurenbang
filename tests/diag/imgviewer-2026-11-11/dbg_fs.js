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
await p.evaluate(()=>{
  const d=document.querySelector("#r23Detail");
  d.classList.add("open","mf-fs");
  const body=document.querySelector(".r23-dbody")||d;
  if(!body.querySelector(".r23-dimgs")){
    const w=document.createElement("div"); w.className="r23-dimgs one";
    w.innerHTML='<div class="di" data-i="0"><img class="real-img" src="assets/icon-192.png" data-full="assets/icon-512.png" alt="图1"><span class="zi">图 1/1</span></div>';
    body.insertBefore(w,body.firstChild);
  }
});
await p.waitForTimeout(400);
const box=await p.evaluate(()=>{
  const im=document.querySelector("#r23Detail .r23-dimgs .di img");
  const r=im.getBoundingClientRect();
  const cx=r.left+r.width/2, cy=r.top+r.height/2;
  const top=document.elementFromPoint(cx,cy);
  return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},cx,cy,
    top: top? (top.id||top.className||top.tagName):null,
    diOpen: document.querySelector("#r23Detail").className,
    zD: getComputedStyle(document.querySelector("#r23Detail")).zIndex};
});
console.log("before click:",JSON.stringify(box));
await p.mouse.click(box.cx,box.cy);
await p.waitForTimeout(500);
console.log("after click:",JSON.stringify(await p.evaluate(()=>({
  open:document.querySelector("#r23Viewer").classList.contains("open"),
  cls:document.querySelector("#r23Viewer").className,
  z:getComputedStyle(document.querySelector("#r23Viewer")).zIndex
}))));
await p.screenshot({path:"temp/dbg_fs.png"});
await b.close();
})();
