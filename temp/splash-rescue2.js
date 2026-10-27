const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  await p.route("**/app.js*", r=>r.abort());   // 一直断供
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(1800);
  await p.mouse.click(206,450);
  await p.waitForTimeout(2500);
  const r1 = await p.evaluate(()=>({heal:location.search.includes("yrbheal"),app:!!window.YRB_APP}));
  console.log("自救刷新发生:",JSON.stringify(r1));
  await p.mouse.click(206,450);   // 再点（仍进不去）
  await p.waitForTimeout(2200);
  const r2 = await p.evaluate(()=>({url:location.search,hint:(document.querySelector(".s-hint")||{}).textContent}));
  console.log("60s 防循环后:",JSON.stringify(r2));
  await b.close();
})();
