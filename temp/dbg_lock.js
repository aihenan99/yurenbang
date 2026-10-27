const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:8791/yurenbang-app.html";
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  p.on("pageerror",e=>console.log("ERR",String(e)));
  await p.goto(BASE,{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#feed .card",{timeout:20000});
  await p.waitForTimeout(600);
  console.log(await p.evaluate(()=>{
    const t=document.querySelector('#feed [data-act="cm"]');
    const card=t&&t.closest(".card");
    return {
      trigger: t?t.outerHTML.slice(0,160):null,
      cardId: card&&card.dataset.id,
      posts: S.posts.slice(0,3).map(x=>({id:x.id,helps:x.helps,cm:(x.comments||[]).length,text:(x.text||"").slice(0,14)}))
    };
  }));
  await p.evaluate(()=>{const t=document.querySelector('#feed [data-act="cm"]');t&&t.click();});
  await p.waitForTimeout(700);
  console.log(await p.evaluate(()=>{
    const l=document.querySelector("#cmList");
    return {open:document.querySelector("#commentSheet").classList.contains("open"),curPost:S.curPost,
      cls:l.className,items:l.querySelectorAll(".cm-item").length,html:l.innerHTML.slice(0,160),
      lock:!!document.getElementById("cmLock")};
  }));
  await b.close();
})();
