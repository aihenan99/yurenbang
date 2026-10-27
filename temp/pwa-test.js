/* PWA 安装恢复回归：
   S1 manifest 可达且 start_url=/ 不再 404（HTTP 200）
   S2 分发假 beforeinstallprompt → 「安装到手机桌面」按钮出现
   S3 点安装按钮 → prompt 被调用、按钮隐藏、toast 出现
   S4 appinstalled 后按钮隐藏
   S5 微信引导含「添加到桌面」提示
   全程零 pageerror */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const BASE = "http://127.0.0.1:8794/";
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1800);

  /* S1 */
  const m = await p.evaluate(async () => {
    const r = await fetch("/manifest.webmanifest");
    const j = await r.json();
    return { status: r.status, start: j.start_url };
  });
  console.log("S1 manifest:", m.status, "| start_url:", m.start);

  /* 进入分享层 */
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => { try { switchTab("me"); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.querySelector("#mmShare"); if (b) b.click(); });
  await p.waitForTimeout(600);
  const hiddenBefore = await p.evaluate(() => document.querySelector("#slInstall").style.display);
  console.log("S2 安装按钮初始隐藏:", hiddenBefore === "none");

  /* S2/S3: 派发假 install 事件 */
  await p.evaluate(() => {
    window.__prompted = 0;
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__prompted++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await p.waitForTimeout(300);
  const shown = await p.evaluate(() => document.querySelector("#slInstall").style.display);
  await p.evaluate(() => document.querySelector("#slInstall").click());
  await p.waitForTimeout(400);
  const r3 = await p.evaluate(() => ({ prompted: window.__prompted, hidden: document.querySelector("#slInstall").style.display === "none" }));
  console.log("S2 事件后按钮显示:", shown === "flex", "| S3 prompt 调用:", r3.prompted === 1, "| 点击后隐藏:", r3.hidden);

  /* S4: appinstalled 隐藏（重新派发再触发 appinstalled） */
  await p.evaluate(() => {
    const e = new Event("beforeinstallprompt"); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
    window.dispatchEvent(new Event("appinstalled"));
  });
  await p.waitForTimeout(200);
  const r4 = await p.evaluate(() => document.querySelector("#slInstall").style.display);
  console.log("S4 appinstalled 后隐藏:", r4 === "none");

  /* S5: 微信引导含添加到桌面 */
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { try { switchTab("me"); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const e = new Event("beforeinstallprompt"); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
    const entry = document.querySelector("#mmShare");
    if (entry) entry.click();
  });
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    /* 微信/无 share 环境才会弹引导层；Chrome 自带 navigator.share，要按真机微信情形关掉 */
    try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); } catch (e) {}
    const btn = document.querySelector("#slShare");
    if (btn) btn.click();
  });
  await p.waitForTimeout(600);
  const r5 = await p.evaluate(() => ({ guide: !!document.querySelector("#shGuide.open"), tip: /添加到(桌面|主屏幕)/.test((document.querySelector("#shGuide") || {}).innerText || "") }));
  console.log("S5 引导弹层出现:", r5.guide, "| 含「添加到桌面/主屏幕」提示:", r5.tip);

  /* share.html 安装按钮 */
  const p2 = await ctx.newPage(); p2.on("pageerror", e => errs.push("[share] " + e.message));
  await p2.goto(BASE + "share.html?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p2.waitForTimeout(600);
  await p2.evaluate(() => {
    window.__sp = 0;
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__sp++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await p2.waitForTimeout(300);
  const r6 = await p2.evaluate(() => ({ shown: document.getElementById("ins").style.display }));
  await p2.evaluate(() => document.getElementById("ins").click());
  await p2.waitForTimeout(300);
  const r7 = await p2.evaluate(() => window.__sp);
  console.log("S6 share.html 安装按钮显示:", r6.shown === "flex", "| prompt 调用:", r7 === 1);

  console.log("PAGEERRORS:", errs.length ? errs.join(" | ").slice(0, 300) : "无");
  await b.close();
})();
