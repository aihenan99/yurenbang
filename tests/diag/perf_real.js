/* 真机场景滚动实测：用境内站真实数据（有真实图片），统计
   ① 滚动帧率 ② 滚动中发生的布局抖动（CLS）③ 图片是否引起重排
   用法：node temp/perf_real.js [url] */
const { chromium } = require("./pw/node_modules/playwright-core");
const SITE = process.argv[2] || "http://118.89.185.37/";
const RATE = Number(process.env.CPU_RATE || 6);

(async () => {
  const b = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  });
  const ctx = await b.newContext({
    viewport: { width: 412, height: 900 }, serviceWorkers: "block",
    isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  await p.goto(SITE + "?r=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(1500);

  const info = await p.evaluate(() => {
    const cards = document.querySelectorAll("#feed .card").length;
    const imgs = [...document.querySelectorAll("#feed img")];
    const noSize = imgs.filter(i => !i.getAttribute("width") && !i.getAttribute("height") && !i.style.aspectRatio).length;
    return {
      cards, imgs: imgs.length, noSize,
      feedH: document.getElementById("page-home").scrollHeight,
      withMedia: document.querySelectorAll("#feed .card.has-media").length,
      computedAspect: imgs.length ? getComputedStyle(imgs[0]).aspectRatio : "-"
    };
  });
  console.log("真实页面：卡片", info.cards, "带媒体", info.withMedia, "图片", info.imgs,
    "无尺寸约束", info.noSize, "内容高", info.feedH, "px  aspect-ratio=", info.computedAspect);

  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  console.log("CPU 节流", RATE + "x");

  await p.evaluate(() => {
    window.__fr = { gaps: [], on: false };
    window.__cls = 0; window.__shifts = [];
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(+e.value.toFixed(4)); }
      }
    }).observe({ type: "layout-shift", buffered: false });
    window.__start = () => {
      const s = window.__fr; s.gaps = []; s.on = true; let last = performance.now();
      (function loop() { if (!s.on) return; const n = performance.now(); s.gaps.push(n - last); last = n; requestAnimationFrame(loop); })();
    };
    window.__stop = () => {
      const s = window.__fr; s.on = false;
      const g = s.gaps.slice(1).sort((a, b) => a - b);
      if (!g.length) return null;
      const q = t => g[Math.min(g.length - 1, Math.floor(g.length * t))];
      return { n: g.length, p50: +q(.5).toFixed(1), p90: +q(.9).toFixed(1), p95: +q(.95).toFixed(1),
        max: +g[g.length - 1].toFixed(1), drop: +(g.filter(x => x > 25).length / g.length * 100).toFixed(1),
        cls: +window.__cls.toFixed(3), shifts: window.__shifts.length };
    };
  });

  async function roll(ms) {
    await p.evaluate(() => window.__start());
    let y = 700, dir = 1;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (y > 820 || y < 150) dir = -dir;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y }] });
      for (let k = 0; k < 8; k++) {
        y += dir * 30;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 206, y }] });
        await p.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await p.waitForTimeout(40);
    }
    return await p.evaluate(() => window.__stop());
  }

  const addCSS = css => p.evaluate(c => {
    let s = document.getElementById("perf-probe");
    if (!s) { s = document.createElement("style"); s.id = "perf-probe"; document.head.appendChild(s); }
    s.textContent = c;
  }, css);

  async function measure(tag, css) {
    await addCSS(css || "");
    await p.evaluate(() => document.getElementById("page-home").scrollTo(0, 0));
    await p.waitForTimeout(500);
    const r = await roll(3200);
    console.log(tag.padEnd(34) + (r ? `p50 ${r.p50} p90 ${r.p90} p95 ${r.p95} max ${r.max} 掉帧 ${r.drop}% CLS ${r.cls}` : "无样本"));
    return r;
  }

  await measure("① 现状");
  await measure("② +卡片 content-visibility", ".card{content-visibility:auto;contain-intrinsic-size:auto 420px}");
  await measure("③ +关常驻模糊", "#funcrow,#topbar,#tabbar{backdrop-filter:none!important}");
  await measure("④ +关卡片阴影", ".card{box-shadow:none!important}");
  await measure("⑤ +图片占位比", "#feed .real-img{aspect-ratio:4/3;object-fit:cover;background:#eee}");
  await measure("⑥ 全叠加", `.card{content-visibility:auto;contain-intrinsic-size:auto 420px;box-shadow:none!important}
    #funcrow,#topbar,#tabbar{backdrop-filter:none!important}
    #feed .real-img{aspect-ratio:4/3;object-fit:cover;background:#eee}`);

  await b.close();
})();
