const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });

  // A) 正常加载：所有层标记齐、自愈不触发
  let p = await b.newPage({ viewport:{width:412,height:900} });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message.slice(0,120)));
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(2500);
  const a = await p.evaluate(()=>({
    app:!!window.YRB_APP, r23:!!window.YRB_R23, jj:!!window.YRB_JJ, gate:!!window.YRB_GATE,
    cloud:!!window.YRB_CLOUD, food:!!window.YRB_FOOD, access:!!window.YRB_MYLIST,
    healCount:document.querySelectorAll("script[data-heal]").length,
    chip:!!document.querySelector("#funcrow .jj-chip")
  }));
  console.log("A 正常加载:",JSON.stringify(a),"errs:",errs.join("|").slice(0,120));
  await p.close();

  // B) 模拟弱网：jiaojiao.js 和 gate.js 请求失败 → 自愈应补载成功
  p = await b.newPage({ viewport:{width:412,height:900} });
  await p.route("**/jiaojiao.js*", r=>r.abort());
  await p.route("**/gate.js*", r=>r.abort());
  const errs2=[];
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(500);   // 自愈在 load+1.2s 才跑
  await p.unroute("**/jiaojiao.js*"); await p.unroute("**/gate.js*");
  await p.waitForTimeout(4000);  // 等补载完成
  const c = await p.evaluate(()=>({
    jj:!!window.YRB_JJ, gate:!!window.YRB_GATE,
    jjPage:!!document.querySelector("#page-jiaojiao"),
    heal:[...document.querySelectorAll("script[data-heal]")].map(s=>s.dataset.heal),
    chip:!!document.querySelector("#funcrow .jj-chip")
  }));
  console.log("B 弱网自愈:",JSON.stringify(c));
  await p.close();
  await b.close();
})();
