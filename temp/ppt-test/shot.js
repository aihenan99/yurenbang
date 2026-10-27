const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:380,height:520}, deviceScaleFactor:2 });
  const errs=[];
  p.on("console",m=>{ if(m.type()==="error") errs.push(m.text()); });
  p.on("pageerror",e=>errs.push("PAGEERR "+e.message));
  await p.goto("http://127.0.0.1:8793/temp/ppt-test/test.html",{waitUntil:"load"});
  await p.waitForFunction(()=>/rendered|ERR/.test(document.getElementById("log").textContent),null,{timeout:30000}).catch(()=>{});
  console.log("LOG:/n"+await p.$eval("#log",e=>e.textContent));
  console.log("ERRS:",errs.slice(0,8).join(" | "));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/s1.png"});
  // 第二页
  await p.evaluate(()=>window.__pv && window.__pv.renderNextSlide());
  await p.waitForTimeout(600);
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/s2.png"});
  await p.evaluate(()=>window.__pv && window.__pv.renderNextSlide());
  await p.waitForTimeout(600);
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/s3.png"});
  await b.close();
})();
