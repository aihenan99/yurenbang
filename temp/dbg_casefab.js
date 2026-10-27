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
  console.log(await p.evaluate(() => {
    const f = document.querySelector("#caseFab");
    const r = f.getBoundingClientRect();
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, vh: innerHeight,
      cls: f.className, style: f.getAttribute("style"), parentCls: f.parentElement.className,
      display: getComputedStyle(f).display, pos: getComputedStyle(f).position };
  }));
  await b.close();
})();
