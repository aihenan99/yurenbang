const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  const errs=[];
  p.on("pageerror",e=>errs.push("PAGEERR "+e.message.slice(0,200)));
  p.on("console",m=>{const t=m.text(); if(m.type()==="error"&&!/net::|404/.test(t)) errs.push("ERR "+t.slice(0,180));});
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(2000);
  // 问题1：家教栏目 chip
  const chip = await p.evaluate(()=>({
    row:!!document.querySelector("#funcrow"),
    chips:[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()),
    jj:!!document.querySelector("#funcrow .jj-chip")
  }));
  console.log("1 家教chip:",JSON.stringify(chip));
  // 问题3：送美食按钮 —— 看自己的帖子（需要登录）
  const thx = await p.evaluate(()=>{
    // 找第一条自己发的帖子卡片上的答谢条
    const bar=document.querySelector(".p-thank");
    const card=document.querySelector(".card[data-id]");
    return {bar:!!bar, barText:bar?bar.textContent.trim().slice(0,50):"", cards:document.querySelectorAll(".card").length};
  });
  console.log("3 答谢条:",JSON.stringify(thx));
  await p.screenshot({path:"E:/育人帮/temp/r1-home.png"});
  console.log("ERRS:",errs.join(" | ").slice(0,500));
  await b.close();
})();
