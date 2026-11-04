/* 滚动优化方案 A/B/C 对比（本地桩帖 16 张，CPU 节流） */
const { chromium } = require("./pw/node_modules/playwright-core");
const SITE = process.argv[2] || "http://127.0.0.1:8794/";
const RATE = Number(process.env.CPU_RATE || 8);

function feedData(n) {
  const t = ["孩子不爱写作业怎么办", "两岁孩子挑食怎么破", "幼儿园分离焦虑", "二宝抢玩具打架",
    "要不要报早教班", "孩子夜里总是醒", "打人该怎么管", "认字早了有坏处吗"];
  const out = [];
  for (let i = 0; i < n; i++) out.push({
    id: 95000 + i, title: t[i % t.length],
    text: "试了好多办法都没用，请有经验的家长支支招。孩子今年刚上幼儿园，每天回家都闷闷不乐，问他也不说，我们做家长的实在没辙了。每天放学回来先哭一场，问他发生了什么也说不清。",
    type: "img", user: "测试家长" + (i + 1), tag: "求助",
    likes: 3 + i, helps: i, comments: i % 5, time: "1 小时前"
  });
  return out;
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
  await p.goto(SITE + "?o=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(d => { try { S.posts = d; renderFeed(); } catch (e) {} }, feedData(16));
  await p.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  console.log("CPU 节流", RATE + "x，16 张卡\n");

  await p.evaluate(() => {
    window.__fr = { gaps: [], on: false };
    window.__start = () => { const s = window.__fr; s.gaps = []; s.on = true; let last = performance.now();
      (function loop() { if (!s.on) return; const n = performance.now(); s.gaps.push(n - last); last = n; requestAnimationFrame(loop); })(); };
    window.__stop = () => { const s = window.__fr; s.on = false;
      const g = s.gaps.slice(1).sort((a, b) => a - b); if (!g.length) return null;
      const q = t => g[Math.min(g.length - 1, Math.floor(g.length * t))];
      return { n: g.length, p50: +q(.5).toFixed(1), p75: +q(.75).toFixed(1), p90: +q(.9).toFixed(1),
        p95: +q(.95).toFixed(1), max: +g[g.length - 1].toFixed(1),
        drop: +(g.filter(x => x > 25).length / g.length * 100).toFixed(1) }; };
  });

  const setCSS = css => p.evaluate(c => {
    let s = document.getElementById("perf-probe");
    if (!s) { s = document.createElement("style"); s.id = "perf-probe"; document.head.appendChild(s); }
    s.textContent = c;
  }, css);

  async function measure(tag, css) {
    await setCSS(css || "");
    await p.evaluate(() => document.getElementById("page-home").scrollTo(0, 0));
    await p.waitForTimeout(500);
    await p.evaluate(() => window.__start());
    let y = 700, dir = 1;
    const t0 = Date.now();
    while (Date.now() - t0 < 3500) {
      if (y > 820 || y < 150) dir = -dir;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y }] });
      for (let k = 0; k < 8; k++) {
        y += dir * 28;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 206, y }] });
        await p.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await p.waitForTimeout(40);
    }
    const r = await p.evaluate(() => window.__stop());
    console.log(tag.padEnd(30) + (r ? `p50 ${String(r.p50).padStart(5)} p75 ${String(r.p75).padStart(5)} p90 ${String(r.p90).padStart(5)} p95 ${String(r.p95).padStart(5)} max ${String(r.max).padStart(6)} 掉帧 ${String(r.drop).padStart(4)}%` : "无样本"));
    return r;
  }

  await measure("① 现状");
  await measure("② 卡片 contain:content", ".card{contain:content}");
  await measure("③ 卡片 content-visibility", ".card{content-visibility:auto;contain-intrinsic-size:auto 420px}");
  await measure("④ 关常驻模糊", "#funcrow,#topbar,#tabbar{backdrop-filter:none!important}");
  await measure("⑤ 关阴影", ".card{box-shadow:none!important}");
  await measure("⑥ ③+④+⑤ 全上", `.card{content-visibility:auto;contain-intrinsic-size:auto 420px;box-shadow:none!important}
    #funcrow,#topbar,#tabbar{backdrop-filter:none!important}`);
  await measure("⑦ 复原复测");

  await b.close();
})();
