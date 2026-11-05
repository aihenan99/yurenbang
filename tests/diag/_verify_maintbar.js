const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 160)));
  await p.goto("http://127.0.0.1:8794/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(2500);
  const r1 = await p.evaluate(() => ({
    hasPaint: !!(window.YRB_CLOUD && typeof window.YRB_CLOUD.paintMaint === "function"),
    barBefore: !!document.getElementById("maintBar"),
  }));
  await p.evaluate(() => window.YRB_CLOUD.paintMaint(true));
  await p.waitForTimeout(300);
  const r2 = await p.evaluate(() => {
    const bar = document.getElementById("maintBar");
    if (!bar) return { ok: false };
    const a = bar.querySelector("a");
    const rect = a && a.getBoundingClientRect();
    return {
      ok: true,
      text: bar.innerText.replace(/\s+/g, " "),
      href: a && a.getAttribute("href"),
      linkHeight: rect && Math.round(rect.height),
      linkWidth: rect && Math.round(rect.width),
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      barTop: Math.round(bar.getBoundingClientRect().top),
    };
  });
  await p.screenshot({ path: "temp/_maintbar_preview.png", clip: { x: 0, y: 0, width: 390, height: 260 } });
  // 恢复后应自动移除
  await p.evaluate(() => window.YRB_CLOUD.paintMaint(false));
  const r3 = await p.evaluate(() => !!document.getElementById("maintBar"));
  console.log(JSON.stringify({ r1, r2, removedAfterRecover: !r3, errs }, null, 2));
  await b.close();
})();
