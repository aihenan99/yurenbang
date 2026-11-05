/* 截底部导航条，用于核对 ＋ 与两侧图标的水平位置（2026-11-01）
   用法：node tests/diag/_shot_fab.js  → 输出 .cache/shot-fab.png */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "https://xn--gmqq09al6z.cn/";
const fs = require("fs");
const path = require("path");

(async () => {
  const out = path.join(process.cwd(), ".cache");
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const box = await page.$eval("#tabbar", el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const fab = await page.$eval("#fab .fab-c", el => {
    const r = el.getBoundingClientRect();
    return { y: Math.round(r.y), h: Math.round(r.height), cy: Math.round(r.y + r.height / 2) };
  });
  const icons = await page.$$eval(".tb-item svg", es => es.map(e => {
    const r = e.getBoundingClientRect();
    return { cy: Math.round(r.y + r.height / 2) };
  }));
  console.log("tabbar:", JSON.stringify(box));
  console.log("＋ 圆心 y =", fab.cy, " 直径", fab.h);
  console.log("两侧图标圆心 y =", icons.map(i => i.cy).join(" / "));
  const f = path.join(out, "shot-fab.png");
  await page.screenshot({ path: f, clip: { x: 0, y: box.y - 70, width: 390, height: Math.min(box.h + 70, 844 - (box.y - 70)) } });
  console.log("截图：", f);
  await b.close();
})();
