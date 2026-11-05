/* 后台按需加载回归（2026-11-05 拆分层）
   背景：admin.js 原本和分享层长在一起（78.8KB），全员替站长付首屏成本。
   拆成 share.js（首屏）+ admin.js（按需）之后，最容易悄悄坏掉的是这几件事：
   A1 首屏没有后台实现，但有分享层（YRB_SHARE）与门面（YRB_CONSOLE）
   A2 打开分享面板不加载后台（绝大多数人只用到这一步）
   A3 点「进入管理后台」才下载 admin.js，下载完能正常打开
   A4 连点两次只发一次请求（lazy.js 去重）
   A5 后台打开后身份判定口径仍是 YRB_CONSOLE.isAdmin()（测试打桩有效）
   A6 全程无脚本错误
   运行前：python -m http.server 8793 --bind 127.0.0.1（项目根，测 /deploy-cn/ 产物） */
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8793/deploy-cn/";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + (extra || "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: require("../helpers/pw.js").chromePath() });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}");
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  /* 数一下 admin.js 被请求了几次 */
  let adminReqs = 0;
  p.on("request", r => { if (/\/assets\/admin\.js/.test(r.url())) adminReqs++; });

  await p.goto(BASE + "?adminlazy=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);

  /* ---------- A1 首屏构成 ---------- */
  const a1 = await p.evaluate(() => ({
    share: !!(window.YRB_SHARE && typeof YRB_SHARE.openShare === "function"),
    console: !!(window.YRB_CONSOLE && typeof YRB_CONSOLE.openAdmin === "function"),
    admin: !!window.YRB_ADMIN_CONSOLE,
    identity: !!(window.YRB_SHARE && typeof YRB_SHARE.isAdmin === "function")
  }));
  ck("首屏有分享层（YRB_SHARE.openShare）", a1.share, JSON.stringify(a1));
  ck("首屏有 YRB_CONSOLE 门面（openAdmin 可用）", a1.console, JSON.stringify(a1));
  ck("首屏没有后台实现（YRB_ADMIN_CONSOLE 缺席）", a1.admin === false, "admin=" + a1.admin);
  ck("管理员身份判定在分享层", a1.identity, JSON.stringify(a1));

  /* ---------- A2 打开分享面板 → 不加载后台 ---------- */
  await p.evaluate(() => { try { document.querySelector("#meMenu #mmShare").click(); } catch (e) {} });
  if (!(await p.evaluate(() => !!document.querySelector("#shareLayer.open")))) {
    await p.evaluate(() => { try { YRB_CONSOLE.openShare(); } catch (e) {} });
  }
  await p.waitForTimeout(400);
  const a2 = await p.evaluate(() => ({
    open: !!document.querySelector("#shareLayer.open"),
    hasAdminBtn: !!document.querySelector("#slAdmin"),
    hasQr: !!document.querySelector("#slQr")
  }));
  ck("分享面板能打开（二维码 + 后台入口在位）", a2.open && a2.hasQr && a2.hasAdminBtn, JSON.stringify(a2));
  ck("只打开分享面板不会下载后台", adminReqs === 0, "请求数 " + adminReqs);

  /* ---------- A3 点后台入口 → 下载并打开 ---------- */
  /* 模拟「管理员账号已登录」：用公开的 ADMIN_IDS 主判据（真连库时 is_admin() 会走 RPC）。
     这样身份判定走的是真实代码路径，不需要打桩内部函数。 */
  await p.evaluate((adminId) => {
    window.YRB_CLOUD = Object.assign({}, window.YRB_CLOUD, {
      signedIn: () => true,
      who: () => ({ id: adminId, name: "管理员" })
    });
    window.YRB_ADMINGUARD = { needed: () => true, unlocked: () => true, prompt() {} };
  }, "2110319594408247296");
  const t0 = Date.now();
  await p.evaluate(() => { document.querySelector("#shareLayer #slAdmin").click(); });
  await p.waitForFunction(() => !!window.YRB_ADMIN_CONSOLE, null, { timeout: 15000 }).catch(() => {});
  const loadMs = Date.now() - t0;
  await p.waitForTimeout(800);
  const a3 = await p.evaluate(() => ({
    loaded: !!(window.YRB_ADMIN_CONSOLE && typeof YRB_ADMIN_CONSOLE.open === "function"),
    open: !!document.querySelector("#adLayer.open"),
    /* 未登录时后台自己渲染的是「请先登录管理员账号」提示，那也是渲染成功了 */
    body: (document.querySelector("#adBody") || {}).innerHTML || "",
    canReload: !!(window.YRB_CONSOLE.reload && typeof window.YRB_CONSOLE.reload === "function")
  }));
  ck("点「进入管理后台」后 admin.js 就位", a3.loaded, "耗时 " + loadMs + "ms");
  ck("后台面板打开并渲染出内容", a3.open && a3.body.length > 40, JSON.stringify(a3).slice(0, 200));
  ck("门面 reload 已转接到后台", a3.canReload, JSON.stringify(a3));

  /* ---------- A4 连点去重 ---------- */
  await p.evaluate(() => {
    document.querySelector("#adLayer").classList.remove("open");
    window.YRB_CONSOLE.openAdmin();
    window.YRB_CONSOLE.openAdmin();
    window.YRB_CONSOLE.openAdmin();
  });
  await p.waitForTimeout(600);
  ck("连点三次仍只有一次下载", adminReqs === 1, "请求数 " + adminReqs);

  /* ---------- A5 身份口径 ---------- */
  const a5 = await p.evaluate(async (adminId) => {
    const out = {};
    /* ① 换成普通家长账号：入口应收起、分享层的后台区块应隐藏 */
    window.YRB_CLOUD = Object.assign({}, window.YRB_CLOUD, {
      signedIn: () => true, who: () => ({ id: "parent-999", name: "家长" })
    });
    YRB_SHARE.resetAdminProbe();
    await YRB_SHARE.probeAdmin(true);
    YRB_SHARE.syncEntry();
    out.menuForParent = !!document.querySelector("#mmAdmin");
    out.boxForParent = (document.querySelector("#slAdminBox") || {}).style.display;
    out.flagForParent = YRB_CONSOLE.isAdmin();
    /* ② 换回管理员：入口应回来 */
    window.YRB_CLOUD = Object.assign({}, window.YRB_CLOUD, {
      signedIn: () => true, who: () => ({ id: adminId, name: "管理员" })
    });
    YRB_SHARE.resetAdminProbe();
    await YRB_SHARE.probeAdmin(true);
    YRB_SHARE.syncEntry();
    out.flagForAdmin = YRB_CONSOLE.isAdmin();
    /* 门面是运行时视图：改分享层的判定，门面立刻跟着变 */
    const keep = YRB_SHARE.isAdmin;
    YRB_SHARE.isAdmin = () => true;
    out.facadeFollows = YRB_CONSOLE.isAdmin() === true;
    YRB_SHARE.isAdmin = keep;
    return out;
  }, "2110319594408247296");
  ck("普通家长：门面 isAdmin=false 且分享层后台区块隐藏",
    a5.flagForParent === false && a5.boxForParent === "none", JSON.stringify(a5));
  ck("管理员：门面 isAdmin=true", a5.flagForAdmin === true, JSON.stringify(a5));
  ck("门面 isAdmin 跟着分享层走（不多存一份判断）", a5.facadeFollows, JSON.stringify(a5));

  /* ---------- A6 无脚本错误 ---------- */
  ck("全程无 pageerror", errs.length === 0, errs.slice(0, 3).join(" | ").slice(0, 240));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
