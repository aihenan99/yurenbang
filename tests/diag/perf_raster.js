/* 滚动时「绘制/光栅」开销拆解（2026-11-05）
   背景：同一份代码在桌面 Chrome 上怎么测都是 60fps（GPU 快速路径 + 光栅在别的线程），
   但真机（尤其微信内核、低端安卓）滑动就是跟不上手。上一轮的教训是：**别再用帧率
   判断桌面端的优化有没有用**，要看每帧到底产生了多少绘制工作量。

   本脚本用 Chrome Tracing 抓滚动期间的主线程与光栅事件，输出：
     Paint / RasterTask / Layerize / CompositeLayers / Layout / UpdateLayoutTree / JS
   的「次数」与「总耗时」——次数说明每帧要画多少块，耗时说明画一块多贵。
   然后按变体（去掉某类 CSS）对比，谁的次数/耗时掉得最多，谁就是主因。

   关键判读：
     - Layerize 次数远大于 1 → 图层爆炸（每个图层都要内存 + 合成）
     - RasterTask 次数 ≈ 每帧新增的瓦片数，跟滚动速度成正比 → 越快越卡的机制坐实
     - Paint 耗时占大头 → 卡片本身的绘制太贵（阴影/圆角/渐变）

   用法：
     node tests/diag/perf_raster.js [url]
     VAR=1 node tests/diag/perf_raster.js      # 只跑「去掉隐藏浮层的 backdrop-filter」变体
*/
const BASE = (process.argv[2] || "http://118.89.185.37/").replace(/\/?$/, "/");
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

/* 隐藏态浮层：opacity:0 但仍带 backdrop-filter。规范上会创建 backdrop root，
   可能把整个滚动容器拖进「必须离屏合成」的路径。这是重点怀疑对象。 */
const HIDDEN_OVERLAYS =
  "#viewer,#modal,#upMask,#pfMask,#fdMask,#fdInMask,#fdWlMask,#licView,#adMgMask," +
  "#libMask,#cpMask,.mask{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}";

const VARIANTS = [
  ["基线", ""],
  ["隐藏浮层去 backdrop", HIDDEN_OVERLAYS],
  ["卡片去阴影", ".card{box-shadow:none!important}"],
  ["全部去阴影", "*{box-shadow:none!important}"],
  ["卡片内容跳过渲染", ".card{content-visibility:auto!important;contain-intrinsic-size:auto 300px!important}"],
];

const KEEP = new Set([
  "Paint", "RasterTask", "Layerize", "CompositeLayers", "Layout", "UpdateLayoutTree",
  "UpdateLayer", "UpdateLayerTree", "PrePaint", "Commit", "FunctionCall", "EventDispatch",
  "Decode Image", "ImageDecodeTask",
]);

async function profile(b, css, { px = 40, ms = 2200 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});"
  );
  const p = await ctx.newPage();
  await p.goto(BASE + "?raster=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(2000);
  if (css) await p.addStyleTag({ content: css });

  const cdp = await ctx.newCDPSession(p);
  const evts = [];
  cdp.on("Tracing.dataCollected", (d) => { if (d.value) evts.push(...d.value); });
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing",
    transferMode: "ReportEvents",
  });

  const frames = await p.evaluate(
    ({ px, ms }) =>
      new Promise((res) => {
        const ph = document.getElementById("page-home");
        if (!ph) return res(0);
        ph.scrollTop = 0;
        let n = 0, dir = 1, t0 = performance.now();
        function step(t) {
          n++;
          ph.scrollTop += dir * px;
          if (ph.scrollTop + ph.clientHeight >= ph.scrollHeight - 2) dir = -1;
          else if (ph.scrollTop <= 0) dir = 1;
          if (t - t0 < ms) requestAnimationFrame(step); else res(n);
        }
        requestAnimationFrame(step);
      }),
    { px, ms }
  );

  await cdp.send("Tracing.end");
  await done;
  await ctx.close();

  const agg = {};
  for (const e of evts) {
    if (e.ph !== "X" || !e.dur || !KEEP.has(e.name)) continue;
    const a = (agg[e.name] = agg[e.name] || { n: 0, sum: 0 });
    a.n++;
    a.sum += e.dur;
  }
  return { frames, agg };
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const rows = [];
  for (const [label, css] of VARIANTS) {
    const r = await profile(b, css);
    rows.push({ label, ...r });
  }
  await b.close();

  const pick = (a, k) => (a[k] ? a[k] : { n: 0, sum: 0 });
  console.log("\n站点 " + BASE + "  · 每变体滚动 2.2s（40px/帧）\n");
  console.log("变体".padEnd(18) + "帧数".padStart(5) +
    "Paint次/ms".padStart(14) + "Raster次/ms".padStart(15) +
    "Layerize次".padStart(11) + "Layout次/ms".padStart(13));
  for (const r of rows) {
    const pa = pick(r.agg, "Paint"), ra = pick(r.agg, "RasterTask"),
      lz = pick(r.agg, "Layerize"), ly = pick(r.agg, "Layout");
    console.log(
      r.label.padEnd(18) + String(r.frames).padStart(5) +
      String(pa.n).padStart(7) + "/" + (pa.sum / 1000).toFixed(0).padStart(5) +
      String(ra.n).padStart(9) + "/" + (ra.sum / 1000).toFixed(0).padStart(4) +
      String(lz.n).padStart(11) +
      String(ly.n).padStart(7) + "/" + (ly.sum / 1000).toFixed(0)
    );
  }
  console.log("\n（次=该事件发生次数，ms=总耗时；同一帧数下，次数/耗时更低者更省）\n");
  process.exit(0);
})();
