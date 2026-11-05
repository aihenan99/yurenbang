/* 权限被拒时的面板形态实测（2026-11-05 小米实机反馈「设置已允许还是不能用」）
   做法：把 navigator.permissions.query 桩成 denied，再挂载语音/微视频面板截图。
   作用：确认「系统录音机/系统相机」确实被顶成主按钮，而不是又弹一次错误卡。
   跑法：node tests/diag/perm_ui_shot.js（需 8793 已起，deploy-cn 为根） */
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
const BASE = process.env.BASE || "http://127.0.0.1:8793/";
const UA = "Mozilla/5.0 (Linux; Android 13; 2211133C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 MiuiBrowser/17.3";
(async () => {
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await b.newContext({
    viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true,
    userAgent: UA, serviceWorkers: "block",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 150)));
  await p.addInitScript(() => {
    const st = { state: "denied", onchange: null, addEventListener() {} };
    if (navigator.permissions) navigator.permissions.query = async () => st;
  });
  await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForFunction(() => window.YRB_CAPTURE && window.YRB_CAPTURE.mount, { timeout: 25000 });
  await p.evaluate(() => { try { enterApp(); } catch (e) {} }).catch(() => {});
  await p.waitForTimeout(1200);

  const report = {};
  for (const type of ["voice", "video"]) {
    report[type] = await p.evaluate(async (t) => {
      const host = document.createElement("div");
      host.id = "permShotHost";
      host.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;z-index:99999;background:#fff;padding:16px;box-sizing:border-box;overflow:auto";
      document.body.appendChild(host);
      window.YRB_CAPTURE.mount(host, t);
      await new Promise((r) => setTimeout(r, 500));      /* 等 probePerms 回来 */
      const big = host.querySelector(".cap-big");
      const inp = host.querySelector('input[data-cap-in="' + (t === "voice" ? "audio" : "video") + '"]');
      return {
        bigText: big ? big.textContent.trim().replace(/\s+/g, " ") : null,
        hasSysInput: !!inp,
        inputCapture: inp ? inp.getAttribute("capture") : null,
        warn: (host.querySelector(".cap-warn") || {}).textContent ? "有提示条" : "无",
      };
    }, type);
    await p.screenshot({ path: `temp/perm-${type}.png` });
    await p.evaluate(() => {
      const h = document.getElementById("permShotHost");
      if (h) h.remove();
      window.YRB_CAPTURE.unmount();
    });
  }
  console.log(JSON.stringify(report, null, 2));
  if (errs.length) console.log("PAGE_ERRORS", errs.slice(0, 3));
  const ok = report.voice.bigText && /录音机/.test(report.voice.bigText) &&
             report.video.bigText && /相机/.test(report.video.bigText) &&
             report.voice.hasSysInput && report.video.hasSysInput;
  console.log(ok ? "PASS 被拒时主按钮 = 系统录音机/系统相机" : "FAIL 主按钮没切过去");
  await b.close();
  process.exit(ok ? 0 : 1);
})();
