/* 调试：详情(普通态)点图后 #r23Viewer 的 class 变化时间线 */
"use strict";
const fs = require("fs");
const path = require("path");
const URL0 = "http://127.0.0.1:8796/yurenbang-app.html";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));
(async () => {
  const { chromium } = require(path.join(__dirname, "pw", "node_modules", "playwright-core"));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  page.on("console", m => { const t = m.text(); if (t.startsWith("[dbg]")) console.log(t); });
  page.on("pageerror", e => console.log("[pageerror]", String(e.message).slice(0, 160)));
  await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const sp = document.querySelector("#splash"); if (sp) sp.classList.add("hidden");
    document.querySelector("#app").classList.remove("hidden");
    /* class 变化时间线 */
    const vw = document.querySelector("#r23Viewer");
    const t0 = Date.now();
    new MutationObserver(() => {
      console.log("[dbg] t=" + (Date.now() - t0) + "ms viewer classes=" + vw.className + " z=" + getComputedStyle(vw).zIndex);
    }).observe(vw, { attributes: true, attributeFilter: ["class"] });
    /* 记录 click 落点 */
    document.addEventListener("click", e => console.log("[dbg] click target=" + (e.target.id || e.target.className || e.target.tagName) + " x=" + e.clientX + " y=" + e.clientY), true);
    const d = document.querySelector("#r23Detail");
    d.classList.add("open");
    const body = d.querySelector(".r23-dbody") || d;
    const w = document.createElement("div"); w.className = "r23-dimgs one";
    w.innerHTML = '<div class="di" data-i="0"><img src="assets/icon-192.png" data-full="assets/icon-512.png" alt="图1"><span class="zi">图 1/1</span></div>';
    body.insertBefore(w, body.firstChild);
  });
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const r = document.querySelector("#r23Detail .r23-dimgs img").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  console.log("[dbg] clicking", JSON.stringify(box));
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(1200);
  await browser.close();
})().catch(e => { console.error("异常:", e); process.exit(2); });
