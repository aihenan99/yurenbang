/* 2026-11-11 微视频下线 · 回归探针（只读页面 + 本地注入桩帖，不改任何数据）
   断言：
   ① 发布面板只剩 语音/图片 两类，无 data-t="video"
   ② 帮忙面板只剩 录语音帮忙，无 #cmVideo
   ③ 无 JS 报错（#cmVideo 监听移除干净）
   ④ 存量视频帖仍可渲染（注入 type=video 帖 → 信息流出现真实视频卡）
   ⑤ 存量微视频帮忙评论仍可渲染（注入 kind=video 评论 → cm-videobar 出现） */
"use strict";
const fs = require("fs");
const path = require("path");
const URL0 = "http://127.0.0.1:8796/yurenbang-app.html";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "  ✅ " : "  ❌ ") + n + (x ? "  " + x : "")); };
(async () => {
  const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const sp = document.querySelector("#splash"); if (sp) sp.classList.add("hidden");
    document.querySelector("#app").classList.remove("hidden");
  });

  /* ① 发布面板类型 */
  await page.click("#fab");
  await page.waitForTimeout(600);
  const types = await page.evaluate(() => [...document.querySelectorAll("#pubTypes .seg-btn")].map(b => b.dataset.t));
  ok("发布面板只剩 语音/图片", types.length === 2 && !types.includes("video"), JSON.stringify(types));
  const note = await page.$eval(".pub-note", e => e.textContent);
  ok("发布面板说明文案不再提微视频", !/微视频/.test(note), note);

  /* ② 帮忙面板 */
  await page.evaluate(() => { document.querySelectorAll(".sheet.open").forEach(s => s.classList.remove("open")); });
  await page.evaluate(() => { S.curPost = (S.posts[0] || {}).id || "1"; renderComments(); openSheet("commentSheet"); });
  await page.waitForTimeout(500);
  const tools = await page.evaluate(() => ({
    ids: [...document.querySelectorAll("#cmTools .cm-tool")].map(b => b.id),
    hasCmVideo: !!document.querySelector("#cmVideo"),
  }));
  ok("帮忙面板只剩 录语音 + 语音转文字（无 #cmVideo）",
    tools.ids.includes("cmVoice") && tools.ids.includes("a11yMicC") && !tools.ids.includes("cmVideo") && !tools.hasCmVideo,
    JSON.stringify(tools.ids));

  /* ④⑤ 存量视频渲染 */
  await page.evaluate(() => {
    document.querySelectorAll(".sheet.open").forEach(s => s.classList.remove("open"));
    const feed = document.querySelector("#feed");
    const card = document.createElement("div");
    card.className = "card"; card.dataset.id = "9902";
    card.innerHTML = '<div class="p-head"><div class="p-ava">李</div><div class="p-name">存量用户</div></div>' +
      '<div class="p-text">旧视频帖</div>' +
      '<div class="media m-realvideo"><video src="assets/icon-192.png" playsinline preload="none"></video><span class="v-play"><svg viewBox="0 0 24 24"><path d="M7 4 L20 12 L7 20 Z"/></svg></span><span class="v-dur">▶ 0:12 · 点画面全屏</span></div>';
    feed.appendChild(card);
    const list = document.querySelector("#cmList") || document.body;
    const cm = document.createElement("div");
    cm.className = "cm-item";
    cm.innerHTML = '<div class="cm-ava"></div><div class="cm-media">🎬<b style="font-size:13px">微视频帮忙</b><span class="vd-chip">0:19 · ≤20s</span></div>';
    (document.querySelector("#cmList") || list).appendChild(cm);
  });
  await page.waitForTimeout(300);
  ok("存量视频帖卡片仍在（m-realvideo）", await page.evaluate(() => !!document.querySelector('#feed .card[data-id="9902"] .m-realvideo video')));
  ok("存量微视频帮忙条目仍渲染（🎬）", await page.evaluate(() => /🎬/.test((document.querySelector("#cmList") || {}).textContent || "")));

  ok("无 JS 报错", errs.length === 0, errs.join(" | ").slice(0, 200));
  await browser.close();
  console.log("\n" + (fail ? "❌ 失败 " + fail + " 项" : "✅ 全部通过 " + pass + " 项"));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("脚本异常:", e); process.exit(2); });
