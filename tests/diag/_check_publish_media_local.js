#!/usr/bin/env node
/* 本地验证发布面板媒体区（绕过登录门槛：openSheet 直开，不影响线上）：
 * 1) 媒体胶囊顺序=语音/图片/微视频
 * 2) 兼容样式 #cap-file-in-fix 已注入
 * 3) 点「图片」后 拍照/相册 输入框渲染、隐形但真实渲染、程序化 click 不抛错
 * 4) 点「语音」后 出现录音机降级入口（capture 属性） */
"use strict";
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?pmchk=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  const r1 = await p.evaluate(() => {
    try { openSheet("publishSheet"); } catch (e) { return { err: "openSheet:" + e.message }; }
    return {
      order: [...document.querySelectorAll("#pubTypes .seg-btn")].map((x) => x.dataset.t),
      note: (document.querySelector(".pub-note") || {}).textContent || "",
      fixStyle: !!document.getElementById("cap-file-in-fix"),
    };
  });
  await p.waitForTimeout(400);
  // 点「图片」→ 拍照/相册格子
  await p.click('#pubTypes .seg-btn[data-t="img"]').catch(() => {});
  await p.waitForTimeout(700);
  const r2 = await p.evaluate(() => {
    const shot = document.querySelector('#r23Picker input[data-cap-in="shot"]');
    const album = document.querySelector('#r23Picker input[data-cap-in="album"]');
    let programClickOk = false;
    try { if (shot) { shot.click(); programClickOk = true; } } catch (e) { return { err: e.message }; }
    return {
      hasShot: !!shot, hasAlbum: !!album, programClickOk,
      shotRendered: shot ? getComputedStyle(shot).display !== "none" : false,
      shotFixed: shot ? getComputedStyle(shot).position === "fixed" : false,
    };
  });
  // 点「语音」→ 录音机降级入口
  await p.click('#pubTypes .seg-btn[data-t="voice"]').catch(() => {});
  await p.waitForTimeout(700);
  const r3 = await p.evaluate(() => ({
    audioIn: !!document.querySelector('#r23Picker input[data-cap-in="audio"]'),
    recIn: !!document.querySelector('#r23Picker input[data-cap-in="audio"][capture]'),
    micBtn: !!document.querySelector('#r23Picker [data-cap-aud="start"]'),
  }));
  console.log("面板：", JSON.stringify(r1));
  console.log("图片格：", JSON.stringify(r2));
  console.log("语音格：", JSON.stringify(r3));
  console.log("页面错误：", errs.length ? errs.join(" | ") : "无");
  const ok = !r1.err && r1.order.join(",") === "voice,img,video" && r1.fixStyle
    && r2.hasShot && r2.hasAlbum && r2.programClickOk && r2.shotRendered && r2.shotFixed
    && r3.audioIn && r3.recIn && r3.micBtn && errs.length === 0;
  console.log(ok ? "✅ 本地验证全部通过" : "❌ 有项目未过，见上");
  await b.close();
})().catch((e) => { console.log("ERR", e.message); });
