#!/usr/bin/env node
/* 线上验证 2026-11-02 发布面板修复：
 * 1) 媒体胶囊顺序=语音/图片/微视频
 * 2) 兼容样式 #cap-file-in-fix 已注入
 * 3) 点图片 label 不报错、文件框存在且可程序化触发
 * 只读，不上传任何东西 */
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
(async () => {
  const errs = [];
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
  await p.goto("https://xn--gmqq09al6z.cn/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForTimeout(8000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} }).catch(() => {});
  await p.waitForTimeout(1500);
  // 打开发布面板
  await p.click("#fab", { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const r1 = await p.evaluate(() => ({
    order: [...document.querySelectorAll("#pubTypes .seg-btn")].map((x) => x.dataset.t),
    note: (document.querySelector(".pub-note") || {}).textContent || "",
    fixStyle: !!document.getElementById("cap-file-in-fix"),
  }));
  // 点「图片」类型 → 拍照/相册格子出现 → 程序化触发 input.click()（headless 不弹框，只验证不抛错）
  await p.click('#pubTypes .seg-btn[data-t="img"]', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(800);
  const r2 = await p.evaluate(() => {
    const shot = document.querySelector('#r23Picker input[data-cap-in="shot"]');
    const album = document.querySelector('#r23Picker input[data-cap-in="album"]');
    let clicked = false;
    try { if (shot) { shot.click(); clicked = true; } } catch (e) { return { err: e.message }; }
    return {
      hasShot: !!shot, hasAlbum: !!album,
      shotRendered: shot ? getComputedStyle(shot).display !== "none" : false,
      programClickOk: clicked,
    };
  });
  console.log("面板：", JSON.stringify(r1));
  console.log("图片格：", JSON.stringify(r2));
  console.log("页面错误：", errs.length ? errs.join(" | ") : "无");
  const ok = r1.order.join(",") === "voice,img,video" && r1.fixStyle && r2.hasShot && r2.hasAlbum && r2.programClickOk && errs.length === 0;
  console.log(ok ? "✅ 线上验证通过" : "❌ 有项目未过，见上");
  await b.close();
})().catch((e) => { console.log("ERR", e.message); });
