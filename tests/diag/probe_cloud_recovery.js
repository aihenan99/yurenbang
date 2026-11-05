/* 云服务恢复探测：只读，不改任何数据。读取线上站首页运行时状态 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL = "https://xn--gmqq09al6z.cn/";

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true,
    serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push("PAGEERR: " + String(e).slice(0, 200)));
  p.on("console", m => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 200)); });

  const t0 = Date.now();
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => errs.push("GOTO: " + e.message));
  await p.waitForTimeout(8000); // 按要求等待 8 秒

  const out = await p.evaluate(() => {
    const r = { cloudReady: null, hasCloud: false, postsState: null, feedCards: 0, toast: "", feedHtmlLen: 0 };
    r.hasCloud = typeof window.YRB_CLOUD === "object" && !!window.YRB_CLOUD;
    try { r.cloudReady = !!(window.YRB_CLOUD && typeof window.YRB_CLOUD.postsState === "function"); } catch (e) {}
    try { if (r.cloudReady) r.postsState = window.YRB_CLOUD.postsState(); } catch (e) { r.postsState = "ERR:" + e.message; }
    const feed = document.querySelector("#feed");
    if (feed) {
      r.feedCards = feed.querySelectorAll(".card, article, .p-card").length;
      r.feedHtmlLen = feed.innerHTML.length;
      r.feedText = (feed.innerText || "").replace(/\s+/g, " ").slice(0, 300);
    }
    const t = document.querySelector("#toast");
    r.toast = t ? (t.innerText || "").replace(/\s+/g, " ").slice(0, 200) : "";
    try { r.postsLen = (typeof S !== "undefined" && S.posts) ? S.posts.length : null; } catch (e) {}
    return r;
  });

  console.log("耗时", Date.now() - t0, "ms");
  console.log(JSON.stringify(out, null, 2));
  console.log("ERRORS:", errs.length ? errs.slice(0, 8) : "none");
  await b.close();
})();
