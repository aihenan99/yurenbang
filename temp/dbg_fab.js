const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:8791/yurenbang-app.html";
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  p.on("pageerror",e=>console.log("PAGEERR",String(e)));
  await p.goto(BASE,{waitUntil:"domcontentloaded"});
  await p.waitForTimeout(900);
  const vis=await p.evaluate(()=>{const s=document.querySelector("#splash");return !!(s&&!s.classList.contains("hidden")&&s.offsetParent!==null);});
  console.log("splash visible:",vis);
  if(vis){await p.click("#splash");await p.waitForTimeout(800);}
  console.log("before:",await p.evaluate(()=>({cls:document.querySelector("#publishSheet").className,tr:getComputedStyle(document.querySelector("#publishSheet")).transform,fab:document.querySelector("#fab").getBoundingClientRect().toJSON()})));
  await p.evaluate(()=>document.querySelector("#fab").click());
  await p.waitForTimeout(200);
  console.log("after eval click:",await p.evaluate(()=>({cls:document.querySelector("#publishSheet").className,tr:getComputedStyle(document.querySelector("#publishSheet")).transform,mask:document.querySelector("#drMask").className})));
  await p.evaluate(()=>document.querySelector("#fab").click());
  await p.waitForTimeout(200);
  console.log("2nd:",await p.evaluate(()=>({cls:document.querySelector("#publishSheet").className,tr:getComputedStyle(document.querySelector("#publishSheet")).transform})));
  await b.close();
})();
