/* 本地验收：案例广场「双击文字 → 全屏 + 自动朗读」（casedit v3，2026-11-03）
   覆盖：① 双击图文案例卡片 → 查看器进入全屏(.vw-fs) 并发出朗读请求
        ② 查看器内双击正文 → 退出全屏（查看器不关）；再双击回到全屏且不重复开读
        ③ 关闭查看器 → 全屏类收干净，不留到下次
        ④ 视频/图片案例双击 → 不进全屏、不朗读（无正文，放大没意义）

   断言手段：
   · init 阶段包一层 window.fetch，/yrbtts 记录朗读文本并返回可播放静音 WAV
     （无头浏览器没有音频设备，真请求必失败，只会退本机朗读，断言不稳）
   · 双击后的状态用轮询等，而不是固定 sleep：Playwright 的 dblclick 是协议级两次
     mousedown，实测「第一下 → 查看器打开」可能间隔 500ms+，固定等待会误判 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = process.env.YRB_SITE || "http://127.0.0.1:8794/";
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
}
const STUB = () => {
  window.__tts = [];
  const orig = window.fetch;
  window.fetch = function (u) {
    const url = String(u);
    if (url.indexOf("/yrbtts") > -1) {
      try { window.__tts.push(decodeURIComponent(url.split("t=")[1] || "").slice(0, 40)); } catch (e) { window.__tts.push("?"); }
      return Promise.resolve(new Response(makeWavSrc(), { status: 200 }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
  function makeWavSrc() {
    const sr = 8000, n = sr * 6;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: "audio/wav" });
  }
};
const CASES = [
  { id: "c1", t: "自己的孩子自己爱", by: "测试家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
    content_html: "<h3>自己的孩子自己爱</h3><p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。</p><p>先把自己安顿好，才有余力接住孩子的情绪。</p>", media: [] },
  { id: "c2", t: "一分钟跳绳示范", by: "测试家长", ava: "rabbit", type: "video", dur: "0:20",
    helps: 1, likes: 2, favs: 0, media: [{ kind: "video", url: "" }] }
];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +
    "(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  const fsOn = () => p.evaluate(() => document.getElementById("viewer").classList.contains("vw-fs"));
  const isOpen = () => p.evaluate(() => document.getElementById("viewer").classList.contains("open"));
  const tts = () => p.evaluate(() => (window.__tts || []).length);
  async function waitFs(want, ms) {
    try { await p.waitForFunction(w => document.getElementById("viewer").classList.contains("vw-fs") === w, want, { timeout: ms || 3000 }); return true; }
    catch (e) { return false; }
  }

  await p.goto(SITE + "?fs=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate((list) => {
    S.posts = [];
    S.cases = list;
    try { switchTab("cases"); } catch (e) {}
    try { renderCases(); } catch (e) {}
    window.__tts.length = 0;
  }, CASES);
  await p.waitForTimeout(700);
  ck("① 案例广场渲染出两张卡", (await p.$$("#caseGrid .case-card")).length === 2);

  /* ---------- 双击卡片文字：全屏 + 朗读 ---------- */
  const t0 = Date.now();
  await p.locator("#caseGrid .case-card .c-title").first().dblclick({ delay: 40 });
  const gotFs = await waitFs(true, 3000);
  const fsMs = Date.now() - t0;
  ck("② 双击后查看器已打开", await isOpen());
  ck("③ 自动进入全屏（.vw-fs）", gotFs, fsMs + "ms");
  const n1 = await tts();
  ck("④ 自动发出朗读请求", n1 >= 1, "请求 " + n1 + " 次");
  const txt1 = await p.evaluate(() => (window.__tts || [])[0] || "");
  ck("⑤ 朗读内容含标题与正文", /自己的孩子自己爱/.test(txt1) && /全部精力/.test(txt1), txt1.slice(0, 26));
  ck("⑥ 头部朗读按钮同步为「停止」", await p.evaluate(() => !!document.querySelector(".vw-head .mf-tts.on")));
  ck("⑦ 全屏提示气泡出现", await p.evaluate(() => !!document.getElementById("vwFsTip")));

  /* ---------- 查看器内双击正文：退出全屏，但不关案例 ---------- */
  await p.locator("#vwBody .yrb-doc-body p").first().dblclick({ delay: 40 });
  const outFs = await waitFs(false, 3000);
  ck("⑧ 双击正文退出全屏", outFs);
  ck("⑨ 退出全屏后查看器仍开着（不会被当成关闭）", await isOpen());

  /* ---------- 再双击：回到全屏，并从头重读（2026-11-03 新口径） ---------- */
  const before = await tts();
  await p.locator("#vwBody .yrb-doc-body p").first().dblclick({ delay: 40 });
  const back = await waitFs(true, 3000);
  const after = await tts();
  ck("⑩ 再双击回到全屏", back);
  ck("⑪ 重进全屏 = 从头重读（新请求）", after > before, "before " + before + " after " + after);

  /* ---------- 关闭查看器：全屏类必须收干净 ---------- */
  await p.click("#vwX");
  await p.waitForTimeout(500);
  const s4 = await p.evaluate(() => ({
    fs: document.getElementById("viewer").classList.contains("vw-fs"),
    open: document.getElementById("viewer").classList.contains("open")
  }));
  ck("⑫ 关闭后无残留全屏类", !s4.fs && !s4.open, JSON.stringify(s4));

  /* ---------- 视频案例：双击不进全屏、不朗读 ---------- */
  const nv = await tts();
  await p.locator("#caseGrid .case-card .c-title").nth(1).dblclick({ delay: 40 });
  await p.waitForTimeout(1500);
  const s5 = await p.evaluate(() => ({
    open: document.getElementById("viewer").classList.contains("open"),
    fs: document.getElementById("viewer").classList.contains("vw-fs")
  }));
  ck("⑬ 视频案例双击照常打开但不进全屏", s5.open && !s5.fs, JSON.stringify(s5));
  ck("⑭ 视频案例不触发朗读", (await tts()) === nv, "before " + nv + " after " + (await tts()));

  ck("⑮ 无页面异常", errs.length === 0, errs.join(" | "));
  await p.close();
  await ctx.close();

  /* ---------- 第二个上下文：跟读开关开 → 单击小窗口也要及时自动朗读 ---------- */
  const ctx2 = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx2.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','1');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +
    "(" + STUB.toString() + ")();"
  );
  const q = await ctx2.newPage();
  const errs2 = [];
  q.on("pageerror", e => errs2.push(String(e.message).slice(0, 160)));
  await q.goto(SITE + "?sw=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await q.waitForTimeout(1200);
  await q.evaluate(() => { try { enterApp(); } catch (e) {} });
  await q.waitForTimeout(600);
  await q.evaluate((list) => {
    S.posts = [];
    S.cases = list;
    try { switchTab("cases"); } catch (e) {}
    try { renderCases(); } catch (e) {}
    window.__tts.length = 0;
  }, CASES);
  await q.waitForTimeout(500);

  /* 单击（不是双击）打开小窗口：~1.3s 内应发出朗读请求 */
  const t1 = Date.now();
  await q.locator("#caseGrid .case-card .c-title").first().click();
  let spoke = false;
  try {
    await q.waitForFunction(() => (window.__tts || []).length >= 1, null, { timeout: 2500 });
    spoke = true;
  } catch (e) {}
  ck("⑯ 小窗单击打开即自动朗读", spoke, (Date.now() - t1) + "ms");
  ck("⑰ 小窗不进全屏", await q.evaluate(() =>
    document.getElementById("viewer").classList.contains("open") &&
    !document.getElementById("viewer").classList.contains("vw-fs")));

  /* 小窗朗读中双击正文进全屏。先等 >800ms（同篇 800ms 内视为「已在从头读」，不重发），
     超过后再双击 = 明确要求从头重读 → 必须发出新请求 */
  await q.waitForTimeout(1000);
  const swBefore = await q.evaluate(() => (window.__tts || []).length);
  await q.locator("#vwBody .yrb-doc-body p").first().dblclick({ delay: 40 });
  const gotFs2 = await q.waitForFunction(() =>
    document.getElementById("viewer").classList.contains("vw-fs"), null, { timeout: 3000 }).then(() => true).catch(() => false);
  await q.waitForTimeout(700);
  const swAfter = await q.evaluate(() => (window.__tts || []).length);
  ck("⑱ 朗读中小窗双击进全屏", gotFs2);
  ck("⑲ 全屏从头重读（新请求）", swAfter > swBefore, "before " + swBefore + " after " + swAfter);
  ck("⑳ 无页面异常（小窗上下文）", errs2.length === 0, errs2.join(" | "));
  await q.close();
  await ctx2.close();

  await b.close();
  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
