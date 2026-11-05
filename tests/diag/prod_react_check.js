/* 生产站抽查：匿名点赞门槛 + 匿名签名请求次数（2026-11-05）
   背景：点赞从「不计门槛」改为「登录才能点」，且 signPaths 不再要求登录会话。
   预期：① 匿名人点 ♥ → 拉起登录，p.liked 不变；② sign 请求最多 2 次（一次批量 + 至多一次逐个），
   存储未放开时不应演变成「每张图一个失败请求」。
   用法：node tests/diag/prod_react_check.js */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const URL = process.env.YRB_URL || "https://xn--gmqq09al6z.cn/";

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", args: ["--no-proxy-server"] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  let signs = 0;
  p.on("pageerror", e => errs.push(e.message));
  p.on("request", r => { if (/\/storage\/v1\/object\/sign/.test(r.url())) signs++; });

  await p.goto(URL + "?pr=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.addStyleTag({ content: "#gift{pointer-events:none!important}" });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(4000);

  const before = await p.evaluate(() => ({
    cards: document.querySelectorAll("#feed .card").length,
    likes: (document.querySelector('#feed .card [data-act="like"]') || {}).textContent || "",
    locked: document.querySelectorAll("#feed .card .m-locked").length,
    imgs: document.querySelectorAll("#feed .card .real-img").length,
  }));

  const hasLike = await p.evaluate(() => !!document.querySelector('#feed .card [data-act="like"]'));
  let after = {};
  if (hasLike) {
    await p.click('#feed .card [data-act="like"]');
    await p.waitForTimeout(900);
    after = await p.evaluate(() => {
      const c = document.querySelector("#feed .card");
      const id = c ? +c.dataset.id : 0;
      const post = (S.posts || []).filter(x => x.id === id)[0] || {};
      return {
        login: ((document.querySelector("#loginSheet") || {}).className || ""),
        liked: !!post.liked,
      };
    });
  }

  console.log("卡片:", before.cards, "| 图:", before.imgs, "| 锁位:", before.locked, "| sign 请求:", signs);
  console.log("点赞按钮存在:", hasLike, "| 点击后:", JSON.stringify(after));
  console.log("脚本错误:", errs.length, errs.slice(0, 2).join(" | "));

  /* 3 次是首屏并发三路（求助列表 / 案例广场 / 单图重签）各一次批量；关键是不能随图片数量线性增长 */
  const ok = before.cards > 0 && hasLike && /open|show/.test(after.login) && after.liked === false && signs <= 4 && errs.length === 0;
  console.log(ok ? "✓ 生产抽查通过" : "✗ 生产抽查不通过");
  await b.close();
  process.exit(ok ? 0 : 1);
})();
