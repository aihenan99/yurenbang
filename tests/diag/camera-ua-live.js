/* 安卓微信 / 安卓浏览器 两套 UA 下的采集面板（capture.js 2026-11-03 晚）
   背景：用户反馈「安卓手机都无法使用摄像头，电脑网页版能用」。
   原因在微信内置浏览器：安卓微信不放行 getUserMedia（连权限框都不弹），
   所以安卓微信里主入口改成「手机相机」（input capture，任何手机都可用），
   失败卡也必须给「怎么在浏览器打开」而不是「去小锁改权限」。
   断言：
   W1 微信安卓 · 视频面板主按钮 = 打开手机相机（带 capture 的 input）
   W2 微信安卓 · 视频失败卡标题针对微信，且给「怎么在浏览器打开」
   W3 微信安卓 · 语音面板提示说明微信限制 + 录音机入口
   W4 微信安卓 · 语音失败卡同样走微信文案
   A1 安卓 Chrome · 视频面板仍是「开始拍摄」（不误伤支持直拍的浏览器）
   A2 安卓 Chrome · 失败卡给的是权限类建议（不是微信文案）
   X1 两种 UA 都无页面脚本错误 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const UA_WX = "Mozilla/5.0 (Linux; Android 13; V2118A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.44.2502(0x28002C35) WeChat/arm64";
const UA_AND = "Mozilla/5.0 (Linux; Android 13; V2118A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

async function openPane(b, ua, tag) {
  const ctx = await b.newContext({
    viewport: { width: 412, height: 900 }, serviceWorkers: "block", userAgent: ua
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8794/index.html?cap=" + tag + "-" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { try { openSheet("publishSheet"); } catch (e) {} });
  await p.waitForTimeout(400);
  return { p, ctx, errs };
}
async function pick(p, t) {
  await p.click('#pubTypes .seg-btn[data-t="' + t + '"]').catch(() => {});
  await p.waitForTimeout(700);
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });

  /* ---------- 微信安卓 ---------- */
  const w = await openPane(b, UA_WX, "wx");
  await pick(w.p, "video");
  const w1 = await w.p.evaluate(() => {
    const host = document.getElementById("r23Picker");
    const big = host.querySelector(".cap-big");
    const inp = host.querySelector('input[data-cap-in="video"][capture]');
    return {
      tag: big ? big.tagName : "", txt: big ? big.textContent.trim() : "",
      capture: !!inp, hasWebBtn: !!host.querySelector('[data-cap-vid="start"]'),
      tip: (host.querySelector(".cap-tip") || {}).textContent || ""
    };
  });
  ck("W1 微信安卓 · 主按钮是「手机相机」", w1.tag === "LABEL" && /相机/.test(w1.txt) && w1.capture && w1.hasWebBtn,
    JSON.stringify(w1));

  /* 点「网页里直接拍」→ 失败卡应针对微信 */
  await w.p.evaluate(() => { const b2 = document.querySelector('#r23Picker [data-cap-vid="start"]'); if (b2) b2.click(); });
  await w.p.waitForTimeout(1500);
  const w2 = await w.p.evaluate(() => {
    const h = document.querySelector("#r23Picker .cap-help");
    return h ? {
      title: (h.querySelector(".cap-help-t") || {}).textContent || "",
      openTxt: ([...h.querySelectorAll("[data-cap-help]")].find(x => x.dataset.capHelp === "open") || {}).textContent || "",
      cam: !!h.querySelector('input[data-cap-in="video"][capture]')
    } : null;
  });
  ck("W2 微信安卓 · 失败卡是微信文案 + 浏览器打开指引",
    !!w2 && /微信/.test(w2.title) && /浏览器打开/.test(w2.openTxt) && w2.cam, JSON.stringify(w2));

  /* 语音面板 */
  await w.p.evaluate(() => { const b3 = document.querySelector("#r23Picker [data-cap-help]"); if (b3) b3.click(); });
  await w.p.waitForTimeout(300);
  await pick(w.p, "voice");
  const w3 = await w.p.evaluate(() => {
    const host = document.getElementById("r23Picker");
    return {
      hint: (host.querySelector(".cap-hint") || {}).textContent || "",
      recIn: !!host.querySelector('input[data-cap-in="audio"][capture]'),
      mic: !!host.querySelector('[data-cap-aud="start"]')
    };
  });
  ck("W3 微信安卓 · 语音提示说明微信限制 + 录音机入口",
    /微信/.test(w3.hint) && w3.recIn && w3.mic, JSON.stringify(w3));

  await w.p.evaluate(() => { const m = document.querySelector('#r23Picker [data-cap-aud="start"]'); if (m) m.click(); });
  await w.p.waitForTimeout(1500);
  const w4 = await w.p.evaluate(() => {
    const h = document.querySelector("#r23Picker .cap-help");
    return h ? { title: (h.querySelector(".cap-help-t") || {}).textContent || "",
      recIn: !!h.querySelector('input[data-cap-in="audio"][capture]') } : null;
  });
  ck("W4 微信安卓 · 语音失败卡同为微信文案", !!w4 && /微信/.test(w4.title) && w4.recIn, JSON.stringify(w4));
  ck("X1 微信上下文无脚本错误", w.errs.length === 0, w.errs.join(" | "));
  await w.ctx.close();

  /* ---------- 安卓 Chrome（支持直拍的浏览器不能被误改） ---------- */
  const a = await openPane(b, UA_AND, "and");
  await pick(a.p, "video");
  const a1 = await a.p.evaluate(() => {
    const host = document.getElementById("r23Picker");
    const big = host.querySelector(".cap-big");
    return { tag: big ? big.tagName : "", txt: big ? big.textContent.trim() : "", hasSys: !!host.querySelector('input[data-cap-in="video"][capture]') };
  });
  ck("A1 安卓浏览器 · 主按钮仍是「开始拍摄」", a1.tag === "BUTTON" && /开始拍摄/.test(a1.txt), JSON.stringify(a1));

  await a.p.evaluate(() => { const b2 = document.querySelector('#r23Picker [data-cap-vid="start"]'); if (b2) b2.click(); });
  await a.p.waitForTimeout(1600);
  const a2 = await a.p.evaluate(() => {
    const h = document.querySelector("#r23Picker .cap-help");
    return h ? { title: (h.querySelector(".cap-help-t") || {}).textContent || "" } : null;
  });
  ck("A2 安卓浏览器 · 失败卡不是微信文案（走权限/设备说明）",
    !!a2 && !/微信/.test(a2.title) && a2.title.length > 0, JSON.stringify(a2));
  ck("X1b 安卓浏览器上下文无脚本错误", a.errs.length === 0, a.errs.join(" | "));
  await a.ctx.close();

  console.log("\n" + pass + "/" + (pass + fail) + " 通过");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
