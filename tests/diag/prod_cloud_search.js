/* 云端搜索端到端实测（2026-11-05）：线上页面里直接调 YRB_CLOUD.searchPosts，
   验证旧帖并进信息流、卡片数量增加、且搜索过滤后能看到命中卡片。
   跑法：node tests/diag/prod_cloud_search.js [url] */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
function findChrome() {
  for (const c of [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ]) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}
const BASE = process.argv[2] || "https://xn--gmqq09al6z.cn/";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
(async () => {
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, userAgent: UA, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 150)));
  await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForFunction(() => window.YRB_CLOUD && YRB_CLOUD.ready && YRB_CLOUD.ready(), { timeout: 30000 }).catch(() => {});
  await p.evaluate(() => { try { enterApp(); } catch (e) {} }).catch(() => {});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const before = document.querySelectorAll("#feed .card").length;
    const postsBefore = (window.S && S.posts ? S.posts.length : -1);
    let n = -1, ms = 0;
    try {
      const t0 = Date.now();
      n = await YRB_CLOUD.searchPosts("孩子");
      ms = Date.now() - t0;
    } catch (e) { return { err: String(e.message) }; }
    await new Promise((r2) => setTimeout(r2, 800));
    const after = document.querySelectorAll("#feed .card").length;
    const postsAfter = (window.S && S.posts ? S.posts.length : -1);
    /* 再把搜索框填上，看过滤后可见卡片 */
    const inp = document.getElementById("a11ySearch");
    let visibleFiltered = -1;
    if (inp) {
      inp.value = "孩子";
      if (window.applySearch) applySearch(); else inp.dispatchEvent(new Event("input"));
      await new Promise((r2) => setTimeout(r2, 300));
      visibleFiltered = [...document.querySelectorAll("#feed .card")].filter((c) => c.style.display !== "none").length;
      inp.value = ""; if (window.applySearch) applySearch();
    }
    return { before, after, postsBefore, postsAfter, hits: n, ms, visibleFiltered, hasSearchInput: !!inp };
  });
  console.log("RESULT", JSON.stringify(r));
  console.log("ERRORS", errs.length ? errs.slice(0, 4) : "无");
  await b.close();
})();
