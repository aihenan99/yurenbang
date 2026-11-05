/* 线上页面体检：截各页画面 + 统计资源体积（2026-11-05 「流畅、实用」迭代用）
   跑法：node tests/diag/ui_audit.js [url]
   产出：temp/ui-*.png 与一份资源统计（图片张数/字节、脚本数/字节） */
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
const UA = "Mozilla/5.0 (Linux; Android 13; 2211133C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

(async () => {
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await b.newContext({
    viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true,
    userAgent: UA, serviceWorkers: "block",
  });
  const p = await ctx.newPage();
  const errs = [];
  const res = { js: [0, 0], css: [0, 0], img: [0, 0], other: [0, 0] };
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
  p.on("response", async (r) => {
    try {
      const u = r.url();
      const ct = (r.headers()["content-type"] || "");
      const len = +(r.headers()["content-length"] || 0) || 0;
      const k = ct.includes("javascript") ? "js" : ct.includes("css") ? "css"
        : ct.startsWith("image/") ? "img" : "other";
      res[k][0]++; res[k][1] += len;
    } catch (e) {}
  });
  const t0 = Date.now();
  await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(2500);
  const boot = Date.now() - t0;
  /* 进站：点启动屏 */
  await p.evaluate(() => { try { enterApp(); } catch (e) {} }).catch(() => {});
  await p.waitForTimeout(2200);
  await p.screenshot({ path: "temp/ui-1-home.png", fullPage: false });

  const shot = async (name, fn) => {
    try { await p.evaluate(fn); } catch (e) { errs.push("shot " + name + ": " + e.message); }
    await p.waitForTimeout(1200);
    await p.screenshot({ path: "temp/ui-" + name + ".png" });
  };
  await shot("2-msgs", () => window.switchTab && switchTab("msgs"));
  await shot("3-me", () => window.switchTab && switchTab("me"));
  await shot("4-cases", () => window.switchTab && switchTab("cases"));
  await shot("5-home2", () => window.switchTab && switchTab("home"));

  /* 打开第一条求助详情 */
  const opened = await p.evaluate(() => {
    const c = document.querySelector("#feed .card");
    if (!c) return { ok: false, cards: document.querySelectorAll("#feed .card").length };
    const id = c.dataset.id;
    const btn = c.querySelector("[data-act='open'], .c-title, .c-body");
    (btn || c).click();
    return { ok: true, id };
  });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: "temp/ui-6-detail.png" });

  const info = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    return {
      build: (window.YRB_BUILD || "") + "",
      cards: document.querySelectorAll("#feed .card").length,
      imgTotal: imgs.length,
      imgNoAlt: imgs.filter((i) => !i.getAttribute("alt")).length,
      imgNoLazy: imgs.filter((i) => i.getAttribute("loading") !== "lazy" && !i.closest("#splash")).length,
      imgBroken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.src).length,
      pageH: document.documentElement.scrollHeight,
      hasSearch: !!document.querySelector("#searchBtn, .search, [data-act='search']"),
    };
  });
  const kb = (n) => (n / 1024).toFixed(0) + "KB";
  console.log("BOOT_MS", boot);
  console.log("BUILD", info.build);
  console.log("RES js", res.js[0] + "个", kb(res.js[1]), "| css", res.css[0] + "个", kb(res.css[1]),
    "| img", res.img[0] + "张", kb(res.img[1]), "| other", res.other[0] + "个", kb(res.other[1]));
  console.log("DOM cards", info.cards, "| img", info.imgTotal, "| 缺alt", info.imgNoAlt,
    "| 缺lazy", info.imgNoLazy, "| broken", info.imgBroken, "| 搜索入口", info.hasSearch);
  console.log("openDetail", JSON.stringify(opened));
  console.log("ERRORS", errs.length ? errs.slice(0, 5) : "无");
  await b.close();
})();
