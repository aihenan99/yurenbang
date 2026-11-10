/* 调试②：完整复现 ①案例查看器→关闭 → ②详情点图 的时序，抓 class 时间线 */
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
    const vw = document.querySelector("#r23Viewer");
    const t0 = Date.now();
    new MutationObserver(() => {
      console.log("[dbg] t=" + (Date.now() - t0) + "ms viewer=[" + vw.className + "] histLen=" + history.length + " state=" + JSON.stringify(history.state));
    }).observe(vw, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("popstate", e => console.log("[dbg] POPSTATE t=" + (Date.now() - t0) + " state=" + JSON.stringify(e.state) + " navbackGuard=" + (window.YRB_NAVBACK && YRB_NAVBACK.guarded())));
  });

  /* ---- ① 案例查看器 ---- */
  console.log("--- ① 开案例查看器，点图，再点关 ---");
  await page.evaluate(() => {
    const vw = document.querySelector("#viewer");
    vw.classList.add("open");
    let imgs = vw.querySelector(".vw-imgs");
    if (!imgs) { imgs = document.createElement("div"); imgs.className = "vw-imgs"; vw.appendChild(imgs); }
    imgs.innerHTML = '<img src="assets/icon-192.png" data-full="assets/icon-512.png" alt="案例图" style="width:180px;height:120px;object-fit:cover">';
  });
  await page.waitForTimeout(350);
  let c = await page.evaluate(() => { const r = document.querySelector("#viewer .vw-imgs img").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(700);
  await page.mouse.click(195, 700);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("#viewer").classList.remove("open"));
  await page.waitForTimeout(1800);   // 等 navback 的 back() 回声彻底落地

  /* ---- ② 详情点图 ---- */
  console.log("--- ② 开详情，点图 ---");
  await page.evaluate(() => {
    const d = document.querySelector("#r23Detail");
    d.classList.add("open");
    const body = d.querySelector(".r23-dbody") || d;
    const w = document.createElement("div"); w.className = "r23-dimgs one";
    w.innerHTML = '<div class="di" data-i="0"><img src="assets/icon-192.png" data-full="assets/icon-512.png" alt="图1"><span class="zi">图 1/1</span></div>';
    body.insertBefore(w, body.firstChild);
  });
  await page.waitForTimeout(400);
  c = await page.evaluate(() => { const r = document.querySelector("#r23Detail .r23-dimgs img").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  console.log("[dbg] click2", JSON.stringify(c));
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(1200);
  console.log("[dbg] final viewer=[" + await page.evaluate(() => document.querySelector("#r23Viewer").className) + "]");
  await browser.close();
})().catch(e => { console.error("异常:", e); process.exit(2); });
