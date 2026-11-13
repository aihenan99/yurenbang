"use strict";
/* 回归：2026-11-13 用户要求「不自动阅读」—— 打开任何内容都不出声，只有点 🔊 才念。
 *
 * 为什么要有这条：
 *   自动朗读在 11-13 之前是「可选项」（#mfAuto 胶囊 + localStorage yrb_autospeak）。
 *   但老设备上存过 "1"，升级后照样自动出声，用户实机听到「还是在自动读」。
 *   现在整个能力下线（mediafull.js 的 AUTO_READ=false），本测试锁死三条出口：
 *     ① 首页滑停 / 换内容：不自动读（followNow 走 AUTO_READ 早退，胶囊不注入）
 *     ② 求助详情全屏（pfOpen）：不自动读（pfSpeak 早退）
 *     ③ 案例广场点开 / 双击全屏：不自动读（casedit 读 autoRead 标志）
 *   同时确认手动 🔊 仍然好使（别把朗读功能一起关死了）。
 *   还要确认残留存储被清掉（否则「改了还在自动读」会复发）。
 *
 * 跑法：先起 8796（源码站），再 node tests/diag/noautoread_test.js
 *      node tests/diag/noautoread_test.js http://127.0.0.1:8796/yurenbang-app.html
 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(p => require("fs").existsSync(p));

const SITE = process.argv[2] || "http://127.0.0.1:8796/yurenbang-app.html";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); }
}

/* fetch 打桩：/yrbtts 只记账并回一段静音 WAV（无头浏览器没声卡，真请求必失败会退本机） */
const STUB = () => {
  function makeWavSrc() {
    const sr = 8000, n = sr * 4;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: "audio/wav" });
  }
  window.__tts = [];
  window.__ttsTxt = [];
  const orig = window.fetch;
  window.fetch = function (u) {
    const url = String(u);
    if (url.indexOf("/yrbtts") > -1) {
      try {
        const t = decodeURIComponent((url.split("?")[1] || "").split("&").filter(x => /^t=/.test(x))[0].slice(2));
        window.__ttsTxt.push(t.slice(0, 30));
      } catch (e) { window.__ttsTxt.push("?"); }
      window.__tts.push(url.slice(0, 60));
      return Promise.resolve(new Response(makeWavSrc(), { status: 200, headers: { "content-type": "audio/wav" } }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
  /* 本机兜底也要记账：若自动朗读走到 speechSynthesis，照样算「自动出声」 */
  window.__spoken = [];
  try {
    const sp = window.speechSynthesis;
    if (sp) {
      const oSpeak = sp.speak.bind(sp);
      sp.speak = function (u) { try { window.__spoken.push(String(u && u.text || "").slice(0, 30)); } catch (e) {} return oSpeak(u); };
    }
  } catch (e) {}
};

const CASES = [
  { id: "c1", t: "自己的孩子自己爱", by: "测试家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
    content_html: "<h3>自己的孩子自己爱</h3><p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。</p><p>先把自己安顿好，才有余力接住孩子的情绪。</p>", media: [] },
];
const POSTS = [
  /* id 必须是数字：refine23 的 enhanceAllCards 用 `+card.dataset.id` 与 S.posts[i].id 严格相等，
     字符串 id 会查不到帖 → 卡片上永远不补「📄 查看完整求助」→ pfOpen 点不开详情 */
  { id: 9101, title: "孩子写作业拖到十一点怎么办", text: "每天作业写到很晚，我一催就吵起来，有没有更好的办法。",
    user: "测试家长", ava: "rabbit", time: Date.now(), likes: 0, favs: 0, helps: 0, comments: [] },
];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  /* A：模拟「老设备残留」—— 存储里明写 "1"，看新版会不会被它带跑 */
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','1');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +   /* 不靠 webdriver 守卫蒙混过关 */
    "(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));

  await p.goto(SITE + "?nar=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1400);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.evaluate((posts) => { try { S.posts = posts; renderFeed && renderFeed(); } catch (e) {} }, POSTS);
  await p.waitForTimeout(1500);

  const base = await p.evaluate(() => ({
    autoRead: !!(window.YRB_MEDIAFULL && YRB_MEDIAFULL.autoRead && YRB_MEDIAFULL.autoRead.enabled()),
    follow: !!(window.YRB_MEDIAFULL && YRB_MEDIAFULL.autoFollow && YRB_MEDIAFULL.autoFollow.state().on),
    pill: !!document.getElementById("mfAuto"),
    store: (() => { try { return localStorage.getItem("yrb_autospeak"); } catch (e) { return "?"; } })(),
    ver: (window.YRB_MEDIAFULL && YRB_MEDIAFULL.version) || "",
    tts: (window.__tts || []).length,
    spoken: (window.__spoken || []).length,
  }));
  ck("① 自动朗读总开关 = 关（autoRead=false）", base.autoRead === false, base);
  ck("② 跟读状态不生效（autoFollow.on=false）", base.follow === false);
  ck("③ 首页不再出现跟读胶囊 #mfAuto", base.pill === false);
  ck("④ 老设备残留的 yrb_autospeak=\"1\" 已被清掉", base.store === null, base.store);
  ck("⑤ 首屏渲染 + 滑停 3 秒，零朗读请求", base.tts === 0 && base.spoken === 0, { tts: base.tts, spoken: base.spoken });

  /* ---------- 求助详情全屏（点卡片正文 = pfOpen 路径）：不读 ---------- */
  const feedCards = await p.evaluate(() => document.querySelectorAll("#feed .card").length);
  ck("⑤b 桩帖已渲染进信息流（前提）", feedCards > 0, { cards: feedCards });
  const bodySel = "#feed .card[data-id='9101'] .p-text";
  /* 不能先 scrollIntoViewIfNeeded：滚动会触发信息流重建，元素被换掉，tap 报 not attached */
  const tapped = await p.tap(bodySel).then(() => true).catch(() => p.click(bodySel).then(() => true).catch(() => false));
  if (tapped) await p.waitForTimeout(2200);
  const detail = await p.evaluate(() => ({
    fs: !!document.querySelector(".mf-fs, #r23Detail.open.mf-fs"),
    open: !!document.querySelector("#r23Detail.open"),
    tts: (window.__tts || []).length,
    spoken: (window.__spoken || []).length,
  }));
  ck("⑥ 点卡片进了全屏详情（前提成立）", detail.fs || detail.open, detail);
  ck("⑦ 详情打开/全屏不自动朗读", detail.tts === 0 && detail.spoken === 0, { tts: detail.tts, spoken: detail.spoken });

  /* ---------- 手动 🔊 仍然好使 ---------- */
  const ttsBtn = await p.$("#r23Detail .mf-tts, .r23-dhead .mf-tts");
  if (ttsBtn) {
    await ttsBtn.tap({ force: true }).catch(() => ttsBtn.click().catch(() => {}));
    await p.waitForTimeout(1200);
  }
  const manual = await p.evaluate(() => ({ tts: (window.__tts || []).length, txt: (window.__ttsTxt || [])[0] || "" }));
  ck("⑧ 手动点 🔊 才开始朗读（功能没被一起关死）", manual.tts > 0, manual);
  ck("⑨ 读的是这篇求助正文", /作业|孩子/.test(manual.txt), manual.txt);

  /* 关掉手动朗读，切案例广场 */
  await p.evaluate(() => { try { YRB_MEDIAFULL.stopSpeak(); } catch (e) {} });
  await p.waitForTimeout(300);
  await p.evaluate((list) => {
    try {
      document.querySelectorAll("#r23Detail.open").forEach(n => n.classList.remove("open"));
      document.querySelectorAll(".mf-fs").forEach(n => n.classList.remove("mf-fs"));
      S.cases = list; switchTab("cases"); renderCases && renderCases();
      window.__tts.length = 0; window.__spoken.length = 0; window.__ttsTxt.length = 0;
    } catch (e) {}
  }, CASES);
  await p.waitForTimeout(900);

  /* ---------- 案例：单击打开不读 ---------- */
  const caseTitle = await p.$("#caseGrid .case-card .c-title") || await p.$("#caseGrid .case-card");
  ck("⑩ 案例广场渲染出测试卡", !!caseTitle);
  /* 前一步的详情/全屏如果没退干净，浮层会盖住案例卡（后续断言会误判成「点了没反应」） */
  const leftover = await p.evaluate(() => ({
    open: [...document.querySelectorAll("#r23Detail.open, #viewer.open, #vpFull.open, .mf-fs, .sheet.open")].map(n => n.id || n.className).slice(0, 6),
    scrollTop: (document.querySelector("#feed") || {}).scrollTop,
  }));
  if (leftover.open.length) console.log("  · 残留浮层：", JSON.stringify(leftover));
  if (caseTitle) {
    await caseTitle.scrollIntoViewIfNeeded().catch(() => {});
    await caseTitle.tap({ force: true }).catch(async () => { await caseTitle.click({ force: true }).catch(() => {}); });
    await p.waitForTimeout(2000);
  }
  const caseOpen = await p.evaluate(() => ({
    open: !!document.querySelector("#viewer.open"),
    tts: (window.__tts || []).length,
    spoken: (window.__spoken || []).length,
    on: !!document.querySelector(".vw-head .mf-tts.on"),
  }));
  ck("⑪ 单击案例只打开查看器，不朗读", caseOpen.open && caseOpen.tts === 0 && caseOpen.spoken === 0 && caseOpen.on === false, caseOpen);

  /* ---------- 案例：双击全屏只放大，不读 ---------- */
  await p.evaluate(() => { try { document.getElementById("vwX").click(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.__tts.length = 0; window.__spoken.length = 0; });
  const t2 = await p.$("#caseGrid .case-card .c-title");
  if (t2) { await t2.dblclick({ delay: 40 }).catch(() => {}); await p.waitForTimeout(2200); }
  const caseFs = await p.evaluate(() => ({
    fs: !!document.querySelector("#viewer.open.vw-fs"),
    tts: (window.__tts || []).length,
    spoken: (window.__spoken || []).length,
  }));
  ck("⑫ 双击案例进全屏（放大手势仍有效）", caseFs.fs === true, caseFs);
  ck("⑬ 双击全屏不顺带朗读", caseFs.tts === 0 && caseFs.spoken === 0, { tts: caseFs.tts, spoken: caseFs.spoken });

  /* ---------- 案例：手动点头部 🔊 才读 ---------- */
  const vBtn = await p.$(".vw-head .mf-tts");
  if (vBtn) { await vBtn.tap({ force: true }).catch(() => vBtn.click().catch(() => {})); await p.waitForTimeout(1200); }
  const vManual = await p.evaluate(() => ({ tts: (window.__tts || []).length, txt: (window.__ttsTxt || [])[0] || "" }));
  ck("⑭ 案例里手动 🔊 也能读", vManual.tts > 0, vManual);
  ck("⑮ 读的是案例正文", /孩子|家长/.test(vManual.txt), vManual.txt);

  ck("⑯ 无页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log("==== " + pass + " 通过 / " + fail + " 失败 ====");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
