/* 分享引导回归：微信内 / 无 share 浏览器 / 支持 share 三种情形
   场景1 微信 UA + 无 navigator.share → 出引导弹层（右上角···两步）
   场景2 普通 UA + 无 navigator.share → 出引导弹层（复制粘贴两步）+ 自动复制
   场景3 普通 UA + 有 navigator.share（mock 成功）→ 调用系统分享，不弹引导
   场景4 share.html 独立页同样出引导
   全程零 pageerror */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const BASE = "http://127.0.0.1:8794/";
const WXUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2d) NetType/WIFI Language/zh_CN";
const IOSUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

async function openShareLayer(p) {
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => { try { switchTab("me"); } catch (e) {} });
  await p.waitForTimeout(700);
  const ok = await p.evaluate(() => {
    const b = document.querySelector("#mmShare");
    if (!b) return false;
    b.click(); return true;
  });
  await p.waitForTimeout(700);
  return ok;
}
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const errs = [];

  /* --- 场景1：微信 + 无 share --- */
  let ctx = await b.newContext({ viewport: { width: 412, height: 900 }, userAgent: WXUA });
  let p = await ctx.newPage(); p.on("pageerror", e => errs.push("[wx] " + e.message));
  await p.addInitScript(() => { try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); } catch (e) {} });
  await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1800);
  const opened = await openShareLayer(p);
  const clicked = await p.evaluate(() => { const b = document.querySelector("#slShare"); if (!b) return false; b.click(); return true; });
  await p.waitForTimeout(500);
  const r1 = await p.evaluate(() => ({
    guide: !!document.querySelector("#shGuide.open"),
    text: (document.querySelector("#shGuide .shg-card") || {}).innerText ? document.querySelector("#shGuide .shg-card").innerText.replace(/\s+/g, " ").slice(0, 80) : "",
    hasQr: !!document.querySelector("#shGuide .shg-qr"),
    wechatSteps: /右上角/.test((document.querySelector("#shGuide") || {}).innerText || "")
  }));
  console.log("S1 微信: 分享入口", opened, "| 按钮", clicked, "| 弹层", r1.guide, "| 二维码", r1.hasQr, "| 右上角引导", r1.wechatSteps);
  console.log("   S1 文案:", r1.text);
  await p.screenshot({ path: "E:/育人帮/temp/shot-share-wx.png" });
  await ctx.close();

  /* --- 场景2：普通 iOS UA + 无 share --- */
  ctx = await b.newContext({ viewport: { width: 412, height: 900 }, userAgent: IOSUA, permissions: ["clipboard-read", "clipboard-write"] });
  p = await ctx.newPage(); p.on("pageerror", e => errs.push("[ios] " + e.message));
  await p.addInitScript(() => { try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); } catch (e) {} });
  await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1800);
  await openShareLayer(p);
  await p.evaluate(() => { const b = document.querySelector("#slShare"); if (b) b.click(); });
  await p.waitForTimeout(600);
  const r2 = await p.evaluate(async () => {
    let clip = "";
    try { clip = await navigator.clipboard.readText(); } catch (e) { clip = "(读不到)"; }
    return {
      guide: !!document.querySelector("#shGuide.open"),
      copied: /xn--gmqq09al6z|育人帮/.test(clip) || clip === "https://xn--gmqq09al6z.cn/",
      clip,
      copySteps: /已自动复制/.test((document.querySelector("#shGuide") || {}).innerText || "")
    };
  });
  console.log("S2 普通浏览器: 弹层", r2.guide, "| 自动复制", r2.copied, "| 文案含「已自动复制」", r2.copySteps, "| 剪贴板:", r2.clip);
  // 点复制按钮
  await p.evaluate(() => { const b = document.querySelector('#shGuide [data-shg="copy"]'); if (b) b.click(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const b = document.querySelector('#shGuide [data-shg="close"]'); if (b) b.click(); });
  await p.waitForTimeout(300);
  const r2b = await p.evaluate(() => !!document.querySelector("#shGuide.open"));
  console.log("S2 关闭后弹层隐藏:", !r2b);
  await p.screenshot({ path: "E:/育人帮/temp/shot-share-ios.png" });
  await ctx.close();

  /* --- 场景3：有 navigator.share（mock 成功）--- */
  ctx = await b.newContext({ viewport: { width: 412, height: 900 }, userAgent: IOSUA });
  p = await ctx.newPage(); p.on("pageerror", e => errs.push("[mock] " + e.message));
  await p.addInitScript(() => {
    window.__shared = null;
    Object.defineProperty(navigator, "share", { value: (d) => { window.__shared = d; return Promise.resolve(); }, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
  });
  await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1800);
  await openShareLayer(p);
  await p.evaluate(() => { const b = document.querySelector("#slShare"); if (b) b.click(); });
  await p.waitForTimeout(500);
  const r3 = await p.evaluate(() => ({ shared: window.__shared, guide: !!document.querySelector("#shGuide.open") }));
  console.log("S3 支持分享: 调用了系统分享", !!r3.shared, "| 分享URL", r3.shared && r3.shared.url, "| 弹引导", r3.guide);
  await ctx.close();

  /* --- 场景4：share.html 独立页（微信 UA 无 share）--- */
  ctx = await b.newContext({ viewport: { width: 412, height: 900 }, userAgent: WXUA });
  p = await ctx.newPage(); p.on("pageerror", e => errs.push("[share.html] " + e.message));
  await p.addInitScript(() => { try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); } catch (e) {} });
  await p.goto(BASE + "share.html?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById("sh").click());
  await p.waitForTimeout(500);
  const r4 = await p.evaluate(() => ({
    guide: !!document.querySelector("#shg.open"),
    wx: /右上角/.test((document.querySelector("#shg") || {}).innerText || ""),
    qr: !!document.querySelector("#shg .qr")
  }));
  console.log("S4 分享页: 弹层", r4.guide, "| 右上角引导", r4.wx, "| 二维码", r4.qr);
  await p.screenshot({ path: "E:/育人帮/temp/shot-share-page.png" });
  await ctx.close();

  console.log("PAGEERRORS:", errs.length ? errs.join(" | ").slice(0, 300) : "无");
  await b.close();
})();
