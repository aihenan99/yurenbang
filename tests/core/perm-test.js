/* 权限边界回归（2026-11-05 用户定稿规则）
   规则：任何用户可以「浏览、分享」；只有注册用户可以「发布求助 / 帮忙回应 / 收藏」。
   本测试全部以**未登录**身份跑，断言：
   P1 未登录能打开首页并看到求助卡片（浏览免费）
   P2 未登录点卡片 ⭐ → 不产生收藏、不写本机存档，并拉起登录
   P3 未登录点「＋」发布 → 拉起登录，发布面板不打开
   P4 分享链接是「这一条」（带 ?p=<id>），不是整站首页
   P5 未登录点「我的收藏」→ 提示登录，不打开空列表
   P6 浏览历史是本机数据，未登录仍可打开
   P7 全程无脚本错误
   运行前：python -m http.server 8793 --bind 127.0.0.1（项目根，测 /deploy-cn/ 产物） */
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8793/deploy-cn/";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

const POST = {
  id: 990101, user: "测试家长", tag: "求助", tagFull: "求助", type: "img",
  title: "权限边界", text: "未登录应能读，不能收藏", likes: 0, helps: 0,
  comments: [], ts: Date.now(), media: [],
};

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}");
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  await p.goto(BASE + "?perm=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);

  /* 造一条帖子，模拟「未登录也能看到内容」 */
  await p.evaluate((post) => {
    S.posts = [post];
    renderFeed();
  }, POST);
  await p.waitForTimeout(300);

  const view = await p.evaluate(() => ({
    cards: document.querySelectorAll("#feed .card").length,
    text: (document.querySelector("#feed .card .p-text") || {}).textContent || "",
  }));
  ck("P1 未登录可浏览求助内容", view.cards === 1 && view.text.indexOf("未登录应能读") >= 0,
    JSON.stringify(view));

  /* P2 收藏：点 ⭐ 后不得生效 */
  const favBefore = await p.evaluate(() => ({
    faved: !!(S.posts[0] || {}).faved,
    store: localStorage.getItem("yrb_state_v1") || "",
  }));
  await p.click('#feed .card [data-act="fav"]');
  await p.waitForTimeout(700);
  const favAfter = await p.evaluate(() => ({
    on: !!document.querySelector('#feed .card [data-act="fav"].on'),
    faved: !!(S.posts[0] || {}).faved,
    login: !!document.querySelector("#loginMask.open,#loginSheet.open"),
    store: (localStorage.getItem("yrb_state_v1") || "").indexOf("990101") >= 0,
  }));
  ck("P2 未登录点收藏被拦（不生效 + 不写存档 + 拉起登录）",
    !favBefore.faved && !favAfter.on && !favAfter.faved && !favAfter.store && favAfter.login,
    JSON.stringify(favAfter));

  /* 先关掉登录面板，避免挡住后面的点击 */
  await p.evaluate(() => {
    try { YRB_CLOUD && YRB_CLOUD.closeLogin && YRB_CLOUD.closeLogin(); } catch (e) {}
    ["loginMask", "loginSheet"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.remove("open", "show");
    });
  });
  await p.waitForTimeout(200);

  /* P3 发布入口 */
  await p.click("#fab");
  await p.waitForTimeout(700);
  const pub = await p.evaluate(() => ({
    sheet: !!document.querySelector("#publishSheet.open"),
    login: !!document.querySelector("#loginMask.open,#loginSheet.open"),
  }));
  ck("P3 未登录点发布被拦", !pub.sheet && pub.login, JSON.stringify(pub));
  await p.evaluate(() => {
    try { YRB_CLOUD && YRB_CLOUD.closeLogin && YRB_CLOUD.closeLogin(); } catch (e) {}
    ["loginMask", "loginSheet"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.remove("open", "show");
    });
  });

  /* P4 分享链接 = 这一条 */
  const link = await p.evaluate(() => (window.YRB_POSTLINK ? YRB_POSTLINK(990101) : ""));
  ck("P4 分享链接指向单条求助（?p=）", /\?p=990101$/.test(link), link);

  /* P5 未登录点「我的收藏」 */
  const p5 = await p.evaluate(() => {
    const b = [...document.querySelectorAll("#meMenu [data-act='memu']")]
      .find(x => (x.dataset.t || "").indexOf("我的收藏") >= 0);
    if (!b) return { found: false };
    b.click();
    return {
      found: true,
      sub: !!document.querySelector("#subpage.open"),
    };
  });
  await p.waitForTimeout(600);
  const p5b = await p.evaluate(() => ({
    sub: !!document.querySelector("#subpage.open"),
    login: !!document.querySelector("#loginMask.open,#loginSheet.open"),
  }));
  ck("P5 未登录点我的收藏 → 引导登录而不是空列表",
    p5.found && !p5b.sub && p5b.login, JSON.stringify({ p5, p5b }));

  await p.evaluate(() => {
    try { YRB_CLOUD && YRB_CLOUD.closeLogin && YRB_CLOUD.closeLogin(); } catch (e) {}
    ["loginMask", "loginSheet"].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.remove("open", "show");
    });
  });
  await p.waitForTimeout(200);

  /* P6 浏览历史不受限 */
  const p6 = await p.evaluate(() => {
    const b = [...document.querySelectorAll("#meMenu [data-act='memu']")]
      .find(x => (x.dataset.t || "").indexOf("浏览历史") >= 0);
    if (!b) return false;
    b.click();
    return !!document.querySelector("#subpage.open");
  });
  await p.waitForTimeout(400);
  ck("P6 未登录仍可看本机浏览历史", !!p6, String(p6));

  ck("P7 全程无脚本错误", errs.length === 0, JSON.stringify(errs.slice(0, 3)));

  console.log("\n" + (fail ? "✗ " : "✓ ") + "权限边界：" + pass + "/" + (pass + fail));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
