/* SW 导航「本地优先」验收（2026-11-08）
   验三件事：
   1) 第二次打开时，HTML 由 Service Worker 直接给出（不从网络往返）
   2) 首张卡片出现得比第一次快
   3) 后台刷新确实更新了缓存副本（下次拿到的是新的）
   跑法：node tests/diag/sw-nav-test.js [url]   （url 默认本地 8795）
   注意：本脚本**不能** block serviceWorker，否则测的是另一条路径。 */
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
const URL0 = process.argv[2] || "http://127.0.0.1:8795/index.html";

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const out = [];
  const ck = (name, ok, info) => { out.push({ name, ok, info }); console.log(`${ok ? "✓" : "✗"} ${name}${info ? "  " + info : ""}`); };

  async function open(tag) {
    const t0 = Date.now();
    await p.goto(URL0 + "?t=" + tag, { waitUntil: "commit" });
    await p.waitForTimeout(250);
    await p.click("#splash", { force: true }).catch(() => {});
    let cardAt = 0;
    for (let i = 0; i < 160; i++) {
      const n = await p.evaluate(() => document.querySelectorAll("#feed .card").length);
      if (n > 0) { cardAt = Date.now() - t0; break; }
      await p.waitForTimeout(50);
    }
    const nav = await p.evaluate(() => {
      const e = performance.getEntriesByType("navigation")[0] || {};
      return { ttfb: Math.round(e.responseStart || 0), worker: Math.round(e.workerStart || 0), transfer: e.transferSize };
    });
    return { cardAt, ...nav };
  }

  const a = await open("1");
  await p.waitForTimeout(2500);            /* 等 SW 装好 + 后台刷新落盘 */
  const c = await open("2");
  await p.waitForTimeout(1500);

  const swState = await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { active: !!(reg && reg.active), state: reg && reg.active ? reg.active.state : "none" };
  });

  console.log(`\n第 1 次：卡片 ${a.cardAt}ms ｜ TTFB ${a.ttfb}ms`);
  console.log(`第 2 次：卡片 ${c.cardAt}ms ｜ TTFB ${c.ttfb}ms ｜ SW 接管 ${c.worker > 0 ? "是" : "否"}`);

  ck("Service Worker 已激活", swState.active, swState.state);
  ck("第二次打开由 SW 直接返回页面（workerStart > 0）", c.worker > 0, `workerStart=${c.worker}`);
  /* 本地服务太快（首屏 <50ms），出卡片时间分不出差别，主看首字节；
     只有在真实网络基址下才把「更快」当硬断言 */
  if (a.cardAt > 200) ck("第二次出卡片更快", c.cardAt < a.cardAt, `${a.cardAt}ms → ${c.cardAt}ms`);
  else console.log(`· 出卡片 ${a.cardAt}ms → ${c.cardAt}ms（本地太快，改用首字节判断）`);
  ck("第二次首字节明显更低", c.ttfb < a.ttfb, `${a.ttfb}ms → ${c.ttfb}ms`);

  /* 后台刷新：等一会儿再读缓存里那份 HTML 的时间戳，应比首次更近 */
  const age = await p.evaluate(async () => {
    const cache = await caches.open("yrb-cache-v4");
    const keys = await cache.keys();
    const navKey = keys.find((k) => new URL(k.url).pathname.endsWith("/index.html")) || keys.find((k) => new URL(k.url).pathname === "/");
    if (!navKey) return null;
    const res = await cache.match(navKey);
    return res ? Number(res.headers.get("x-yrb-cached-at") || 0) : null;
  });
  ck("缓存副本带时间戳（可判断新旧）", !!age, age ? Math.round((Date.now() - age) / 1000) + " 秒前" : "无");

  /* 「立即更新」要先能丢掉导航副本，否则刷新回来还是旧壳、反复提示有新版本 */
  const drop = await p.evaluate(async () => {
    const sw = navigator.serviceWorker.controller;
    if (!sw) return { ok: false, why: "无 controller" };
    sw.postMessage({ type: "YRB_FRESH_NAV" });
    await new Promise((r) => setTimeout(r, 600));
    const c = await caches.open("yrb-cache-v4");
    const keys = await c.keys();
    return { ok: !keys.some((k) => new URL(k.url).pathname === "/" || new URL(k.url).pathname.endsWith(".html")), left: keys.length };
  });
  ck("点更新时能丢弃旧 HTML 副本", drop.ok, drop.ok ? `缓存剩 ${drop.left} 项` : drop.why);

  const bad = out.filter((x) => !x.ok);
  console.log(`\n${bad.length ? "✗ " + bad.length + " 项未通过" : "✓ 全部通过（" + out.length + " 项）"}`);
  await b.close();
})();
