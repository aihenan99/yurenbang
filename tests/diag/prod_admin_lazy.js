/* 生产抽查：后台按需加载（2026-11-05 拆层）
   线上跑一遍，确认「拆分 + 按需」在真实站点成立：
   P1 首页有分享层（YRB_SHARE）与门面（YRB_CONSOLE），没有后台实现
   P2 assets/share.js、assets/admin.js 都能取到（后者只是没被加载）
   P3 打开「我的 → 分享」不触发 admin.js 下载，面板正常
   P4 收尾：零脚本错误
   用法：node tests/diag/prod_admin_lazy.js */
const URL = "https://xn--gmqq09al6z.cn/";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

let pass = 0, fail = 0;
function ck(n, ok, extra) { ok ? (pass++, console.log("✓ " + n + (extra ? "  [" + extra + "]" : ""))) : (fail++, console.log("✗ " + n + "  → " + (extra || ""))); }

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}");
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  let adminReqs = 0, shareReqs = 0;
  p.on("request", r => {
    const u = r.url();
    if (/assets\/admin\.js/.test(u) && !/probe=1/.test(u)) adminReqs++;   /* 自己那次连通性探测不算 */
    if (/assets\/share\.js/.test(u)) shareReqs++;
  });

  await p.goto(URL + "?lazycheck=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  const s1 = await p.evaluate(() => ({
    share: !!(window.YRB_SHARE && YRB_SHARE.openShare),
    facade: !!(window.YRB_CONSOLE && YRB_CONSOLE.openAdmin),
    admin: !!window.YRB_ADMIN_CONSOLE,
    lazy: !!(window.YRB_LAZY && YRB_LAZY.layers().indexOf("admin") >= 0),
    build: document.documentElement.dataset.yrbBuild || ""
  }));
  ck("首页有分享层与门面", s1.share && s1.facade, JSON.stringify(s1));
  ck("首页没有后台实现（按需）", s1.admin === false, "YRB_ADMIN_CONSOLE=" + s1.admin);
  ck("lazy 登记表里有 admin", s1.lazy, "构建号 " + s1.build);
  /* 分享层是首屏层，被拼进 bundle.js：所以不该有单独的 share.js 请求 */
  ck("分享层在首屏包里（无额外请求）", shareReqs === 0, "单独请求 " + shareReqs);

  /* admin.js 文件本身可下载（没被加载 ≠ 取不到） */
  const probe = await p.evaluate(async () => {
    const r = await fetch("assets/admin.js?probe=1", { method: "GET" });
    return { status: r.status, len: (await r.text()).length };
  });
  ck("assets/admin.js 线上可取（只是没加载）", probe.status === 200 && probe.len > 50000, JSON.stringify(probe));

  /* 打开分享面板：不下载后台 */
  const opened = await p.evaluate(async () => {
    try { document.querySelector("#meMenu #mmShare").click(); } catch (e) {}
    await new Promise(r => setTimeout(r, 600));
    if (!document.querySelector("#shareLayer.open")) { try { YRB_CONSOLE.openShare(); } catch (e) {} }
    await new Promise(r => setTimeout(r, 600));
    return { open: !!document.querySelector("#shareLayer.open"), qr: !!document.querySelector("#slQr") };
  });
  ck("分享面板能打开（二维码在位）", opened.open && opened.qr, JSON.stringify(opened));
  ck("只开分享不下载后台", adminReqs === 0, "admin 请求数 " + adminReqs);
  ck("零脚本错误", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 180));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
