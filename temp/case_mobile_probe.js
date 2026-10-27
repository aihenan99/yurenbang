/* 移动端真实模拟：触摸点按 + 逐字输入 + 长任务监测，定位上传案例面板卡顿 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36" });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.tap("#splash"); await p.waitForTimeout(800); }

  await p.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver(l => l.getEntries().forEach(t => window.__lt.push([t.startTime | 0, t.duration]))).observe({ entryTypes: ["longtask"] });
    try { if (window.YRB_CLOUD) { YRB_CLOUD.signedIn = () => true; YRB_CLOUD.name = () => "测试家长"; } } catch (e) {}
    switchTab("cases");
  });
  await p.waitForTimeout(300);

  const t0 = Date.now();
  await p.tap("#caseFab");
  await p.waitForTimeout(350);
  console.log("1) 点＋打开面板:", await p.evaluate(() => document.querySelector("#caseUpSheet").classList.contains("open")),
    "耗时", Date.now() - t0, "ms; longtask:", await p.evaluate(() => window.__lt.length));

  await p.evaluate(() => { window.__lt = []; });
  // 逐字输入「测试」
  await p.tap("#cuTitle");
  await p.type("#cuTitle", "测试", { delay: 120 });
  await p.waitForTimeout(250);
  console.log("2) 输入标题后 longtask:", await p.evaluate(() => JSON.stringify(window.__lt)),
    "值:", await p.evaluate(() => document.querySelector("#cuTitle").value));

  // 复现用户场景：先让广场筛选停在「图片」（截图中的状态），再去发布微视频
  await p.evaluate(() => {
    const img = document.querySelector('#caseTabs .ct[data-f="img"]');
    img && img.click();
  });
  await p.waitForTimeout(200);
  console.log("2b) 已切到「图片」筛选:", await p.evaluate(() => document.querySelector('#caseTabs .ct[data-f="img"]').classList.contains("on")));

  await p.evaluate(() => { window.__lt = []; });
  // 触摸选微视频
  await p.tap('#cuTypes .seg-btn[data-t="video"]');
  await p.waitForTimeout(250);
  console.log("3) 选微视频:", await p.evaluate(() => document.querySelector('#cuTypes .seg-btn[data-t="video"]').classList.contains("on")),
    "longtask:", await p.evaluate(() => JSON.stringify(window.__lt)));

  await p.evaluate(() => { window.__lt = []; });
  const t1 = Date.now();
  await p.tap("#cuGo");
  await p.waitForTimeout(800);
  console.log("4) 点发布 → 面板关闭:", await p.evaluate(() => !document.querySelector("#caseUpSheet").classList.contains("open")),
    "耗时", Date.now() - t1, "ms; longtask:", await p.evaluate(() => JSON.stringify(window.__lt)));
  const after = await p.evaluate(() => ({
    filterNow: document.querySelector("#caseTabs .ct.on").dataset.f,
    firstCardFresh: !!(document.querySelector("#caseGrid .case-card") || {}).className && document.querySelector("#caseGrid .case-card").classList.contains("fresh"),
    firstTitle: (document.querySelector("#caseGrid .c-title") || {}).textContent
  }));
  console.log("4b) 发布后：筛选自动回到 →", after.filterNow, "| 新卡片高亮 →", after.firstCardFresh, "| 第一张标题 →", after.firstTitle);

  // 面板开着时静置 3 秒看有没有持续长任务（卡死特征）
  await p.evaluate(() => { window.__lt = []; });
  await p.evaluate(() => document.querySelector("#caseFab").click());
  await p.waitForTimeout(3000);
  console.log("5) 面板静置 3s longtask 数:", await p.evaluate(() => window.__lt.length),
    JSON.stringify(await p.evaluate(() => window.__lt)));

  await p.screenshot({ path: "E:/育人帮/temp/case_sheet_mobile.png" });
  await b.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
