/* 线上验收：账号工具（改密码入口 / 管理员入口不误显示）
   用法：node tests/diag/probe_account_tools.js
   说明：会注册一个临时账号「验收XXXX」，改密后用它重登验证，最后把档案行删掉。
         auth.users 里的测试账号无法从前端删除（那需要管理员权限），这是已知残留。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "https://xn--gmqq09al6z.cn/";

(async () => {
  const stamp = Date.now().toString(36).slice(-4);
  const user = "验收" + stamp;
  const pwd1 = "Test12345";
  const pwd2 = "Test67890";

  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 140)));
  const out = { user };

  const goMe = async () => {
    await p.evaluate(() => { try { switchTab("me"); } catch (e) {} });
    await p.waitForTimeout(600);
  };

  try {
  await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForFunction(() => { const a = document.getElementById("app"); return a && a.offsetHeight > 100; }, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);

  /* 1) 未登录时不应出现管理入口 */
  out.adminEntryWhenGuest = await p.evaluate(() => !!document.getElementById("mmAdmin"));

  /* 2) 注册（直接用应用内的登录面板） */
  await p.evaluate(() => { try { YRB_CLOUD.openLogin(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.fill("#lgAcct", user);
  await p.fill("#lgPwd2", pwd1);
  await p.evaluate(() => document.getElementById("lgToReg").click());   /* 切到注册模式 */
  await p.waitForTimeout(300);
  await p.evaluate(() => {                                             /* 必须先勾选同意 */
    const ck = document.getElementById("lgCk");
    if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
  });
  await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById("lgPwdSubmit").click());
  await p.waitForTimeout(4000);
  out.signedIn = await p.evaluate(() => !!(window.YRB_CLOUD && YRB_CLOUD.signedIn()));
  out.loginErr = await p.evaluate(() => (document.getElementById("lgErr") || {}).textContent || "");
  console.log("[步骤2] 注册结果:", JSON.stringify({ signedIn: out.signedIn, err: out.loginErr }));

  /* 3) 普通账号：管理入口必须仍然不可见（异步问库之后） */
  await goMe();
  await p.waitForTimeout(2500);
  out.adminEntryWhenUser = await p.evaluate(() => !!document.getElementById("mmAdmin"));

  /* 4) 账号弹窗里应有「修改登录密码」 */
  await p.evaluate(() => document.getElementById("clAcct").click());
  await p.waitForTimeout(500);
  out.hasPwdEntry = await p.evaluate(() => !!document.getElementById("clPwd"));
  await p.evaluate(() => document.getElementById("clPwd").click());
  await p.waitForTimeout(400);
  out.pwdFormFields = await p.evaluate(() => ["cpOld", "cpNew", "cpNew2", "cpOk"].every(id => !!document.getElementById(id)));

  /* 5) 旧密码输错 → 应报错不通过 */
  await p.fill("#cpOld", "WrongPass1");
  await p.fill("#cpNew", pwd2);
  await p.fill("#cpNew2", pwd2);
  await p.evaluate(() => document.getElementById("cpOk").click());
  await p.waitForTimeout(2500);
  out.wrongOldMsg = await p.evaluate(() => (document.getElementById("cpErr") || {}).textContent || "");

  /* 6) 正确旧密码 → 改密成功 */
  await p.fill("#cpOld", pwd1);
  await p.fill("#cpNew", pwd2);
  await p.fill("#cpNew2", pwd2);
  await p.evaluate(() => document.getElementById("cpOk").click());
  await p.waitForTimeout(4000);
  out.afterChange = await p.evaluate(() => ({
    err: (document.getElementById("cpErr") || {}).textContent || "",
    modalOpen: !!(document.getElementById("modal") || {}).classList &&
      document.getElementById("modal").classList.contains("open"),
  }));

  /* 7) 退出，用新密码重登 */
  await p.evaluate(async () => { try { await YRB_CLOUD.signOut(); } catch (e) {} });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { YRB_CLOUD.openLogin(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.fill("#lgAcct", user);
  await p.fill("#lgPwd2", pwd2);
  await p.evaluate(() => {
    const ck = document.getElementById("lgCk");
    if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
  });
  await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById("lgPwdSubmit").click());
  await p.waitForTimeout(4500);
  out.reloginWithNewPwd = await p.evaluate(() => !!(window.YRB_CLOUD && YRB_CLOUD.signedIn()));

  /* 8) 清理档案行（帖子没发，无需清理） */
  out.cleanup = await p.evaluate(async () => {
    try {
      const c = YRB_CLOUD.client;
      const s = await c.auth.getSession();
      const uid = s && s.data && s.data.user && s.data.user.id;
      if (!uid) return "no-session";
      const r = await c.database.from("yb_profiles").delete().eq("user_id", uid);
      return r && r.error ? ("err:" + r.error.message) : "ok";
    } catch (e) { return "err:" + e.message; }
  });

  } catch (e) {
    out.crash = String(e && e.message || e).slice(0, 300);
  }
  out.pageErrors = errs;
  out.finalState = await p.evaluate(() => ({
    signedIn: !!(window.YRB_CLOUD && YRB_CLOUD.signedIn && YRB_CLOUD.signedIn()),
    tab: (document.querySelector(".tab.on") || {}).textContent || "",
    modalIds: ["clPwd","cpOld","mmAdmin"].filter(id => !!document.getElementById(id)),
    sheet: (document.getElementById("loginSheet") || {}).className || "",
  })).catch(() => null);
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
