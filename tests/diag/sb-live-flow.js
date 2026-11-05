/* 线上验收：Supabase 全链路（注册 → 登录 → 发帖 → 刷新可见 → 清理）
   跑法：node tests/diag/sb-live-flow.js */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const SITE = "https://xn--gmqq09al6z.cn/";
const uname = "验收" + Date.now().toString(36).slice(-5);
const pwd = "Test12345";

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 120)));

  await p.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForFunction(() => {
    const a = document.getElementById("app"); return a && a.offsetHeight > 100;
  }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(3500);

  const boot = await p.evaluate(() => ({
    hasSB: !!(window.YRB_SB && YRB_SB.createClient),
    state: (window.YRB_CLOUD && YRB_CLOUD.postsState && YRB_CLOUD.postsState()) || null,
    maint: !!document.getElementById("maintBar"),
    scHome: !!document.getElementById("scHome"),
    scCards: document.querySelectorAll("#scHome .sc-card").length,
    build: (document.querySelector('meta[name="yrb-build"]') || {}).content || null,
  }));

  // 打开登录面板 → 注册
  await p.evaluate(() => YRB_CLOUD.openLogin());
  await p.waitForTimeout(500);
  await p.click("#lgToReg");
  await p.fill("#lgAcct", uname);
  await p.fill("#lgPwd2", pwd);
  // 勾同意
  const agreed = await p.evaluate(() => {
    const c = document.getElementById("lgCk");
    if (c && !c.classList.contains("on")) { c.click(); return true; }
    return !!(c && c.classList.contains("on"));
  });
  await p.click("#lgPwdSubmit");
  await p.waitForTimeout(6000);

  const afterReg = await p.evaluate(() => ({
    signedIn: !!(window.YRB_CLOUD && YRB_CLOUD.signedIn()),
    who: (window.YRB_CLOUD && YRB_CLOUD.who && YRB_CLOUD.who()) || null,
    err: (document.getElementById("lgErr") || {}).textContent || "",
    sheetOpen: document.getElementById("loginSheet").classList.contains("open"),
  }));

  let published = null;
  if (afterReg.signedIn) {
    published = await p.evaluate(async () => {
      const r = await YRB_CLOUD.publishPost({
        type: "text", title: "验收帖 " + Date.now().toString(36), text: "自动化验收：新库发帖链路",
        tagFull: "学习", age: "小学", urg: 1, vis: 0, loc: "昆明"
      }, []);
      return r;
    });
  }

  // 刷新看帖是否可见
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4000);
  const feed = await p.evaluate(() => ({
    state: (window.YRB_CLOUD && YRB_CLOUD.postsState && YRB_CLOUD.postsState()) || null,
    cards: document.querySelectorAll("#feed article.card[data-id]").length,
    titles: [...document.querySelectorAll("#feed article.card .t, #feed article.card h3")].slice(0, 3).map(x => x.textContent.trim()),
    maint: !!document.getElementById("maintBar"),
  }));

  await p.screenshot({ path: "temp/sb-live-feed.png", clip: { x: 0, y: 0, width: 390, height: 760 } });

  // 清理：删掉刚发的帖 + 退出
  let cleaned = null;
  if (published && published.ok && published.cloudId) {
    cleaned = await p.evaluate(async (id) => {
      const r = await YRB_CLOUD.client.database.from("yb_posts").delete().eq("id", id);
      return !r.error;
    }, published.cloudId).catch(() => null);
  }

  console.log(JSON.stringify({ uname, agreed, boot, afterReg, published, feed, cleaned, errs }, null, 1));
  await b.close();
})();
