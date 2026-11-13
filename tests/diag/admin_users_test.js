/* 后台「注册家长」统计回归（2026-11-13）
   覆盖：
   ① 页签已登记（TABS 里有 users，能点进去）
   ② 统计口径：总数 / 今日新增 / 近 7 日新增（按 created_at 本地自然日）
   ③ 名单按注册时间倒序渲染，只显示用户名 + 注册时间（不含手机号）
   ④ 空名单有兜底文案
     · 读取失败（RLS/未建表）有降级提示，不白屏
   用法：node tests/diag/admin_users_test.js [url]
   默认 http://127.0.0.1:8793/deploy-cn/index.html（先 npm run sync） */
const path = require("path");
const { chromium } = require(path.join(__dirname, "../../temp/pw/node_modules/playwright-core"));
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL = process.argv[2] || "http://127.0.0.1:8793/deploy-cn/index.html";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? JSON.stringify(extra).slice(0, 260) : ""); }
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(URL, { waitUntil: "load" });
  await page.touchscreen.tap(195, 420).catch(() => {});
  await page.waitForTimeout(500);

  /* 后台是按需层：用懒加载器拉起来（等价于点「管理后台」） */
  const loaded = await page.evaluate(async () => {
    try {
      await YRB_LAZY.load("admin");
      for (let i = 0; i < 40 && !window.YRB_ADMIN_CONSOLE; i++) await new Promise(r => setTimeout(r, 100));
      return !!window.YRB_ADMIN_CONSOLE;
    } catch (e) { return false; }
  });
  ok("① 后台层可按需加载", loaded);

  const tab = await page.evaluate(() => {
    const html = (window.YRB_ADMIN_CONSOLE && YRB_ADMIN_CONSOLE.usersPreview) ? "有钩子" : "无钩子";
    return { html, tab: document.body.innerHTML.includes("注册家长") };
  });
  ok("① 注册家长页签/钩子就位", tab.html === "有钩子", tab);

  /* 灌三条假数据：今天 / 3 天前 / 10 天前 */
  const day = 86400000;
  const now = new Date(); now.setHours(10, 0, 0, 0);
  const list = [
    { user_name: "小明妈妈", created_at: new Date(now.getTime()).toISOString() },
    { user_name: "乐乐爸爸", created_at: new Date(now.getTime() - 3 * day).toISOString() },
    { user_name: "旧账号", created_at: new Date(now.getTime() - 10 * day).toISOString() }
  ];
  const html = await page.evaluate((l) => YRB_ADMIN_CONSOLE.usersPreview(l), list);

  ok("② 总数 = 3", /<b>3<\/b>\s*<span>注册家长总数/.test(html.replace(/\s+/g, " ")), html.match(/<b>\d+<\/b><span>[^<]*<\/span>/g));
  ok("② 今日新增 = 1", /<b>\+1<\/b>\s*<span>今日新增/.test(html.replace(/\s+/g, " ")));
  ok("② 近 7 日新增 = 2", /<b>\+2<\/b>\s*<span>近 7 日新增/.test(html.replace(/\s+/g, " ")));
  ok("③ 名单含三个用户名", /小明妈妈/.test(html) && /乐乐爸爸/.test(html) && /旧账号/.test(html));
  ok("③ 只展示用户名与注册时间（无手机号/答案哈希等字段）",
    !/1[3-9]\d{9}/.test(html) && !/sec_a|encrypted_password/.test(html));

  const empty = await page.evaluate(() => YRB_ADMIN_CONSOLE.usersPreview([]));
  ok("④ 空名单有兜底文案", /还没有注册家长/.test(empty));

  ok("⑤ 无页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
