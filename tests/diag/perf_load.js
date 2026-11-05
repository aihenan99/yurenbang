/**
 * 首屏加载实测（2026-11-05）
 * 目的：给「流畅性」一个可比的数字，而不是感觉。
 * 量什么：TTFB / FCP / LCP / DCL / load、请求数、传输字节、主线程长任务、
 *        脚本求值耗时（4 倍 CPU 降速，模拟长辈机）。
 * 用法：node tests/diag/perf_load.js            两站都跑
 *       node tests/diag/perf_load.js <url>      只跑一个
 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

const SITES = process.argv[2]
  ? [process.argv[2]]
  : ["https://xn--gmqq09al6z.cn/", "http://118.89.185.37/"];

async function once(browser, url) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 900 },
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  // 4 倍 CPU 降速：长辈机大致相当于桌面 1/4 的性能
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  let bytes = 0;
  let reqs = 0;
  const byType = {};
  page.on("response", async (r) => {
    reqs++;
  });

  await page.goto(url, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(2500);

  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const p = performance.getEntriesByType("paint") || [];
    const fcp = (p.find((x) => x.name === "first-contentful-paint") || {}).startTime || 0;
    const res = performance.getEntriesByType("resource") || [];
    const js = res.filter((x) => /javascript/.test(x.initiatorType) || /\.js/.test(x.name));
    /* transferSize 才是真实下载字节（含压缩后大小）；content-length 在分块传输时为空 */
    const sum = (arr) => arr.reduce((a, x) => a + (x.transferSize || 0), 0);
    return {
      ttfb: Math.round(nav.responseStart || 0),
      fcp: Math.round(fcp),
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      domNodes: document.querySelectorAll("*").length,
      cards: document.querySelectorAll("#feed .card").length,
      scriptCount: js.length,
      scriptEval: Math.round(js.reduce((a, x) => a + (x.duration || 0), 0)),
      resources: res.length,
      bytes: sum(res) + (nav.transferSize || 0),
      byType: {
        script: sum(res.filter((x) => /\.js(\?|$)/.test(x.name))),
        stylesheet: sum(res.filter((x) => /\.css(\?|$)/.test(x.name))),
        image: sum(res.filter((x) => x.initiatorType === "img" || /\.(jpg|png|webp|svg)(\?|$)/.test(x.name))),
        other: 0,
      },
      compressed: (() => {
        const b = res.find((x) => /bundle\.js/.test(x.name));
        return b ? Math.round((b.encodedBodySize || 0) / 1024) + "/" + Math.round((b.decodedBodySize || 0) / 1024) : "?";
      })(),
      biggest: Math.round(
        res.reduce((a, x) => Math.max(a, x.transferSize || 0), 0) / 1024
      ),
    };
  });

  const lt = await page.evaluate(
    () =>
      new Promise((res) => {
        let total = 0, n = 0;
        try {
          new PerformanceObserver((list) => {
            list.getEntries().forEach((e) => { total += e.duration; n++; });
          }).observe({ entryTypes: ["longtask"] });
        } catch (e) {}
        setTimeout(() => res({ total: Math.round(total), n }), 2000);
      })
  );

  await ctx.close();
  return {
    url,
    ttfb: m.ttfb,
    fcp: m.fcp,
    dcl: m.dcl,
    load: m.load,
    reqs,
    kb: Math.round(m.bytes / 1024),
    jsKb: Math.round(m.byType.script / 1024),
    cssKb: Math.round(m.byType.stylesheet / 1024),
    imgKb: Math.round(m.byType.image / 1024),
    bundle: m.compressed,
    scriptEval: m.scriptEval,
    domNodes: m.domNodes,
    cards: m.cards,
    longTaskMs: lt.total,
    longTaskN: lt.n,
  };
}

(async () => {
  /* 必须绕开本机代理：代理会剥掉 Accept-Encoding 并解压后再转发，
     于是 resource timing 里 encodedBodySize 会等于原始大小，得出
     「服务器没压缩」的错误结论（2026-11-05 踩过）。 */
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-proxy-server"],
  });
  const rows = [];
  for (const s of SITES) {
    for (let i = 0; i < 2; i++) {
      const r = await once(browser, s);
      if (i === 1) rows.push(r); // 第一次常受 DNS/TLS 影响，取第二次
    }
  }
  await browser.close();

  const pad = (v, n) => String(v).padStart(n);
  console.log("\n站点                          TTFB  FCP   DCL   load | 请求  传输    JS   CSS  图片  JS压缩(传/解) | 脚本求值 长任务  节点 卡片");
  for (const r of rows) {
    console.log(
      (r.url.replace(/^https?:\/\//, "").slice(0, 26)).padEnd(28) +
        pad(r.ttfb, 5) + pad(r.fcp, 5) + pad(r.dcl, 6) + pad(r.load, 6) + " |" +
        pad(r.reqs, 5) + pad(r.kb + "KB", 7) + pad(r.jsKb + "KB", 6) +
        pad(r.cssKb + "KB", 6) + pad(r.imgKb + "KB", 6) + pad(r.bundle+"KB", 13) + " |" +
        pad(r.scriptEval + "ms", 9) + pad(r.longTaskMs + "ms", 7) +
        pad(r.domNodes, 6) + pad(r.cards, 5)
    );
  }
  console.log("\n（4 倍 CPU 降速 + 禁用缓存，取第二轮，单位 ms/KB）\n");
  console.log(JSON.stringify(rows, null, 1));
})();
