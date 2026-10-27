const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }
  await p.evaluate(() => switchTab("cases"));
  await p.waitForTimeout(300);
  await p.tap("#caseFab");
  await p.waitForTimeout(500);
  console.log("tap1 →", await p.evaluate(() => ({
    case: document.querySelector("#caseUpSheet").classList.contains("open"),
    login: document.querySelector("#loginSheet").classList.contains("open") })));
  await p.evaluate(() => { const x = document.querySelector("#lgX"); x && x.click(); });
  await p.waitForTimeout(400);
  await p.tap("#caseFab");
  await p.waitForTimeout(500);
  console.log("tap2 →", await p.evaluate(() => ({
    case: document.querySelector("#caseUpSheet").classList.contains("open"),
    login: document.querySelector("#loginSheet").classList.contains("open"),
    fabRect: document.querySelector("#caseFab").getBoundingClientRect().toJSON() })));
  await b.close();
})();
