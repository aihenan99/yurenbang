/* 图片全屏大图 · 本地实测（只读页面，不改线上任何东西）
   用法：node temp/test_imgviewer.js
   断言：点开 / 再点关 / 双击不闪退 / 全屏详情里压得住 (z95 > z90) / 点正文仍进详情 */
"use strict";
const fs = require("fs");
const path = require("path");

const URL0 = "http://127.0.0.1:8796/yurenbang-app.html";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? "  ✅ " : "  ❌ ") + name + (extra ? "  " + extra : ""));
}

(async () => {
  const { chromium } = require(path.join(__dirname, "pw", "node_modules", "playwright-core"));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [pageerror]", String(e.message).slice(0, 160)));
  await page.goto(URL0, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);

  async function ensureCard() {
    await page.evaluate(() => {
      const feed = document.querySelector("#feed");
      if (!feed || document.querySelector("#feed .card[data-id='9901']")) return;
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = "9901";
      card.innerHTML = '<div class="p-head"><div class="p-ava">王</div><div class="p-name">测试</div></div>' +
        '<div class="p-text">图片全屏测试</div>' +
        '<div class="media m-imgs n1"><img class="real-img" src="assets/icon-192.png" data-full="assets/icon-512.png" alt="求助图片1"></div>';
      feed.appendChild(card);
      const sp = document.querySelector("#splash"); if (sp) sp.classList.add("hidden");
      document.querySelector("#app").classList.remove("hidden");
    });
    await page.waitForTimeout(250);
  }
  const resetViewer = () => page.evaluate(() => {
    document.querySelector("#r23Viewer").classList.remove("open", "mf-imgv");
    document.querySelector("#r23Detail").classList.remove("open", "mf-fs");
  });

  const guardOn = await page.evaluate(() => document.documentElement.classList.contains("yrb-guard"));
  console.log("  · html.yrb-guard =", guardOn, "(true = 图片 pointer-events:none，点击落在父容器上)");
  ok("mediafull 已是 v5", await page.evaluate(() => window.YRB_MEDIAFULL && window.YRB_MEDIAFULL.version === "5"),
    "v=" + await page.evaluate(() => window.YRB_MEDIAFULL && window.YRB_MEDIAFULL.version));

  await ensureCard();

  // 1) 单击（打在图片容器上，模拟真实点击）
  await (await page.$("#feed .card[data-id='9901'] .media")).tap({ force: true });
  await page.waitForTimeout(600);
  let st = await page.evaluate(() => {
    const v = document.querySelector("#r23Viewer");
    const big = document.querySelector("#r23Big img");
    return {
      open: v.classList.contains("open"), imgMode: v.classList.contains("mf-imgv"),
      z: getComputedStyle(v).zIndex,
      src: big ? big.getAttribute("src") : null,
      tip: !!document.querySelector("#mfIvTip"),
      w: big ? Math.round(big.getBoundingClientRect().width) : 0,
      h: big ? Math.round(big.getBoundingClientRect().height) : 0,
      vw: Math.round(v.getBoundingClientRect().width), vh: Math.round(v.getBoundingClientRect().height),
      detailOpen: document.querySelector("#r23Detail").classList.contains("open"),
    };
  });
  ok("单击照片 → 打开全屏大图", st.open && st.imgMode, JSON.stringify(st));
  ok("用 data-full 原图（512 而不是 192）", /icon-512/.test(st.src || ""), st.src);
  ok("层级 95（高于全屏详情 90）", st.z === "95", "z=" + st.z);
  ok("图片铺满屏幕（contain，不裁切）", st.w >= st.vw - 2 && st.h <= st.vh + 1, `img ${st.w}x${st.h} / 层 ${st.vw}x${st.vh}`);
  ok("没有顺带把文字详情拉开", !st.detailOpen);
  ok("有返回提示", st.tip);
  await page.screenshot({ path: "temp/imgviewer-1-open.png" });

  // 2) 再点一下返回
  await page.tap("#r23Viewer");
  await page.waitForTimeout(500);
  st = await page.evaluate(() => ({ open: document.querySelector("#r23Viewer").classList.contains("open") }));
  ok("再点一下 → 关闭返回", !st.open);

  // 3) 双击：不能开了立刻关
  await resetViewer(); await ensureCard(); await page.waitForTimeout(300);
  const box = await (await page.$("#feed .card[data-id='9901'] .media")).boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);
  st = await page.evaluate(() => ({ open: document.querySelector("#r23Viewer").classList.contains("open") }));
  ok("双击 → 保持打开（不闪退）", st.open);

  // 4) 全屏详情（.mf-fs，z90）里点详情内的照片：必须压在最上层
  await resetViewer();
  await page.evaluate(() => {
    const d = document.querySelector("#r23Detail");
    d.classList.add("open", "mf-fs");
    const body = document.querySelector(".r23-dbody") || d;
    if (!body.querySelector(".r23-dimgs")) {
      const wrap = document.createElement("div");
      wrap.className = "r23-dimgs one";
      wrap.innerHTML = '<div class="di" data-i="0"><img class="real-img" src="assets/icon-192.png" data-full="assets/icon-512.png" alt="图片1"><span class="zi">图 1/1</span></div>';
      body.insertBefore(wrap, body.firstChild);
    }
  });
  await page.waitForTimeout(350);
  const dbox = await page.evaluate(() => {
    const im = document.querySelector("#r23Detail .r23-dimgs .di img");
    const r = im.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(dbox.x, dbox.y);
  await page.waitForTimeout(700);
  st = await page.evaluate(() => {
    const v = document.querySelector("#r23Viewer"), d = document.querySelector("#r23Detail");
    const vr = v.getBoundingClientRect();
    const top = document.elementFromPoint(vr.width / 2, vr.height / 2);
    return { open: v.classList.contains("open"), zV: getComputedStyle(v).zIndex, zD: getComputedStyle(d).zIndex,
      hit: top ? (top.id || top.className || top.tagName) : null };
  });
  ok("全屏详情里点照片 → 大图在最上层（不再被自己盖住）",
    st.open && Number(st.zV) > Number(st.zD) && /r23Big|r23Viewer|img|big/i.test(String(st.hit)),
    JSON.stringify(st));
  await page.screenshot({ path: "temp/imgviewer-2-fullscreen-detail.png" });

  // 5) 点正文不会误开大图（图片逻辑不抢文字区）
  await resetViewer(); await ensureCard(); await page.waitForTimeout(400);
  await (await page.$("#feed .card[data-id='9901'] .p-text")).tap({ force: true });
  await page.waitForTimeout(900);
  st = await page.evaluate(() => ({
    imgv: document.querySelector("#r23Viewer").classList.contains("open"),
    detail: document.querySelector("#r23Detail").classList.contains("open"),
  }));
  ok("点正文 → 不打开图片查看器（文字区没被抢）", !st.imgv, JSON.stringify(st));

  await browser.close();
  const bad = results.filter(r => !r.pass);
  console.log("\n" + (bad.length ? "❌ 失败 " + bad.length + " 项" : "✅ 全部通过 " + results.length + " 项"));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error("测试脚本异常:", e); process.exit(2); });
