const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const num = p => p.evaluate(()=>((document.querySelector(".vp-num")||{}).textContent||"").trim());
const btn = p => p.evaluate(()=>((document.querySelector(".vp-tools [data-a='play']")||{}).textContent||"").trim());
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:410,height:900}, deviceScaleFactor:2 });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(1200);
  await p.evaluate(()=>enterApp());
  await p.waitForTimeout(400);
  await p.evaluate(()=>{
    S.cases.unshift({t:"自动播放测试",type:"ppt",kind:"study",helps:3,likes:5,favs:1,
      media:[{kind:"file",url:"/temp/ppt-test/sample_fixed.pptx",name:"自动播放.pptx"}]});
    openViewer(S.cases[0]);
  });
  await p.waitForSelector(".vp-nav",{timeout:30000});
  await p.waitForTimeout(900);
  console.log("A 初始:", await num(p), "| 按钮:", await btn(p), "| 进度条:", await p.evaluate(()=>!!document.querySelector(".vp-prog i")));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/a1.png"});

  await p.waitForTimeout(6500);
  console.log("B 6.5s 后:", await num(p), "| 按钮:", await btn(p));

  await p.waitForTimeout(6500);
  console.log("C 再 6.5s:", await num(p));

  await p.waitForTimeout(7000);
  console.log("D 末页后:", await num(p), "| 按钮:", await btn(p), "| 进度条隐藏:", await p.evaluate(()=>document.querySelector(".vp-prog").classList.contains("off")));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/a2.png"});

  // 重播
  await p.click(".vp-tools [data-a='play']");
  await p.waitForTimeout(600);
  console.log("E 重播:", await num(p), "| 按钮:", await btn(p));

  // 暂停
  await p.click(".vp-tools [data-a='play']");
  await p.waitForTimeout(300);
  const before = await num(p);
  await p.waitForTimeout(7000);
  console.log("F 暂停后 7s:", before, "→", await num(p), "| 按钮:", await btn(p));

  // 手动翻页应暂停
  await p.click(".vp-tools [data-a='play']");   // 继续
  await p.waitForTimeout(500);
  await p.click(".vp-nav [data-a='next']");
  await p.waitForTimeout(300);
  console.log("G 手动下一页:", await num(p), "| 按钮:", await btn(p));

  // 速度切换
  await p.click(".vp-tools [data-a='speed']");
  console.log("H 速度1:", await p.$eval(".vp-tools [data-a='speed']",e=>e.textContent));
  await p.click(".vp-tools [data-a='speed']");
  console.log("H 速度2:", await p.$eval(".vp-tools [data-a='speed']",e=>e.textContent));

  // 关闭后重开另一个案例：不能出现双计时器
  await p.evaluate(()=>{ openViewer(S.cases[0]); });
  await p.waitForTimeout(800);
  console.log("I 重开:", await num(p), "| 按钮:", await btn(p));
  await p.waitForTimeout(6800);
  console.log("J 重开 6.8s 后（应只翻 1 页）:", await num(p));
  console.log("ERRS:", errs.join(" | ").slice(0,300));
  await b.close();
})();
