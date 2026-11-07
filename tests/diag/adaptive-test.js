/* adaptive.js 验收（2026-11-07）
   覆盖：层就位 / 点空率高→触控宽容 / 短滑多→阈值降低 / 连点多→防手抖 /
        长辈设置里可见可关可还原 / 不发网络请求。
   运行前：
     python -m http.server 8794 --directory deploy-cn
     node tests/diag/adaptive-test.js
   说明：不做「模拟真人点歪」的假动作，而是直接把当天的计数写进 localStorage
        再刷新 —— 走的是真实启动路径（boot → evaluate → apply），比造点击可靠。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const fs = require("fs");
const path = require("path");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8794/index.html";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  console.log((ok ? "  [PASS] " : "  [FAIL] ") + name + (extra && !ok ? "  → " + extra : ""));
  ok ? pass++ : fail++;
}

/* 写入「今天的计数」后刷新：boot 里 3 秒后会跑一次 evaluate */
async function seed(p, day) {
  await p.evaluate((d) => {
    const t = new Date();
    const k = t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
    localStorage.setItem("yrb_adapt_v1", JSON.stringify({ v: 1, d: { [k]: d }, tune: {}, last: {} }));
  }, day);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3800);   /* 3s 启动评估 + 余量 */
}
const zero = { tap: 0, miss: 0, dbl: 0, swOk: 0, swShort: 0, dev: 0, pick: 0, speak: 0 };

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  PAGEERROR:", String(e.message).slice(0, 160)));

  await p.goto(BASE + "?a=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2600);

  console.log("=== A. 层就位与默认档位 ===");
  const a = await p.evaluate(() => ({
    ready: !!(window.YRB_ADAPT && window.YRB_ADAPT.ready),
    th: window.YRB_ADAPT ? window.YRB_ADAPT.swipeThreshold() : -1,
    adapt: document.documentElement.getAttribute("data-adapt"),
    probe: (window.YRB_HEALTH && window.YRB_HEALTH.layers) ? "有" : "无"
  }));
  ck("自适应层已就位", a.ready);
  ck("默认滑动阈值 70px（不擅自调灵敏）", a.th === 70, String(a.th));
  ck("默认不带任何适配标记", !a.adapt, String(a.adapt));

  console.log("=== B. 点空率高 → 触控宽容 ===");
  await seed(p, Object.assign({}, zero, { tap: 5, miss: 15 }));   /* 20 次里 15 次点空 */
  const b1 = await p.evaluate(() => ({
    adapt: document.documentElement.getAttribute("data-adapt") || "",
    touch: window.YRB_ADAPT.on("touch"),
    th: window.YRB_ADAPT.swipeThreshold(),
    text: window.YRB_ADAPT.snapshot().text
  }));
  ck("开启触控宽容档", b1.touch && /touch/.test(b1.adapt), b1.adapt);
  ck("触控档不连带改滑动阈值（一次只动一项）", b1.th === 70, String(b1.th));
  ck("给出了可读的调整说明", /按钮/.test(b1.text), b1.text);

  console.log("=== C. 短滑多 → 阈值降到 52 ===");
  await seed(p, Object.assign({}, zero, { tap: 20, swOk: 2, swShort: 8 }));  /* 10 次横滑里 8 次不够长 */
  const c1 = await p.evaluate(() => ({
    th: window.YRB_ADAPT.swipeThreshold(),
    touch: window.YRB_ADAPT.on("touch"),
    swipe: window.YRB_ADAPT.on("swipe")
  }));
  ck("滑动阈值降到 52px", c1.th === 52, String(c1.th));
  ck("滑动档不连带开触控档", c1.swipe && !c1.touch);

  console.log("=== C2. 常用语音 → 放大麦克风入口（不自动开麦） ===");
  await seed(p, Object.assign({}, zero, { tap: 20, voice: 7 }));
  const c2 = await p.evaluate(() => ({
    voice: window.YRB_ADAPT.on("voice"),
    adapt: document.documentElement.getAttribute("data-adapt") || "",
    text: window.YRB_ADAPT.snapshot().text
  }));
  ck("开启语音入口放大档", c2.voice && /voice/.test(c2.adapt), c2.adapt);
  ck("说明里点明是语音入口", /语音/.test(c2.text), c2.text);

  console.log("=== D. 连点多 → 防手抖 ===");  await seed(p, Object.assign({}, zero, { tap: 20, dbl: 6, swOk: 10 }));
  const d1 = await p.evaluate(() => {
    const btn = document.createElement("button");
    btn.id = "tdeb";
    btn.setAttribute("data-deb", "1");
    btn.textContent = "deb";
    btn.style.cssText = "position:fixed;left:20px;top:140px;width:120px;height:60px;z-index:999999";
    document.body.appendChild(btn);
    window.__clicks = 0;
    btn.addEventListener("click", () => { window.__clicks++; });
    btn.click(); btn.click();          /* 同一帧连点两次 */
    return { n: window.__clicks, deb: window.YRB_ADAPT.on("debounce") };
  });
  ck("开启防手抖档", d1.deb);
  ck("同一按钮连点只算一次", d1.n === 1, "实际 " + d1.n);

  console.log("=== E. 长辈设置里可见、可关 ===");
  const e1 = await p.evaluate(() => {
    openElderModal();
    const sw = document.getElementById("adSw");
    const note = document.querySelector(".a11y-ad-note");
    return {
      hasSwitch: !!sw,
      on: !!(sw && sw.classList.contains("on")),
      note: note ? note.textContent : "",
      body: (document.getElementById("mdCard") || {}).textContent || ""
    };
  });
  ck("长辈设置里有「自动适应」开关", e1.hasSwitch);
  ck("开关默认是开着的（系统在替你调）", e1.on);
  ck("说明了数据只在本机、不上传", /本机|不上传/.test(e1.note), e1.note.slice(0, 40));
  ck("提供了「恢复默认」入口", /恢复默认/.test(e1.body));

  const e2 = await p.evaluate(() => {
    document.getElementById("adSw").click();
    return {
      off: window.YRB_ADAPT.isOff(),
      adapt: document.documentElement.getAttribute("data-adapt"),
      th: window.YRB_ADAPT.swipeThreshold()
    };
  });
  ck("关掉后立即生效（移除适配标记）", e2.off && !e2.adapt, String(e2.adapt));
  ck("关掉后滑动阈值回到 70", e2.th === 70, String(e2.th));

  console.log("=== F. 恢复默认 ===");
  const f1 = await p.evaluate(() => {
    window.YRB_ADAPT.enable();
    window.YRB_ADAPT.reset();
    return {
      th: window.YRB_ADAPT.swipeThreshold(),
      adapt: document.documentElement.getAttribute("data-adapt"),
      snap: window.YRB_ADAPT.snapshot()
    };
  });
  ck("还原后阈值回 70", f1.th === 70, String(f1.th));
  ck("还原后无适配标记", !f1.adapt, String(f1.adapt));
  ck("还原后计数清零", f1.snap.today.tap === 0, JSON.stringify(f1.snap.today));

  console.log("=== G. 隐私：不发请求、不存内容 ===");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "yurenbang-app", "assets", "adaptive.js"), "utf8");
  ck("没有任何网络调用", !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|\.src\s*=/.test(src));
  ck("不读页面文字（只记计数）", !/textContent|innerText|innerHTML/.test(src));
  ck("不把坐标写进存储", !/clientX\s*[:=]\s*(in|to)|d\[[^\]]*\]\s*=\s*\{\s*x/.test(src));

  console.log("\n" + (fail ? "❌" : "✅") + " 通过 " + pass + " / " + (pass + fail));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
