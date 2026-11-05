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
  // 等启动页退场：轮询 #app 可见性，最多 15 秒
  await p.waitForFunction(() => {
    const app = document.getElementById("app");
    return app && app.offsetHeight > 100;
  }, { timeout: 15000 }).catch(() => {});
  await p.evaluate(() => window.YRB_CLOUD.paintMaint(true));
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const bar = document.getElementById("maintBar");
    if (!bar) return { ok: false };
    const a = bar.querySelector("a");
    const ra = a.getBoundingClientRect();
    const st = getComputedStyle(a);
    return {
      ok: true,
      text: bar.innerText.replace(/\s+/g, " "),
      href: a.getAttribute("href"),
      linkW: Math.round(ra.width), linkH: Math.round(ra.height),
      linkColor: st.color, linkBg: st.backgroundColor,
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      barRect: JSON.stringify(bar.getBoundingClientRect()),
    };
  });
  await p.screenshot({ path: "temp/_maintbar_preview2.png", clip: { x: 0, y: 0, width: 390, height: 300 } });
  console.log(JSON.stringify({ r, errs }, null, 2));
  await b.close();
})();
