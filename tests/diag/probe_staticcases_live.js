/* 线上验收：隔离期静态内容区是否真的出现在首页与案例广场（只读，不改任何数据）
   跑法：node tests/diag/probe_staticcases_live.js
   2026-11-01 建立，用于 staticcases 层发布后验收与回归。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL = "https://xn--gmqq09al6z.cn/";

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
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => errs.push("goto:" + e.message));
  await p.waitForTimeout(8000);

  const r = await p.evaluate(() => {
    const home = document.getElementById("scHome");
    const cards = home ? [...home.querySelectorAll(".sc-card")] : [];
    return {
      build: (document.querySelector('meta[name="yrb-build"]') || {}).content || null,
      postsState: (window.YRB_CLOUD && YRB_CLOUD.postsState && YRB_CLOUD.postsState()) || null,
      hasLayer: !!window.YRB_STATICCASE,
      scHome: !!home,
      homeCards: cards.length,
      firstHref: cards[0] && cards[0].getAttribute("href"),
      firstCardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
      bannerText: (document.getElementById("maintBar") || {}).innerText || "",
      scCases: !!document.getElementById("scCases"),
      caseCards: document.querySelectorAll("#scCases .sc-card").length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      feedCards: document.querySelectorAll("#feed .card").length,
    };
  });

  await p.screenshot({ path: "temp/live-staticcases-home.png", clip: { x: 0, y: 0, width: 390, height: 780 } });

  /* 点第一张卡，确认真的能进静态案例页 */
  let nav = null;
  if (await p.$("#scHome .sc-card")) {
    await Promise.all([
      p.waitForNavigation({ timeout: 30000 }).catch(() => {}),
      p.click("#scHome .sc-card"),
    ]);
    await p.waitForTimeout(800);
    nav = await p.evaluate(() => ({
      path: location.pathname,
      title: document.title.slice(0, 40),
      hasBody: (document.body.innerText || "").length > 600,
    }));
    await p.screenshot({ path: "temp/live-staticcase-article.png" });
  }

  console.log(JSON.stringify({ r, nav, errs }, null, 1));
  await b.close();
})();
