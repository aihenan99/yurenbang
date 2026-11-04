/* 滚动渲染性能诊断：逐项关掉可疑样式做 A/B，定位真正的卡顿源
   用法：node temp/perf_scroll.js [url] */
const { chromium } = require("./pw/node_modules/playwright-core");
const SITE = process.argv[2] || "http://127.0.0.1:8794/";

function feedData(n) {
  const out = [];
  const t = ["孩子不爱写作业怎么办", "两岁孩子挑食怎么破", "幼儿园分离焦虑", "二宝抢玩具打架",
    "要不要报早教班", "孩子夜里总是醒", "打人该怎么管", "认字早了有坏处吗"];
  for (let i = 0; i < n; i++) {
    out.push({
      id: 95000 + i, title: t[i % t.length] + "（" + (i + 1) + "）",
      text: "试了好多办法都没用，请有经验的家长支支招。孩子今年刚上幼儿园，每天回家都闷闷不乐，问他也不说，我们做家长的实在没辙了。",
      type: "img", user: "测试家长" + (i + 1), tag: "求助",
      likes: 3 + i, helps: i, comments: i % 5, time: "1 小时前"
    });
  }
  return out;
}

/* 在页面里用 rAF 采样帧间隔：边滚边记 */
const SAMPLER = () => {
  window.__fr = { on: false, gaps: [], snaps: [] };
  window.__startSample = function () {
    const s = window.__fr; s.gaps = []; s.on = true;
    let last = performance.now();
    (function loop() {
      if (!s.on) return;
      const now = performance.now();
      s.gaps.push(now - last); last = now;
      requestAnimationFrame(loop);
    })();
  };
  window.__stopSample = function () {
    window.__fr.on = false;
    const g = window.__fr.gaps.slice(1).sort((a, b) => a - b);
    if (!g.length) return null;
    const pick = q => g[Math.min(g.length - 1, Math.floor(g.length * q))];
    return {
      n: g.length, p50: +pick(.5).toFixed(1), p90: +pick(.9).toFixed(1), p95: +pick(.95).toFixed(1),
      max: +g[g.length - 1].toFixed(1),
      drop: +(g.filter(x => x > 25).length / g.length * 100).toFixed(1)   /* >25ms 视为掉帧 */
    };
  };
};

async function roll(p, ms) {
  const cdp = await p.context().newCDPSession(p);
  await p.evaluate(() => window.__startSample && window.__startSample());
  const t0 = Date.now();
  let dir = 1, y = 400, ts = 0;
  while (Date.now() - t0 < ms) {
    /* 真实触摸：按下 → 连续 move → 抬起，比 wheel 更接近手机 */
    if (y > 800 || y < 120) dir = -dir;
    ts = Date.now() / 1000;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y }] });
    for (let k = 0; k < 6; k++) {
      y += dir * 22;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: 206, y }], timestamp: ts + k * 0.016
      });
      await p.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(30);
    if (Math.random() < 0.1) dir = -dir;
  }
  return await p.evaluate(() => window.__stopSample());
}

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
  const cdp0 = await ctx.newCDPSession(p);
  const RATE = Number(process.env.CPU_RATE || 6);
  await cdp0.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  console.log("CPU 节流", RATE + "x（模拟低端手机）");
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(SITE + "?perf=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);

  /* 注 16 张卡，让信息流长到能连续滚 */
  const n = await p.evaluate(d => {
    try { S.posts = d; renderFeed(); } catch (e) { return -1; }
    return document.querySelectorAll("#feed .card, #feed article, #feed > *").length;
  }, feedData(16));
  await p.waitForTimeout(800);
  await p.evaluate(SAMPLER);
  const h = await p.evaluate(() => document.getElementById("page-home").scrollHeight);
  console.log("卡片节点数", n, "滚动内容高度", h, "px");

  const addCSS = css => p.evaluate(c => {
    const s = document.createElement("style"); s.id = "perf-probe"; s.textContent = c;
    document.head.appendChild(s);
  }, css);
  const delCSS = () => p.evaluate(() => { const e = document.getElementById("perf-probe"); if (e) e.remove(); });

  const rows = [];
  async function measure(tag, css) {
    if (css) await addCSS(css);
    await p.evaluate(() => document.getElementById("page-home").scrollTo(0, 0));
    await p.waitForTimeout(400);
    const r = await roll(p, 3000);
    rows.push([tag, r]);
    if (css) await delCSS();
    return r;
  }

  await measure("① 现状（不改）", "");
  await measure("② 关掉全部 backdrop-filter", "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}");
  await measure("③ 只关 #funcrow 的模糊", "#funcrow{backdrop-filter:none!important}");
  await measure("④ 只关 #topbar/#tabbar 模糊", "#topbar,#tabbar{backdrop-filter:none!important}");
  await measure("⑤ 关掉卡片阴影", ".card{box-shadow:none!important}");
  await measure("⑥ 关掉 sticky 吸顶", "#funcrow{position:static!important}");
  await measure("⑦ 恢复现状复测", "");

  console.log("\n%-28s %7s %7s %7s %7s %8s", "场景", "p50", "p90", "p95", "max", "掉帧%");
  for (const [tag, r] of rows) {
    if (!r) { console.log(tag, "无样本"); continue; }
    console.log(
      tag.padEnd(30 - (tag.length - [...tag].length)) +
      String(r.p50).padStart(7) + String(r.p90).padStart(7) + String(r.p95).padStart(7) +
      String(r.max).padStart(7) + String(r.drop).padStart(8) + "   (n=" + r.n + ")"
    );
  }
  if (errs.length) console.log("\n脚本错误:", errs.slice(0, 3));
  await b.close();
})();
