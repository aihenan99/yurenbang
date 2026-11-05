/* 滚动流畅度对照实验（2026-11-05）
   用户反馈：「滑动时加载还是很慢，滑动的越快，卡的越狠，没有抖音那样流畅」。

   为什么不能只靠 CPU 降速 + 触摸注入去测：上一轮已经吃过教训——CDP 注入触摸本身
   开销就很大（实测纯 rAF 推 scrollTop 只掉 1.4%，触摸注入能测出 16%，多出来的全是
   工具开销）。所以这里换一种问法：**每帧到底在等什么**。

   做法：同一个页面，用 rAF 逐帧推 scrollTop（不注入任何输入事件），分别测
     ① 滚动速度 8px/帧（≈480px/s，慢慢滑）
     ② 滚动速度 40px/帧（≈2400px/s，快速甩）
   再看「视觉变体」对帧时间的影响（阴影 / 圆角+边框 / 卡片整体 / 空信息流），
   用差值定位「贵在哪一层」，而不是靠猜。

   判读：
     - 慢速与快速差距大 → 绘制/光栅随位移增长（滚动越快，需要画的面积越多）
     - 去掉阴影明显变快 → 阴影是主因（每次重绘都要重新生成模糊）
     - 去掉 #phone 圆角/边框明显变快 → 裁剪层导致无法走快速滚动路径
     - 空信息流仍然慢 → 跟卡片无关，锅在背景/固定层/常驻动画

   用法：
     node tests/diag/perf_speed.js                       # 默认境内站
     node tests/diag/perf_speed.js https://xn--gmqq09al6z.cn/
     CPU=4 node tests/diag/perf_speed.js                 # 叠 4 倍降速，模拟低端机
*/
const BASE = (process.argv[2] || "http://118.89.185.37/").replace(/\/?$/, "/");
const CPU = Number(process.env.CPU || 0);
/* SOFT=1：关掉 GPU，改用软件光栅（Skia CPU）。桌面上 GPU 快速路径会把绘制代价
   藏得干干净净（实测 6 倍降速也测不出差别），软件光栅才接近低端机/微信内核的处境。 */
const SOFT = process.env.SOFT === "1";
/* OLD=1：禁用线程化滚动 + 关 GPU，模拟微信 X5 / 老 Android WebView 的行为——
   这类内核没有独立滚动线程，每帧的布局与绘制都压在主线程上，帧时间才会真实反映代价。 */
const OLD = process.env.OLD === "1";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

/* 视觉变体：只影响绘制，不改结构，不动脚本 */
const VARIANTS = [
  ["基线", ""],
  ["去阴影", "*{box-shadow:none!important}"],
  ["去圆角/边框", "#phone{border:0!important;border-radius:0!important} .card{border-radius:0!important}"],
  ["去阴影+去圆角", "*{box-shadow:none!important} #phone{border:0!important;border-radius:0!important} .card{border-radius:0!important}"],
  ["卡片不透明+去阴影", "*{box-shadow:none!important} .card{background:#fff!important;border-radius:0!important}"],
  ["空信息流", "*{box-shadow:none!important} #feed{display:none!important}"],
  ["去无限动画", "*{animation:none!important;transition:none!important}"],
  ["头像去 SVG 形状", ".p-ava svg{display:none!important}"],
];

function stats(gaps) {
  const g = gaps.slice(1);                       /* 丢掉第一帧（包含启动开销） */
  if (!g.length) return { fps: 0, p95: 0, drop: 0, n: 0 };
  const s = g.slice().sort((a, b) => a - b);
  const sum = g.reduce((a, b) => a + b, 0);
  return {
    fps: Math.round(1000 / (sum / g.length)),
    avg: sum / g.length,
    p95: s[Math.floor(s.length * 0.95)] || 0,
    drop: Math.round((g.filter((x) => x > 25).length / g.length) * 100),
    n: g.length,
  };
}

async function measure(b, px) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});"
  );
  const p = await ctx.newPage();
  await p.goto(BASE + "?perf=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(1800);
  if (CPU) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  }

  const out = [];
  for (const [label, css] of VARIANTS) {
    if (css) await p.addStyleTag({ content: css });
    const gaps = await p.evaluate(
      ({ px, ms }) =>
        new Promise((res) => {
          const ph = document.getElementById("page-home");
          if (!ph) return res([16]);
          ph.scrollTop = 0;
          const gaps = [];
          let last = performance.now(), t0 = last, dir = 1;
          function step(t) {
            gaps.push(t - last);
            last = t;
            ph.scrollTop += dir * px;
            /* 到头就折返，避免停在底部空转 */
            if (ph.scrollTop + ph.clientHeight >= ph.scrollHeight - 2) dir = -1;
            else if (ph.scrollTop <= 0) dir = 1;
            if (t - t0 < ms) requestAnimationFrame(step);
            else res(gaps);
          }
          requestAnimationFrame(step);
        }),
      { px, ms: 2600 }
    );
    out.push({ label, ...stats(gaps) });
    if (css) await p.evaluate(() => {
      const st = [...document.querySelectorAll("style")].filter((s) => /box-shadow|border-radius/.test(s.textContent || ""));
      st.slice(-1).forEach((s) => s.remove());
    });
  }
  await ctx.close();
  return out;
}

(async () => {
  const args = [];
  if (SOFT || OLD) args.push("--disable-gpu", "--disable-gpu-compositing", "--disable-accelerated-2d-canvas");
  if (OLD) args.push("--disable-threaded-scrolling", "--disable-threaded-animation", "--disable-threaded-compositing");
  const b = await chromium.launch({ executablePath: CHROME, args });
  const slow = await measure(b, 8);
  const fast = await measure(b, 40);
  await b.close();

  const line = (r) =>
    r.label.padEnd(18) + String(r.fps).padStart(5) + "fps" +
    (r.avg || 0).toFixed(1).padStart(8) + "ms均" +
    (r.p95 || 0).toFixed(0).padStart(6) + "ms p95" +
    String(r.drop).padStart(5) + "%掉帧";
  console.log("\n站点 " + BASE + (CPU ? "   CPU 降速 " + CPU + "x" : "   （不降速）") + "\n");
  console.log("—— 慢速 8px/帧（≈480px/s）——");
  slow.forEach((r) => console.log("  " + line(r)));
  console.log("\n—— 快速 40px/帧（≈2400px/s）——");
  fast.forEach((r) => console.log("  " + line(r)));
  console.log("\n判读：基线 slow→fast 掉帧涨幅越大，说明每帧成本随位移增长（绘制瓶颈）；" +
    "某个变体一大截变快，那一层就是主因。\n");
  process.exit(0);
})();
