/* 复现「标记求助已解决」卡死：注入一条我的求助 → 详情 → 标记已解决 → 确认 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  p.setDefaultTimeout(15000);
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1000);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.tap("#splash"); await p.waitForTimeout(700); }

  // 注入一条我的求助 + 一条帮忙，并打开详情
  await p.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver(l => l.getEntries().forEach(t => window.__lt.push([t.startTime | 0, t.duration]))).observe({ entryTypes: ["longtask"] });
    S.posts.unshift({ id: 9101, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "求助内容测试", likes: 0, liked: false, favs: 0, faved: false, helps: 1, kinds: ["study"], media: [], roses: [],
      comments: [{ user: "李妈妈", flag: "🇨🇳", ava: "bear", kind: "text", text: "多陪孩子聊聊", likes: 0, liked: false }] });
    renderFeed();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-r23detail="9101"]').click());
  await p.waitForTimeout(500);
  console.log("1) 详情打开:", await p.evaluate(() => document.querySelector("#r23Detail").classList.contains("open")));

  // 点「标记已解决」
  const t0 = Date.now();
  await p.evaluate(() => document.querySelector(".r23-solve").click());
  await p.waitForTimeout(400);
  console.log("2) 确认弹窗打开:", await p.evaluate(() => document.querySelector("#modal").classList.contains("open")),
    "耗时", Date.now() - t0, "ms; longtask:", await p.evaluate(() => JSON.stringify(window.__lt)));

  // 监测：弹窗开着静置 2 秒（若 observer 死循环，这里会有持续变化）
  const mut0 = await p.evaluate(() => { window.__mc = 0; new MutationObserver(m => { window.__mc += m.length; }).observe(document.body, { childList: true, subtree: true }); return 1; });
  await p.waitForTimeout(2000);
  console.log("3) 弹窗静置 2s 的 DOM 变动数:", await p.evaluate(() => window.__mc), "(>50 即有死循环)");

  // 点「确认已解决」
  await p.evaluate(() => { window.__lt = []; });
  const t1 = Date.now();
  await p.evaluate(() => document.querySelector("#r23SolveOk").click());
  await p.waitForTimeout(1500);
  const after = await p.evaluate(() => ({
    modalOpen: document.querySelector("#modal").classList.contains("open"),
    detailStatus: (document.querySelector(".r23-status") || {}).textContent,
    lt: window.__lt
  }));
  console.log("4) 确认后 → 弹窗关闭:", !after.modalOpen, "| 状态栏:", (after.detailStatus || "").replace(/\s+/g, " ").slice(0, 30),
    "| 耗时", Date.now() - t1, "ms | longtask:", JSON.stringify(after.lt));

  // 再静置 2 秒确认没有后续死循环
  await p.evaluate(() => { window.__mc = 0; });
  await p.waitForTimeout(2000);
  console.log("5) 确认后静置 2s 的 DOM 变动数:", await p.evaluate(() => window.__mc));

  // 再想想按钮也测一下（新开一个弹窗）
  await p.evaluate(() => document.querySelector(".r23-solve").click());
  await p.waitForTimeout(300);
  const t2 = Date.now();
  await p.evaluate(() => document.querySelector('#mdCard [data-x="close"]').click());
  await p.waitForTimeout(400);
  console.log("6) 再想想关闭:", await p.evaluate(() => !document.querySelector("#modal").classList.contains("open")),
    "耗时", Date.now() - t2, "ms");

  await b.close();
  console.log("DONE");
})().catch(e => { console.error("FATAL", e); process.exit(1); });
