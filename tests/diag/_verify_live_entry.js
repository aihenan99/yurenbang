const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux/Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 140)));
  await p.goto("https://xn--gmqq09al6z.cn/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => errs.push("goto:" + e.message));
  await p.waitForTimeout(9000);
  const r = await p.evaluate(() => {
    const bar = document.getElementById("maintBar");
    const a = bar && bar.querySelector("a");
    const ra = a && a.getBoundingClientRect();
    return {
      build: (document.querySelector('meta[name="yrb-build"]') || {}).content || null,
      postsState: (window.YRB_CLOUD && window.YRB_CLOUD.postsState && window.YRB_CLOUD.postsState()) || null,
      barExists: !!bar,
      barText: bar ? bar.innerText.replace(/\s+/g, " ").slice(0, 90) : "",
      linkHref: a ? a.getAttribute("href") : null,
      linkSize: ra ? Math.round(ra.width) + "x" + Math.round(ra.height) : null,
    };
  });
  await p.screenshot({ path: "temp/_live_entry.png", clip: { x: 0, y: 0, width: 390, height: 300 } });
  // 点进去看是否真能到案例库
  if (await p.$("#maintBar a")) {
    await Promise.all([p.waitForNavigation({ timeout: 30000 }).catch(()=>{}), p.click("#maintBar a")]);
    await p.waitForTimeout(1500);
  }
  const nav = await p.evaluate(() => ({ url: location.pathname, title: document.title, cards: document.querySelectorAll("a[href*='/anli/'], .card, article").length }));
  console.log(JSON.stringify({ r, nav, errs }, null, 2));
  await b.close();
})();
