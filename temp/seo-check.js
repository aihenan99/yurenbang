const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  // 1) 无 JS 视角（模拟爬虫）：内容必须可见
  const noJs = await b.newContext({ javaScriptEnabled:false, viewport:{width:412,height:900}, deviceScaleFactor:2 });
  const p0 = await noJs.newPage();
  await p0.goto("http://127.0.0.1:8793/anli/",{waitUntil:"load"});
  const hub = await p0.evaluate(()=>({
    h1:(document.querySelector("h1")||{}).textContent,
    cards:document.querySelectorAll(".card").length,
    links:[...document.querySelectorAll(".card h3 a")].length,
    text:document.body.innerText.length,
    ld:[...document.querySelectorAll('script[type="application/ld+json"]')].length,
    css:getComputedStyle(document.querySelector(".hero h1")).fontSize
  }));
  console.log("HUB(noJS):",JSON.stringify(hub));
  await p0.screenshot({path:"E:/育人帮/temp/shot-hub.png"});

  const p1 = await noJs.newPage();
  await p1.goto("http://127.0.0.1:8793/anli/haizi-xie-zuoye-tuola.html",{waitUntil:"load"});
  const art = await p1.evaluate(()=>({
    h1:(document.querySelector("h1")||{}).textContent.slice(0,30),
    h2:document.querySelectorAll(".body h2").length,
    words:document.querySelector(".body").innerText.replace(/\s/g,"").length,
    rel:document.querySelectorAll(".rel li").length,
    crumb:!!document.querySelector(".crumb"),
    ld:document.querySelectorAll('script[type="application/ld+json"]').length
  }));
  console.log("CASE(noJS):",JSON.stringify(art));
  await p1.screenshot({path:"E:/育人帮/temp/shot-case.png",fullPage:false});

  // 2) 有 JS 的正常用户：结构完整、无报错
  const ctx = await b.newContext({ viewport:{width:412,height:900}, deviceScaleFactor:2 });
  const p2 = await ctx.newPage();
  const errs=[]; p2.on("pageerror",e=>errs.push(e.message));
  await p2.goto("http://127.0.0.1:8793/anli/",{waitUntil:"load"});
  await p2.click(".card h3 a");
  await p2.waitForTimeout(500);
  console.log("NAV:",await p2.title(), "| ERRS:",errs.join("|").slice(0,150));

  // 3) 首页案例广场的入口是否可见可点
  const p3 = await ctx.newPage();
  await p3.goto("http://127.0.0.1:8793/",{waitUntil:"load"});
  await p3.waitForTimeout(1200);
  await p3.evaluate(()=>enterApp());
  await p3.waitForTimeout(400);
  await p3.evaluate(()=>switchTab("cases"));
  await p3.waitForTimeout(600);
  const link = await p3.$eval(".case-lib",e=>({t:e.innerText.replace(/\n/g," / "),href:e.getAttribute("href"),box:e.getBoundingClientRect().top}));
  console.log("APP LINK:",JSON.stringify(link));
  await p3.screenshot({path:"E:/育人帮/temp/shot-app.png"});
  await b.close();
})();
