/* 图片全屏 · 「下一级栏目」补测（只读页面）
   场景：① 案例查看器(.vw-imgs img) ② 普通详情图片(.r23-dimgs) ③ 帮忙留言图(.cm-item)
   断言：点开全屏 → 再点一下恢复原样（查看器关闭、原页面还在） */
"use strict";
const fs = require("fs");
const path = require("path");
const URL0 = "http://127.0.0.1:8796/yurenbang-app.html";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ✅ " : "  ❌ ") + name + (extra ? "  " + extra : ""));
}
(async () => {
  const { chromium } = require(path.join(__dirname, "pw", "node_modules", "playwright-core"));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [pageerror]", String(e.message).slice(0, 160)));
  page.on("console", m => { const t=m.text(); if(t.startsWith("[dbg]")) console.log(t); });
  await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const sp = document.querySelector("#splash"); if (sp) sp.classList.add("hidden");
    document.querySelector("#app").classList.remove("hidden");
  });

  /* DBG-HOOKS */
  await page.evaluate(() => {
    const vw0 = document.querySelector("#r23Viewer");
    const t0 = Date.now();
    new MutationObserver(() => console.log("[dbg] t=" + (Date.now()-t0) + " viewer=[" + vw0.className + "] state=" + JSON.stringify(history.state) + " navGuard=" + (window.YRB_NAVBACK&&YRB_NAVBACK.guarded()) + " navList=" + JSON.stringify(window.YRB_NAVBACK&&YRB_NAVBACK.list()))).observe(vw0, {attributes:true, attributeFilter:["class"]});
    window.addEventListener("popstate", e => console.log("[dbg] POPSTATE t=" + (Date.now()-t0) + " state=" + JSON.stringify(e.state) + " navGuard=" + (window.YRB_NAVBACK&&YRB_NAVBACK.guarded())));
    document.addEventListener("click", e => console.log("[dbg] click t=" + (Date.now()-t0) + " target=" + (e.target.id||e.target.className||e.target.tagName)), true);
  });
  const st = () => page.evaluate(() => {
    const v = document.querySelector("#r23Viewer");
    return {
      open: v.classList.contains("open"), mode: v.classList.contains("mf-imgv"),
      z: getComputedStyle(v).zIndex,
      src: (document.querySelector("#r23Big img") || {}).getAttribute ? document.querySelector("#r23Big img").getAttribute("src") : null,
    };
  });
  const closeV = () => page.evaluate(() => document.querySelector("#r23Viewer").classList.remove("open", "mf-imgv"));

  /* ---------- ① 案例查看器（下一级栏目）---------- */
  console.log("\n① 案例查看器 #viewer .vw-imgs");
  await page.evaluate(() => {
    const vw = document.querySelector("#viewer");
    vw.classList.add("open");
    const imgs = vw.querySelector(".vw-imgs") || (() => {
      const w = document.createElement("div"); w.className = "vw-imgs";
      vw.querySelector(".vw-body") ? vw.querySelector(".vw-body").appendChild(w) : vw.appendChild(w);
      return w;
    })();
    imgs.innerHTML = '<img src="assets/icon-192.png" data-full="assets/icon-512.png" alt="案例图1" style="width:180px;height:120px;object-fit:cover">';
  });
  await page.waitForTimeout(350);
  const cbox = await page.evaluate(() => {
    const r = document.querySelector("#viewer .vw-imgs img").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(cbox.x, cbox.y);
  await page.waitForTimeout(650);
  let s = await st();
  ok("案例查看器里点图片 → 全屏大图", s.open && s.mode, JSON.stringify(s));
  ok("用 data-full 原图", /icon-512/.test(s.src || ""), s.src);
  await page.screenshot({ path: "temp/imgviewer-3-case.png" });
  await page.mouse.click(195, 700);            // 再点黑底（非✕）
  await page.waitForTimeout(450);
  s = await st();
  ok("再点一下 → 恢复（查看器还开着、大图关闭）", !s.open,
    "viewerOpen=" + await page.evaluate(() => document.querySelector("#viewer").classList.contains("open")));
  await closeV();

  /* ---------- ② 普通求助详情图片 ---------- */
  console.log("\n② 求助详情 #r23Detail .r23-dimgs（普通态，非全屏）");
  await page.evaluate(() => {
    const d = document.querySelector("#r23Detail");
    d.classList.add("open");
    const body = d.querySelector(".r23-dbody") || d;
    if (!body.querySelector(".r23-dimgs")) {
      const w = document.createElement("div"); w.className = "r23-dimgs one";
      w.innerHTML = '<div class="di" data-i="0"><img src="assets/icon-192.png" data-full="assets/icon-512.png" alt="图1"><span class="zi">图 1/1</span></div>';
      body.insertBefore(w, body.firstChild);
    }
  });
  await page.waitForTimeout(350);
  const dbox2 = await page.evaluate(() => {
    const r = document.querySelector("#r23Detail .r23-dimgs img").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(dbox2.x, dbox2.y);
  await page.waitForTimeout(650);
  s = await st();
  ok("详情里点图片 → 全屏大图", s.open && s.mode, JSON.stringify(s));
  await page.mouse.click(195, 700);
  await page.waitForTimeout(450);
  s = await st();
  ok("再点一下 → 恢复详情原样", !s.open,
    "detailOpen=" + await page.evaluate(() => document.querySelector("#r23Detail").classList.contains("open")));
  await page.evaluate(() => document.querySelector("#r23Detail").classList.remove("open", "mf-fs"));

  /* ---------- ③ 帮忙留言图片 ---------- */
  console.log("\n③ 帮忙留言 .cm-item img");
  await page.evaluate(() => {
    const d = document.querySelector("#r23Detail");
    d.classList.add("open");
    const list = document.querySelector("#r23CmList") || (() => {
      const w = document.createElement("div"); w.id = "r23CmList";
      (d.querySelector(".r23-dbody") || d).appendChild(w); return w;
    })();
    const it = document.createElement("div"); it.className = "cm-item";
    it.innerHTML = '<div class="cm-imgs"><img src="assets/icon-192.png" data-full="assets/icon-512.png" alt="留言图" style="width:160px;height:110px;object-fit:cover"></div>';
    list.appendChild(it);
  });
  await page.waitForTimeout(350);
  const mbox = await page.evaluate(() => {
    const r = document.querySelector("#r23CmList .cm-item img").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(mbox.x, mbox.y);
  await page.waitForTimeout(650);
  s = await st();
  ok("留言里点图片 → 全屏大图", s.open && s.mode, JSON.stringify(s));
  await page.mouse.click(195, 700);
  await page.waitForTimeout(450);
  s = await st();
  ok("再点一下 → 恢复", !s.open);
  await page.evaluate(() => document.querySelector("#r23Detail").classList.remove("open", "mf-fs"));

  await browser.close();
  console.log("\n" + (fail ? "❌ 失败 " + fail + " 项" : "✅ 全部通过 " + pass + " 项"));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("脚本异常:", e); process.exit(2); });
