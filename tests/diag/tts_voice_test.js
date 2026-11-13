"use strict";
/* 语音音色回归：确认线上朗读走的是「晓晓女播音」而不是旧缓存/本机男声。
 *
 * 为什么要这条测试（2026-11-13 用户实测「改了音色还是男声」）：
 *   1) 音频按 URL 缓存 24h（浏览器 + CF 边缘）。只换服务端音色不改 URL，
 *      老文本会继续吐旧音频 → 听感仍是男声。
 *      对策：URL 带 TTS_REV（&v=4），本测试断言请求里确实带版本戳。
 *   2) 云端合成失败会静默退回系统本机语音，部分安卓机默认中文音色是男声。
 *      对策：本机兜底优先挑中文女声；本测试断言这次没有走本机（speechSynthesis 未发声）。
 *   3) 服务端音色凡有变化，响应头 x-yrb-voice 会写明，直接断言。
 *
 * 跑法：node tests/diag/tts_voice_test.js [https://xn--gmqq09al6z.cn]
 */
const fs = require("fs"), path = require("path");
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(p => fs.existsSync(p));

const BASE = process.argv[2] || "https://xn--gmqq09al6z.cn";
let pass = 0, fail = 0;
function ok(name, cond, extra) { cond ? pass++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); }

(async () => {
  const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const p = await c.newPage();

  const ttsHits = [], errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  p.on("response", async r => {
    const u = r.url();
    if (u.indexOf("/yrbtts") < 0) return;
    const h = r.headers();
    ttsHits.push({ url: u, status: r.status(), voice: h["x-yrb-voice"] || "", rev: h["x-yrb-tts-rev"] || "", cache: h["cf-cache-status"] || "", type: h["content-type"] || "" });
  });

  await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(e => errs.push("goto:" + e.message.slice(0, 80)));
  await p.waitForTimeout(9000);

  const before = await p.evaluate(() => ({
    cards: document.querySelectorAll("#feed .card").length,
    ttsBtns: document.querySelectorAll("#feed [data-tts]").length,
    build: (window.YRB_BUILD || ""),
    ver: (window.YRB_MEDIAFULL && window.YRB_MEDIAFULL.version) || "",
  }));
  ok("首页有卡片与朗读按钮", before.cards > 0 && before.ttsBtns > 0, before);

  const btn = await p.$("#feed [data-tts]");
  if (!btn) { console.log("没有朗读按钮，终止"); await b.close(); process.exit(1); }
  await btn.tap({ force: true }).catch(() => btn.click().catch(() => {}));

  await p.waitForTimeout(5000);
  const after = await p.evaluate(() => ({
    localSpeaking: !!(window.speechSynthesis && window.speechSynthesis.speaking),
    localPending: !!(window.speechSynthesis && window.speechSynthesis.pending),
    audioEls: document.querySelectorAll("audio").length,
  }));

  ok("确实发起了云端合成请求", ttsHits.length > 0, ttsHits.map(x => x.status));
  const v2 = ttsHits.filter(x => /[?&]v=4(&|$)/.test(x.url));
  ok("请求 URL 带版本戳 v=4（破旧音频缓存）", v2.length > 0, ttsHits[0] && ttsHits[0].url.slice(0, 120));
  ok("合成返回 200 且是音频", ttsHits.every(x => x.status === 200 && /audio\/mpeg/.test(x.type)), ttsHits.map(x => x.status + "/" + x.type));
  const voices = Array.from(new Set(ttsHits.map(x => x.voice).filter(Boolean)));
  ok("服务端音色 = 晓晓女播音（响应头指纹）", voices.length === 1 && /XiaoxiaoNeural/.test(voices[0]), voices);
  ok("未降级到本机语音（否则可能是系统男声）", !after.localSpeaking && !after.localPending, after);

  if (errs.length) console.log("  页面错误：", errs.slice(0, 4));
  console.log("==== " + pass + " 通过 / " + fail + " 失败 ====");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
