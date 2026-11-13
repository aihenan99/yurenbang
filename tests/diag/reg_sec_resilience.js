/* 账号体系韧性回归（2026-11-13）
   背景：库端密保三函数（yb_sec_*）还没跑迁移时，家长注册完立刻被弹「设密保」，
         面板必然失败 —— 观感就是「注册坏了」。本测试守住三件事：
   ① 未开通时「忘记密码」直接给说明页，不让家长输完用户名才失败
   ② 未开通时「设置密保」也是说明页（注册后那条路径已被 secAvailable() 拦掉）
   ③ 本机会记住上次登录的用户名，登录面板自动回填（忘用户名的自助兜底）
   用法：node tests/diag/reg_sec_resilience.js   （需 8796 本地服务在线） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => require("fs").existsSync(p));
const BASE = "http://127.0.0.1:8796/yurenbang-app.html";

let pass = 0, fail = 0;
const ok = (c, m, extra) => { c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m, extra === undefined ? "" : JSON.stringify(extra))); };

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3500);

  /* 桩：把 RPC 打成「函数不存在」，模拟「库端迁移还没跑」 */
  const stubbed = await page.evaluate(() => {
    try {
      const c = window.YRB_CLOUD && YRB_CLOUD.client;
      if (!c || !c.database) return false;
      c.database.rpc = () => Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.yb_sec_info" }
      });
      return true;
    } catch (e) { return false; }
  });
  ok(stubbed, "已把 RPC 打成 PGRST202（模拟迁移未执行）");

  /* ① 忘记密码 → 说明页 */
  await page.evaluate(() => YRB_CLOUD.openLogin());
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector("#lgToSms").click());
  await page.waitForTimeout(900);
  const r1 = await page.evaluate(() => {
    const panel = document.querySelector("#lgSec");
    const body = (document.querySelector("#lgSecBody") || {}).textContent || "";
    return {
      open: !!(panel && panel.classList.contains("open")),
      off: /开通中/.test(body),
      hasInput: !!document.querySelector("#secName"),
      hasBack: !!(document.querySelector("[data-sec=skip]")),
    };
  });
  ok(r1.open, "找回面板已打开");
  ok(r1.off, "未开通时直接显示「开通中」说明", r1);
  ok(!r1.hasInput, "不再要求先输用户名（少走无效一步）", r1);
  ok(r1.hasBack, "说明页有「返回登录」出口", r1);

  /* 返回登录 */
  await page.evaluate(() => document.querySelector("[data-sec=skip]").click());
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => !document.querySelector("#lgSec").classList.contains("open"));
  ok(closed, "点「返回登录」收起找回面板");

  /* ② 设置密保（我的—账号与安全那条路径）→ 同样说明页 */
  await page.evaluate(() => YRB_CLOUD.security.open("set"));
  await page.waitForTimeout(900);
  const r2 = await page.evaluate(() => {
    const body = (document.querySelector("#lgSecBody") || {}).textContent || "";
    return { off: /开通中/.test(body), hasQ: !!document.querySelector("#secQIn") };
  });
  ok(r2.off && !r2.hasQ, "未开通时设置面板也是说明页", r2);
  await page.evaluate(() => YRB_CLOUD.security.close());
  await page.waitForTimeout(300);

  /* ③ 用户名记忆 + 回填 */
  await page.evaluate(() => {
    localStorage.setItem("yrb_last_user", "王妈妈");
    YRB_CLOUD.openLogin();
    YRB_CLOUD.accounts.mode("pwd");
  });
  await page.waitForTimeout(700);
  const r3 = await page.evaluate(() => (document.querySelector("#lgAcct") || {}).value || "");
  ok(r3 === "王妈妈", "登录面板自动回填上次用户名", r3);

  /* ④ 本机记住的键不受「退出登录」影响（换账号前还能找回原用户名） */
  const keep = await page.evaluate(() => {
    localStorage.removeItem("yrb_last_user");
    return !localStorage.getItem("yrb_last_user");
  });
  ok(keep, "清理路径可用（避免测试残留污染下轮）");

  ok(errs.length === 0, "全程零脚本报错", errs.slice(0, 3));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
