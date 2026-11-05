#!/usr/bin/env node
/* 细查：只读，不改任何东西。抓网络响应码 + 卡片来源 + 真实行数
 * 用法：node temp/probe_detail_1102.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const TARGET = "https://xn--gmqq09al6z.cn/";
const WAIT = 26000;

function findChrome() {
  const c = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}

(async () => {
  const resp = [];
  let browser = null;
  try {
    const { chromium } = require(path.join(__dirname, "pw", "node_modules", "playwright-core"));
    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      serviceWorkers: "block",
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
    });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      const u = r.url();
      if (/\.cloud|rest\/v1|yrbapi|auth\/v1/.test(u)) {
        resp.push({ s: r.status(), u: u.replace(TARGET, "/").slice(0, 150) });
      }
    });
    page.on("console", (m) => {
      const t = m.text();
      if (/云端|cloud|402|503|isolat|维护/i.test(t)) console.log("  [console]", t.slice(0, 200));
    });

    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(WAIT);

    const live = await page.evaluate(async () => {
      const out = {};
      out.postsState = (window.YRB_CLOUD && YRB_CLOUD.postsState) ? YRB_CLOUD.postsState() : "NO_API";
      const feed = document.querySelector("#feed");
      const cards = feed ? Array.from(feed.querySelectorAll(".card, article, .p-card")) : [];
      out.cardCount = cards.length;
      out.cards = cards.slice(0, 5).map((c) => ({
        cls: c.className,
        text: (c.innerText || "").replace(/\s+/g, " ").slice(0, 90),
      }));
      out.feedText = feed ? (feed.innerText || "").replace(/\s+/g, " ").slice(0, 220) : "";
      try {
        out.sPostsLen = (typeof S !== "undefined" && Array.isArray(S.posts)) ? S.posts.length : null;
        out.cloudPosts = (typeof S !== "undefined" && Array.isArray(S.posts))
          ? S.posts.filter((p) => p && p.__cloud).map((p) => ({ id: p.cloudId, t: (p.title || p.text || "").slice(0, 40) }))
          : null;
      } catch (e) { out.sErr = String(e && e.message); }

      // 直连 SDK 再查一次，验证数据面是否真的可读（只读 select，写不进去）
      try {
        const C = window.YRB_CLOUD;
        const sock = C && (C.client || C.sb || C.db);
        out.hasClient = !!sock;
      } catch (e) { out.clientErr = String(e && e.message); }

      out.maintVisible = !!document.querySelector("#maint, .maint, [data-maint]");
      const t = document.querySelector("#toast");
      out.toast = t ? (t.innerText || "").replace(/\s+/g, " ").slice(0, 120) : "";
      return out;
    });

    console.log("=== 页面状态 ===");
    console.log(JSON.stringify(live, null, 2));
    console.log("\n=== 云端相关请求（状态/路径）===");
    const seen = {};
    resp.forEach((r) => { const k = r.s + " " + r.u.split("?")[0]; seen[k] = (seen[k] || 0) + 1; });
    Object.keys(seen).forEach((k) => console.log(`  ${k}  ×${seen[k]}`));
    const bad = resp.filter((r) => r.s >= 400);
    console.log(`\n  4xx/5xx 共 ${bad.length} 条；402 共 ${resp.filter(r => r.s === 402).length} 条；503 共 ${resp.filter(r => r.s === 503).length} 条`);
  } catch (e) {
    console.log("ERR", e.message);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
})();
