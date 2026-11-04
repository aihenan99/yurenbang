/* 对照组：自动朗读「开」vs「关」，滚动时各付出多少代价
   统计 TTS 请求数、音频元素创建数、帧率、DOM 变更数 */
const { chromium } = require("./pw/node_modules/playwright-core");
const SITE = process.argv[2] || "http://127.0.0.1:8794/";
const RATE = Number(process.env.CPU_RATE || 6);

function feedData(n) {
  const t = ["孩子不爱写作业怎么办", "两岁孩子挑食怎么破", "幼儿园分离焦虑", "二宝抢玩具打架",
    "要不要报早教班", "孩子夜里总是醒", "打人该怎么管", "认字早了有坏处吗"];
  const out = [];
  for (let i = 0; i < n; i++) out.push({
    id: 95000 + i, title: t[i % t.length],
    text: "试了好多办法都没用，请有经验的家长支支招。孩子今年刚上幼儿园，每天回家都闷闷不乐，问他也不说，我们做家长的实在没辙了。",
    type: "img", user: "测试家长" + (i + 1), tag: "求助",
    likes: 3 + i, helps: i, comments: i % 5, time: "1 小时前"
  });
  return out;
}

async function run(b, autoOn) {
  const ctx = await b.newContext({
    viewport: { width: 412, height: 900 }, serviceWorkers: "block",
    isMobile: true, hasTouch: true, deviceScaleFactor: 2
  });
  const init = `try{localStorage.setItem('yrb_autospeak','${autoOn ? "1" : "0"}');}catch(e){}` +
    `Object.defineProperty(navigator,'webdriver',{get:()=>false});` +
    /* 打点：TTS 请求 + Audio 创建 */
    `window.__ttsN=0;window.__audioN=0;` +
    `{const f=window.fetch;window.fetch=function(u){if(String(u).indexOf('/yrbtts')>-1)window.__ttsN++;return f.apply(this,arguments)};}` +
    `{const A=window.Audio;window.Audio=function(){window.__audioN++;return new A(...arguments)};}` +
    `window.__domN=0;`;
  await ctx.addInitScript(init);
  const p = await ctx.newPage();
  await p.goto(SITE + "?as=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1600);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(d => { try { S.posts = d; renderFeed(); } catch (e) {} }, feedData(10));
  await p.waitForTimeout(900);

  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });

  await p.evaluate(() => {
    window.__domN = 0;
    new MutationObserver(ms => { window.__domN += ms.length; })
      .observe(document.getElementById("feed"), { childList: true, subtree: true, attributes: true });
    window.__fr = { gaps: [], on: false };
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
        max: +g[g.length - 1].toFixed(1), drop: +(g.filter(x => x > 25).length / g.length * 100).toFixed(1) };
    };
  });

  await p.evaluate(() => { window.__ttsN = 0; window.__audioN = 0; window.__start(); });
  let y = 700, dir = 1;
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    if (y > 820 || y < 150) dir = -dir;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y }] });
    for (let k = 0; k < 8; k++) {
      y += dir * 30;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 206, y }] });
      await p.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(45);
  }
  const r = await p.evaluate(() => window.__stop());
  const extra = await p.evaluate(() => ({ tts: window.__ttsN, audio: window.__audioN, dom: window.__domN }));
  await ctx.close();
  return { r, extra };
}

(async () => {
  const b = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  });
  console.log("CPU 节流", RATE + "x\n");
  for (const on of [false, true]) {
    const { r, extra } = await run(b, on);
    const tag = on ? "自动朗读【开】" : "自动朗读【关】";
    console.log(tag.padEnd(18) +
      (r ? `p50 ${r.p50} p90 ${r.p90} p95 ${r.p95} max ${r.max} 掉帧 ${r.drop}%` : "无样本") +
      `   TTS请求 ${extra.tts} 次  Audio 新建 ${extra.audio}  DOM变更 ${extra.dom} 次`);
  }
  await b.close();
})();
