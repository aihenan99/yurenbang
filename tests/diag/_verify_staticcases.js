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
  await p.waitForFunction(() => {
    const a = document.getElementById("app"); return a && a.offsetHeight > 100;
  }, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1200);

  const before = await p.evaluate(() => ({
    hasLayer: !!(window.YRB_STATICCASE && window.YRB_STATICCASE.list),
    count: (window.YRB_STATICCASE || {}).list ? YRB_STATICCASE.list.length : 0,
    scHome: !!document.getElementById("scHome"),
  }));

  // 模拟隔离态
  await p.evaluate(() => {
    YRB_CLOUD.postsState = () => "isolated";
    YRB_CLOUD.casesState = () => "isolated";
    YRB_STATICCASE.refresh();
  });
  await p.waitForTimeout(400);

  const iso = await p.evaluate(() => {
    const home = document.getElementById("scHome");
    const cards = home ? home.querySelectorAll(".sc-card") : [];
    const first = cards[0];
    const r = first && first.getBoundingClientRect();
    const t = first && first.querySelector(".sc-t");
    return {
      scHome: !!home,
      homeCards: cards.length,
      hrefs: [...cards].map(a => a.getAttribute("href")),
      cardRect: r && [Math.round(r.width), Math.round(r.height)],
      titleLines: t ? Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) : 0,
      hasMore: !!home.querySelector(".sc-more"),
      homeOn: document.getElementById("page-home").classList.contains("sc-on"),
      emptyHidden: (() => {
        const e = document.querySelector("#feed .empty");
        return e ? getComputedStyle(e).display : "none-found";
      })(),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scCases: !!document.getElementById("scCases"),
      caseCards: document.querySelectorAll("#scCases .sc-card").length,
      bodyText: (document.querySelector("#scHome .sc-h") || {}).textContent || "",
    };
  });

  await p.screenshot({ path: "temp/_staticcases_home.png", clip: { x: 0, y: 0, width: 390, height: 760 } });

  // 切到案例页截图
  await p.evaluate(() => { if (window.switchTab) switchTab("cases"); });
  await p.waitForTimeout(600);
  await p.screenshot({ path: "temp/_staticcases_cases.png", clip: { x: 0, y: 0, width: 390, height: 700 } });

  // 恢复态：应自动撤掉
  await p.evaluate(() => {
    YRB_CLOUD.postsState = () => "ok";
    YRB_CLOUD.casesState = () => "ok";
    YRB_STATICCASE.refresh();
  });
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({
    scHome: !!document.getElementById("scHome"),
    scCases: !!document.getElementById("scCases"),
    homeOn: document.getElementById("page-home").classList.contains("sc-on"),
  }));

  console.log(JSON.stringify({ before, iso, after, errs }, null, 1));
  await b.close();
})();
