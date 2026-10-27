const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });

  // A) 正常：点按进入，不触发刷新
  let p = await b.newPage({ viewport:{width:412,height:900} });
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(1500);
  await p.mouse.click(206,450);
  await p.waitForTimeout(2000);
  const a = await p.evaluate(()=>({url:location.pathname+location.search,splashHidden:document.getElementById("splash").classList.contains("hidden")}));
  console.log("A 正常进入:",JSON.stringify(a));
  await p.close();

  // B) 主程序加载失败：点按 1.2s 后自动换地址刷新，刷新后正常进入
  p = await b.newPage({ viewport:{width:412,height:900} });
  let n = 0;
  await p.route("**/app.js*", r=>{ n++; if(n===1) r.abort(); else r.continue(); });
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(1500);
  const b1 = await p.evaluate(()=>({app:!!window.YRB_APP,splashVisible:!document.getElementById("splash").classList.contains("hidden")}));
  await p.mouse.click(206,450);
  await p.waitForTimeout(3000);   // 1.2s 判定 + 刷新 + 加载
  const b2 = await p.evaluate(()=>({url:location.search.includes("yrbheal"),app:!!window.YRB_APP,splashHidden:document.getElementById("splash").classList.contains("hidden"),chips:!!document.querySelector("#funcrow .jj-chip")}));
  console.log("B 首次加载 app.js 失败:",JSON.stringify(b1));
  console.log("B 点按自救后:",JSON.stringify(b2));
  await p.close();
  await b.close();
})();
