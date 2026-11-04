/* 境内站首屏性能实测：打开页面 → 等渲染完成 → 读 Performance API
   目的：把「浏览非常慢」拆成可量化的清单（哪个请求、多少字节、多少毫秒）
   用法：node tests/diag/_perf_cn.js [url] */
const path = require("path");
const { chromium } = require(path.join(__dirname, "../../temp/pw/node_modules/playwright-core"));
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

const URL = process.argv[2] || "http://118.89.185.37/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    serviceWorkers: "block",
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  const reqs = new Map();
  page.on("request", (r) => {
    reqs.set(r, { url: r.url(), method: r.method(), start: Date.now(), type: r.resourceType() });
  });
  page.on("requestfinished", async (r) => {
    const o = reqs.get(r); if (!o) return;
    try {
      const resp = await r.response();
      const sizes = await r.sizes();
      o.status = resp ? resp.status() : 0;
      o.ms = Date.now() - o.start;
      o.bytes = (sizes && sizes.responseBodySize) || 0;
      o.ok = true;
    } catch { o.ok = false; }
  });
  page.on("requestfailed", (r) => {
    const o = reqs.get(r); if (!o) return;
    o.ms = Date.now() - o.start; o.fail = r.failure()?.errorText || "failed";
  });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "load", timeout: 90000 }).catch((e) => console.log("goto:", e.message));
  const tLoad = Date.now() - t0;

  // 等首屏数据落地（信息流卡片出现）
  await page
    .waitForFunction(() => {
      const f = document.querySelectorAll("#feed .card, #feed .p-card, .card");
      return f.length > 0;
    }, { timeout: 25000 })
    .catch(() => {});
  const tFeed = Date.now() - t0;

  await page.waitForTimeout(2500); // 让懒加载/图片/二次刷新跑完

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const res = performance.getEntriesByType("resource").map((r) => ({
      name: r.name,
      type: r.initiatorType,
      start: Math.round(r.startTime),
      dur: Math.round(r.duration),
      size: r.transferSize || 0,
      dec: r.decodedBodySize || 0,
    }));
    const cards = document.querySelectorAll(".card, .p-card").length;
    return {
      ttfb: Math.round(nav.responseStart || 0),
      domReady: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEnd: Math.round(nav.loadEventEnd || 0),
      res,
      cards,
      imgs: Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).length,
    };
  });

  console.log("== 里程碑 ==");
  console.log("  首字节 TTFB      ", perf.ttfb + "ms");
  console.log("  DOMContentLoaded ", perf.domReady + "ms");
  console.log("  load 事件        ", perf.loadEnd + "ms", "（实测 goto 耗时 " + tLoad + "ms）");
  console.log("  信息流卡片出现   ", tFeed + "ms");
  console.log("  卡片数           ", perf.cards, "｜未完成图片", perf.imgs);

  const rs = perf.res.slice().sort((a, b) => b.dur - a.dur);
  const total = rs.reduce((s, r) => s + r.size, 0);
  console.log("\n== 传输总量 == ", (total / 1024).toFixed(1) + "KB", "｜请求数", rs.length);

  console.log("\n== 最慢 15 个请求 ==");
  for (const r of rs.slice(0, 15)) {
    const u = r.name.replace(URL.replace(/\/$/, ""), "").slice(0, 58);
    console.log(
      "  " + String(r.dur).padStart(5) + "ms",
      "start=" + String(r.start).padStart(5),
      String((r.size / 1024).toFixed(1)).padStart(7) + "KB",
      u
    );
  }

  console.log("\n== 按类型汇总 ==");
  const g = {};
  for (const r of rs) {
    const k = r.type || "other";
    g[k] = g[k] || { n: 0, kb: 0, ms: 0 };
    g[k].n++; g[k].kb += r.size; g[k].ms = Math.max(g[k].ms, r.dur);
  }
  for (const [k, v] of Object.entries(g).sort((a, b) => b[1].kb - a[1].kb)) {
    console.log("  " + k.padEnd(12), "n=" + String(v.n).padStart(3), (v.kb / 1024).toFixed(1).padStart(7) + "KB", "最慢 " + v.ms + "ms");
  }

  console.log("\n== /sbapi 请求明细 ==");
  for (const r of rs.filter((r) => r.name.includes("/sbapi"))) {
    console.log("  " + String(r.dur).padStart(5) + "ms", String((r.size / 1024).toFixed(1)).padStart(7) + "KB", r.name.split("/sbapi")[1].slice(0, 90));
  }

  /* ---- 回归断言（2026-11-04）----
     首屏绝不该拉娇娇二维码：它是 149KB 的 base64，只在「娇娇」页显示。
     曾经被 boot / cloud-ready / license 预热各拉一次，三次共 448KB、4.5 秒。
     这里做成断言，谁改回去当场就能看见。 */
  console.log("\n== 回归断言 ==");
  const qr = rs.filter((r) => r.name.includes("jiaojiao_qr"));
  if (qr.length) {
    console.log("  ✗ 首屏仍在拉娇娇二维码 " + qr.length + " 次（"
      + (qr.reduce((s, r) => s + r.size, 0) / 1024).toFixed(1) + "KB）—— 应改为进入娇娇页才拉");
    process.exitCode = 1;
  } else {
    console.log("  ✓ 首屏未拉娇娇二维码");
  }
  const bigFetch = rs.filter((r) => r.type === "fetch" && r.size > 60 * 1024);
  if (bigFetch.length) {
    console.log("  ✗ 首屏有超过 60KB 的数据请求：" + bigFetch.map((r) => r.name.split("/sbapi")[1]?.slice(0, 40) + "=" + (r.size / 1024).toFixed(0) + "KB").join("，"));
    process.exitCode = 1;
  } else {
    console.log("  ✓ 数据请求都在 60KB 以内");
  }

  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
