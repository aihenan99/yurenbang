/* 验证：云端 jiaojiao_qr 有值后，家教页是否真的换成新二维码 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const vis = await page.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (vis) { await page.click("#splash"); await page.waitForTimeout(700); }
  /* 打开家教页 */
  await page.evaluate(() => { try { switchTab("jiaojiao"); } catch (e) {} });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const img = document.querySelector("#page-jiaojiao .jj-qr");
    return {
      src: img ? img.src.slice(0, 60) : "(no img)",
      isTest: img ? img.src.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB") : false,
      natural: img ? img.naturalWidth : -1,
      cached: (localStorage.getItem("yrb_jj_qr") || "").slice(0, 40)
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
