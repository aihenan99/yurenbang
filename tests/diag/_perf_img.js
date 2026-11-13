/* 图片加载专项诊断（2026-11-06）
   目的：把「打开图片慢」拆成可量化事实 —— 每张图的域名、字节、耗时，
   以及首图出现时刻。用于对比「签名直连 Supabase」与「同源 /sbapi」两种路径。
   用法：node tests/diag/_perf_img.js [url] */
const path = require("path");
const { chromium } = require(path.join(__dirname, "../../temp/pw/node_modules/playwright-core"));
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL = process.argv[2] || "https://xn--gmqq09al6z.cn/";

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

  const start = Date.now();
  const store = [];   // storage 相关请求
  const signs = [];   // 签名请求

  page.on("request", (r) => {
    const u = r.url();
    if (!/storage\/v1\/object\/sign/.test(u)) return;
    const rec = { url: u, host: "", t0: Date.now() - start, bytes: 0, dur: 0, done: false };
    try { const x = new URL(u); rec.host = x.host; rec.path = x.pathname; } catch (e) {}
    // 区分「签名接口」(返回 JSON) 与「图片字节」
    if (/\/object\/sign\/media\/.+/.test(rec.path || "")) {
      store.push(rec);
      r._rec = rec;
    } else {
      signs.push(rec);
      r._rec = rec;
    }
  });
  const finish = (r, extra) => {
    const rec = r._rec; if (!rec) return;
    rec.dur = Date.now() - start - rec.t0;
    rec.done = true;
    if (extra) Object.assign(rec, extra);
  };
  page.on("response", async (res) => {
    const r = res.request();
    if (!r._rec) return;
    try {
      const len = res.headers()["content-length"];
      const buf = await res.body().catch(() => null);
      finish(r, { bytes: buf ? buf.length : Number(len || 0), status: res.status(), ct: (res.headers()["content-type"] || "").split(";")[0] });
    } catch (e) { finish(r, { status: res.status() }); }
  });
  page.on("requestfailed", (r) => finish(r, { status: "FAIL" }));

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  // 给足时间：签名 → 下载 → 解码
  await page.waitForTimeout(15000);

  const dom = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("#feed img.real-img, #feed .c-photo")];
    return {
      total: imgs.length,
      complete: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      pending: imgs.filter((i) => !i.complete).length,
      sample: imgs.slice(0, 3).map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })),
    };
  });

  console.log("== 图片元素状态 ==");
  console.log(`  共 ${dom.total} 张 ｜ 已解码 ${dom.complete} ｜ 破图 ${dom.broken} ｜ 仍在等 ${dom.pending}`);
  dom.sample.forEach((s) => console.log(`  样本 ${String(s.src).slice(0, 110)} (${s.w}px)`));

  console.log("\n== 签名请求（JSON）==");
  const byHost = {};
  signs.forEach((s) => {
    byHost[s.host] = (byHost[s.host] || 0) + 1;
    console.log(`  ${String(s.dur).padStart(5)}ms  ${String(s.bytes).padStart(6)}B  ${s.status}  ${s.host}${(s.path || "").slice(0, 40)}`);
  });
  console.log("  签名合计:", signs.length, "次 ｜ 总耗时", signs.reduce((a, b) => a + b.dur, 0), "ms");

  console.log("\n== 图片字节请求 ==");
  const st = store.filter((s) => s.done);
  st.sort((a, b) => a.t0 - b.t0);
  st.slice(0, 20).forEach((s) => {
    console.log(`  ${String(s.dur).padStart(5)}ms  ${String((s.bytes / 1024).toFixed(1)).padStart(7)}KB  ${s.status}  ${s.host}${(s.path || "").slice(0, 34)}`);
  });
  const totalKB = st.reduce((a, b) => a + b.bytes, 0) / 1024;
  console.log(`  图片 ${st.length} 张 ｜ 合计 ${totalKB.toFixed(0)}KB ｜ 最慢 ${Math.max(0, ...st.map((s) => s.dur))}ms`);
  const hosts = {};
  st.forEach((s) => { hosts[s.host] = (hosts[s.host] || 0) + 1; });
  console.log("  按域名:", JSON.stringify(hosts));

  await browser.close();
})();
