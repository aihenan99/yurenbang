/* 采集层「App 内置浏览器」识别回归（2026-11-11）
   背景：用户反馈「换不同手机依然提示无法使用摄像头和麦克风」。
   真因是打开方式（微信等内置浏览器）被当成「权限被拒」，其中 iOS 微信过去完全没识别。
   本脚本用 UA 模拟 + 强制 getUserMedia 拒绝，断言各环境给的是「能照做」的指引。

   前置：本地源码服务在线  python -m http.server 8796 --directory yurenbang-app
   运行：node tests/diag/capture_shell_check.js
*/
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));

const BASE = "http://127.0.0.1:8796/yurenbang-app.html";
const UAS = {
  "iOS 微信": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49 NetType/WIFI",
  "安卓微信": "Mozilla/5.0 (Linux; Android 13; PGT-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116 Mobile Safari/537.36 MicroMessenger/8.0.42",
  "企业微信": "Mozilla/5.0 (Linux; Android 13; PGT-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116 Mobile Safari/537.36 wxwork/4.1.20 MicroMessenger/7.0.1",
  "iPhone Safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "安卓 Chrome": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"
};

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (detail ? " → " + detail : "")); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: (() => {
      for (const c of ["C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]) {
        try { if (fs.existsSync(c)) return c; } catch (e) {}
      }
      return undefined;
    })(),
    headless: true, args: ["--no-sandbox"]
  });

  const probe = async (ua, type) => {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    /* 模拟这些壳里 getUserMedia 被直接拒绝（真机就是 NotAllowedError，连框都不弹） */
    await ctx.addInitScript(() => {
      const rej = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = rej;
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3500);
    const r = await page.evaluate(async (t) => {
      if (!window.YRB_CAPTURE) return { err: "YRB_CAPTURE 未加载" };
      const host = document.createElement("div");
      document.body.appendChild(host);
      window.YRB_CAPTURE.mount(host, t, () => {});
      await new Promise(r => setTimeout(r, 400));
      const panel = host.innerText.replace(/\s+/g, " ");
      const sel = t === "voice" ? "[data-cap-aud='start']" : "[data-cap-vid='start']";
      const btn = host.querySelector(sel);
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 1200)); }
      const help = document.querySelector("[class*=cap-help]");
      return { panel, card: help ? help.innerText.replace(/\s+/g, " ") : "" };
    }, type);
    await ctx.close();
    return { ...r, errs };
  };

  console.log("=== A. iOS 微信：不再误导去改设置 ===");
  {
    const r = await probe(UAS["iOS 微信"], "voice");
    ok("面板直接给「怎么在浏览器打开」", /怎么在浏览器打开/.test(r.panel), r.panel.slice(0, 60));
    ok("面板说明不是手机问题", /换手机也一样/.test(r.panel), r.panel.slice(0, 60));
    ok("失败卡标题点名 iPhone 微信", /iPhone 的微信里不能直接用麦克风/.test(r.card), r.card.slice(0, 50));
    ok("失败卡指引「在默认浏览器打开」", /在默认浏览器打开/.test(r.card));
    ok("失败卡不再教「设置→Safari→权限」作为主路径", !/上一次可能点了「拒绝」/.test(r.card));
    ok("无脚本错误", r.errs.length === 0, r.errs[0]);
  }

  console.log("=== B. 安卓微信：系统录音机直接当主入口 ===");
  {
    const r = await probe(UAS["安卓微信"], "voice");
    ok("面板主按钮是「用手机录音机录一段」", /用手机录音机录一段/.test(r.panel), r.panel.slice(0, 60));
    ok("面板不再以「点大话筒」为主", !/点大话筒录音，最长/.test(r.panel));
    ok("失败卡仍点名微信", /微信里不能直接用麦克风/.test(r.card), r.card.slice(0, 40));
  }

  console.log("=== C. 企业微信：安卓上走系统相机（最优路径）===");
  {
    const r = await probe(UAS["企业微信"], "video");
    ok("面板点名企业微信", /企业微信里不能直接开摄像头/.test(r.panel), r.panel.slice(0, 40));
    ok("主入口是系统相机（不依赖网页权限）", /打开手机相机拍摄/.test(r.panel));
    ok("仍保留网页里试拍的次选", /网页里直接拍/.test(r.panel));
  }

  console.log("=== D. 正常浏览器不误伤 ===");
  {
    const r = await probe(UAS["iPhone Safari"], "voice");
    ok("Safari 仍显示正常录音面板", /点大话筒开始录音/.test(r.panel), r.panel.slice(0, 50));
    ok("Safari 失败卡仍是「权限被拒绝了」", /权限被拒绝了/.test(r.card));
    const r2 = await probe(UAS["安卓 Chrome"], "video");
    ok("安卓 Chrome 仍显示正常拍摄面板", /开始拍摄|现场拍摄/.test(r2.panel), r2.panel.slice(0, 50));
    ok("两者都无脚本错误", r.errs.length === 0 && r2.errs.length === 0);
  }

  await browser.close();
  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("ERR " + e.message); process.exit(1); });
