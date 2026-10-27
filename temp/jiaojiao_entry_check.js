/* 本地校验：家教入口 chip 是否渲染、点击后是否进入 #page-jiaojiao */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const chip = await page.$("#funcrow .jj-chip");
  console.log("chip 存在:", !!chip);
  if (chip) {
    const box = await chip.boundingBox();
    console.log("chip 可见:", !!box && box.width > 0, box && Math.round(box.x) + "," + Math.round(box.y) + " " + Math.round(box.width) + "x" + Math.round(box.height));
    await chip.click();
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
      const p = document.querySelector("#page-jiaojiao");
      return p ? p.classList.contains("active") : false;
    });
    console.log("点击后进入登记页:", opened);
  }
  console.log("页面 JS 错误:", errs.length ? errs.slice(0, 3) : "无");
  await browser.close();
})();
