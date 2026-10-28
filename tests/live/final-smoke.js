const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("https://xn--gmqq09al6z.cn/",{waitUntil:"load",timeout:60000});
  await p.waitForTimeout(1500);
  await p.evaluate(()=>enterApp());
  await p.waitForTimeout(600);
  await p.evaluate(()=>switchTab("cases"));
  await p.waitForTimeout(800);
  const r = await p.evaluate(()=>({
    lib:!!document.querySelector(".case-lib"),
    href:(document.querySelector(".case-lib")||{}).getAttribute?document.querySelector(".case-lib").getAttribute("href"):null,
    cards:document.querySelectorAll(".case-card").length
  }));
  console.log("APP:",JSON.stringify(r),"ERRS:",errs.join("|").slice(0,150));
  // 点进去看案例库
  await p.click(".case-lib");
  await p.waitForTimeout(1200);
  console.log("LIB:",await p.title(),"| h1:",await p.$eval("h1",e=>e.textContent.slice(0,20)),"| cards:",await p.$$eval(".card",x=>x.length));
  await p.screenshot({path:"E:/育人帮/temp/shot-lib-prod.png"});
  await b.close();
})();
