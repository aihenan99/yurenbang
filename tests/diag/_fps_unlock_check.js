/* 快速自检：① ?fps=1 面板出现且显示数字 ② 音频解锁只在 click 触发（滑动不建 AudioContext） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block",
    isMobile: true, hasTouch: true });
  await ctx.addInitScript(`Object.defineProperty(navigator,'webdriver',{get:()=>false});
    window.__acN=0;{const A=window.AudioContext;window.AudioContext=function(){window.__acN++;return new A(...arguments)};}
    {const A2=window.webkitAudioContext; if(A2) window.webkitAudioContext=function(){window.__acN++;return new A2(...arguments)};}`);
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/?fps=1&t=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });

  /* 模拟上下滑动（不点击） */
  const cdp = await ctx.newCDPSession(p);
  for (let i = 0; i < 3; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y: 600 }] });
    for (let k = 0; k < 5; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 206, y: 600 - k * 40 }] });
      await p.waitForTimeout(30);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(100);
  }
  const afterSwipe = await p.evaluate(() => ({ ac: window.__acN, fpsBox: !!document.getElementById("yrbFpsBox") }));
  /* 再点一下（click） */
  await p.evaluate(() => document.body.click());
  await p.waitForTimeout(300);
  const afterClick = await p.evaluate(() => ({ ac: window.__acN }));
  const text = await p.evaluate(() => (document.getElementById("yrbFpsBox") || {}).textContent || "");
  console.log("滑动后 AudioContext 创建:", afterSwipe.ac, "(应为 0)");
  console.log("滑动后 fps 面板存在:", afterSwipe.fpsBox, "(应为 true)");
  console.log("点击后 AudioContext 创建:", afterClick.ac, "(应为 1)");
  console.log("面板文本:", JSON.stringify(text.slice(0, 60)));
  const ok = afterSwipe.ac === 0 && afterSwipe.fpsBox && afterClick.ac === 1 && text.indexOf("帧率") === 0;
  console.log(ok ? "PASS" : "FAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})();
