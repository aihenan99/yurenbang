/* 一屏到底要画多久（2026-11-05）

   为什么要有这个脚本：
   本项目的滚动在桌面 Chrome 上「零重绘」（滚动走合成线程，Paint 事件 2.2 秒里只出现
   4 次），所以用帧率、用 CPU 降速都测不出真机为什么卡——桌面 GPU + 分块光栅把代价
   全藏了。但真机（尤其微信 X5 / 老 Android WebView）没有这条快速路径，滑动时每帧
   都要重画一屏。于是换个测法：**人为强制整屏重绘，量一次重绘要多少毫秒**。

   桌面上的绝对值很小（毫秒级），但变体之间的倍率关系与真机一致：真机慢 10 倍，
   「3ms → 1ms」就是「30ms 卡顿 → 10ms 流畅」的差别。这就是选优化的依据，不是猜。

   做法：每次测量切一次 `#feed` 的背景色（触发子树全量重绘），从 Tracing 里取
   Paint / Layout / RasterTask 的耗时，取 7 次中位数。

   用法：node tests/diag/perf_paint.js [url]
*/
const BASE = (process.argv[2] || "http://118.89.185.37/").replace(/\/?$/, "/");
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

const VARIANTS = [
  ["基线（现状）", ""],
  ["卡片去阴影", ".card{box-shadow:none!important;border:1px solid #EFE7DC!important}"],
  ["全部去阴影+去渐变", "*{box-shadow:none!important}.p-ava,.pa-btn,.p-tag{background-image:none!important}"],
  ["去卡片圆角", ".card{border-radius:0!important}"],
  ["去头像 SVG", ".p-ava svg{display:none!important}"],
  ["去侧边操作列", ".p-side{display:none!important}"],
  ["文字去阴影/描边效果", ".post-text,.p-name,.p-sub{text-shadow:none!important;-webkit-text-stroke:0!important}"],
];

async function measure(b, css) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});"
  );
  const p = await ctx.newPage();
  await p.goto(BASE + "?paint=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(2200);
  if (css) await p.addStyleTag({ content: css });

  const cdp = await ctx.newCDPSession(p);
  const evts = [];
  cdp.on("Tracing.dataCollected", (d) => { if (d.value) evts.push(...d.value); });
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents",
  });

  /* 7 次整屏重绘：改 #feed 背景色，切换两次保证失效 */
  await p.evaluate(async () => {
    const f = document.getElementById("feed");
    const home = document.getElementById("page-home");
    if (home) home.scrollTop = 400;                 /* 落在有卡片的位置 */
    for (let i = 0; i < 7; i++) {
      f.style.background = i % 2 ? "#FFFFFF" : "#FEFEFE";
      f.offsetHeight;                               /* 强制样式与布局落地 */
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });

  await cdp.send("Tracing.end");
  await done;
  await ctx.close();

  const pick = {};
  for (const e of evts) {
    if (e.ph !== "X" || !e.dur) continue;
    if (e.name === "Paint" || e.name === "RasterTask" || e.name === "Layout" || e.name === "UpdateLayoutTree") {
      (pick[e.name] = pick[e.name] || []).push(e.dur / 1000);
    }
  }
  const med = (a) => (a && a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  const sum = (a) => (a || []).reduce((x, y) => x + y, 0);
  return {
    paintN: (pick.Paint || []).length,
    paintMed: med(pick.Paint),
    paintSum: sum(pick.Paint),
    rasterMed: med(pick.RasterTask),
    layoutMed: med(pick.Layout),
    styleMed: med(pick.UpdateLayoutTree),
  };
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const rows = [];
  for (const [label, css] of VARIANTS) rows.push({ label, ...(await measure(b, css)) });
  await b.close();

  const base = rows[0].paintSum || 1;
  console.log("\n站点 " + BASE + "  · 每次测量 = 7 次整屏重绘\n");
  console.log("变体".padEnd(22) + "Paint次".padStart(8) + "Paint合计ms".padStart(13) +
    "相对基线".padStart(10) + "单次中位ms".padStart(12) + "Layout中位".padStart(11));
  for (const r of rows) {
    const rel = ((r.paintSum / base - 1) * 100).toFixed(0);
    console.log(
      r.label.padEnd(22) + String(r.paintN).padStart(8) +
      r.paintSum.toFixed(1).padStart(13) +
      (r === rows[0] ? "—" : (rel > 0 ? "+" : "") + rel + "%").padStart(10) +
      r.paintMed.toFixed(2).padStart(12) + r.layoutMed.toFixed(2).padStart(11)
    );
  }
  console.log("\n（整屏重绘合计越低越省；真机上这个数乘上设备系数就是每帧绘制时间）\n");
  process.exit(0);
})();
