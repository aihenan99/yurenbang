/* 用 Chrome Tracing 抓滚动时主线程到底在干什么：
   统计 Layout / Recalculate Style / Paint / Layerize / JS 各自的耗时与次数，
   并列出最耗时的 JS 函数（按 self time 排序）。
   用法：node temp/perf_trace.js [url] */
const { chromium } = require("./pw/node_modules/playwright-core");
const SITE = process.argv[2] || "http://127.0.0.1:8794/";

function feedData(n) {
  const t = ["孩子不爱写作业怎么办", "两岁孩子挑食怎么破", "幼儿园分离焦虑", "二宝抢玩具打架",
    "要不要报早教班", "孩子夜里总是醒", "打人该怎么管", "认字早了有坏处吗"];
  const out = [];
  for (let i = 0; i < n; i++) out.push({
    id: 95000 + i, title: t[i % t.length] + "（" + (i + 1) + "）",
    text: "试了好多办法都没用，请有经验的家长支支招。孩子今年刚上幼儿园，每天回家都闷闷不乐，问他也不说，我们做家长的实在没辙了。",
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
  await p.goto(SITE + "?tr=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(d => { try { S.posts = d; renderFeed(); } catch (e) {} }, feedData(16));
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById("page-home").scrollTo(0, 0));

  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_RATE || 4) });

  const events = [];
  cdp.on("Tracing.dataCollected", d => { if (d.value) events.push(...d.value); });
  const done = new Promise(r => cdp.once("Tracing.tracingComplete", r));

  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8.execute",
    options: "sampling-frequency=10000"
  });

  /* 触摸滚动 3.2 秒 */
  let y = 400, dir = 1;
  const t0 = Date.now();
  while (Date.now() - t0 < 3200) {
    if (y > 800 || y < 120) dir = -dir;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y }] });
    for (let k = 0; k < 6; k++) {
      y += dir * 22;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 206, y }] });
      await p.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(30);
    if (Math.random() < 0.1) dir = -dir;
  }

  await cdp.send("Tracing.end");
  await done;
  await b.close();

  /* ---------- 汇总 ---------- */
  const BUDGET = new Set(["Layout", "UpdateLayoutTree", "RecalculateStyles", "Paint", "Layerize",
    "UpdateLayer", "UpdateLayerTree", "ParseHTML", "FunctionCall", "EvaluateScript",
    "TimerFire", "EventDispatch", "HitTest", "PrePaint", "Commit", "CompositeLayers",
    "RasterTask", "Decode Image", "ImageDecodeTask", "GPUTask", "RunMicrotasks"]);
  const agg = {};
  let total = 0;
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    if (!BUDGET.has(e.name)) continue;
    const a = agg[e.name] || (agg[e.name] = { n: 0, sum: 0 });
    a.n++; a.sum += e.dur;
    total += e.dur;
  }
  const rows = Object.entries(agg).sort((x, y) => y[1].sum - x[1].sum);
  console.log("\n=== 滚动 3.2s 内主线程耗时分布（CPU 4x 降速） ===");
  console.log("事件".padEnd(20) + "次数".padStart(7) + "总耗时ms".padStart(11) + "单次均ms".padStart(11) + "占比".padStart(9));
  for (const [k, v] of rows.slice(0, 14)) {
    console.log(k.padEnd(20) + String(v.n).padStart(7) + (v.sum / 1000).toFixed(0).padStart(11) +
      (v.sum / 1000 / v.n).toFixed(2).padStart(11) + (v.sum / total * 100).toFixed(1).padStart(8) + "%");
  }

  /* EventDispatch 按事件类型分组 */
  const ev = {};
  for (const e of events) {
    if (e.name !== "EventDispatch" || !e.dur) continue;
    const t = (e.args && e.args.data && e.args.data.type) || "?";
    const a = ev[t] || (ev[t] = { n: 0, sum: 0 });
    a.n++; a.sum += e.dur;
  }
  console.log("\n=== 哪些事件在吃时间 ===");
  for (const [k, v] of Object.entries(ev).sort((x, y) => y[1].sum - x[1].sum).slice(0, 12)) {
    console.log(k.padEnd(24) + String(v.n).padStart(6) + " 次 " +
      (v.sum / 1000).toFixed(0).padStart(7) + " ms  均 " + (v.sum / 1000 / v.n).toFixed(2) + " ms");
  }

  /* JS 自耗时：按函数名聚合 FunctionCall 的 self time */
  const fn = {};
  const dur = new Map();
  for (const e of events) if (e.ph === "X" && e.dur) dur.set(e.name + "|" + e.ts + "|" + (e.tid || 0), e);
  for (const e of events) {
    if (e.name !== "FunctionCall" || !e.dur) continue;
    const nm = (e.args && (e.args.data && (e.args.data.functionName || e.args.data.url))) || "";
    const dd = (e.args && e.args.data) || {};
    const key = dd.functionName
      ? dd.functionName + "  @" + String(dd.url || "").replace(/^.*\//, "") + ":" + (dd.lineNumber || 0)
      : null;
    if (!key) continue;
    const a = fn[key] || (fn[key] = { n: 0, sum: 0 });
    a.n++; a.sum += e.dur;
  }
  const top = Object.entries(fn).sort((x, y) => y[1].sum - x[1].sum).slice(0, 12);
  if (top.length) {
    console.log("\n=== JS 函数总耗时 Top12（含子调用） ===");
    for (const [k, v] of top) {
      console.log(k.slice(0, 34).padEnd(36) + String(v.n).padStart(6) + " 次 " + (v.sum / 1000).toFixed(0).padStart(6) + " ms");
    }
  }

  /* 长任务（>50ms） */
  const longs = events.filter(e => e.name === "Task" && e.dur > 50000)
    .map(e => (e.dur / 1000).toFixed(0)).slice(0, 10);
  console.log("\n>50ms 的长任务:", longs.length ? longs.join(", ") + " ms" : "无");
})();
