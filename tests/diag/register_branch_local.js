/* 本地新版代码 + 生产真实库：注册分支端到端验收（2026-11-13）
   为什么需要它：8796 静态服务没有 /sbapi 同源代理，本地注册必然失败。
   做法：拦截本地页面所有 /sbapi 请求，改写到生产站同名路径，并把
        Origin / Referer 改成生产域名（/sbapi 有同源校验），UA 保持移动端。
   验证点（对应 cloud.js 本轮改动）：
     ① 注册成功后不再弹「设密保」（库端迁移未跑 → secAvailable() 返回 false）
     ② 注册后登录面板收起、signedIn() 为真、档案写进 yb_profiles
     ③ 刷新后同一账号密码可登录
     ④ 本机记住用户名，下次打开登录面板自动回填
   用法：node tests/diag/register_branch_local.js   （需 8796 在线）
   会在生产库留下一个「验收XXXX」账号。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => require("fs").existsSync(p));
const LOCAL = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";
const PROD = "https://xn--gmqq09al6z.cn";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

let pass = 0, fail = 0;
const ok = (c, m, extra) => { c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m, extra === undefined ? "" : JSON.stringify(extra))); };

(async () => {
  const stamp = Date.now().toString(36).slice(-4);
  const user = "验收" + stamp, pwd = "Test" + stamp + "a";

  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", userAgent: UA,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));

  /* /sbapi 转发生成站（同源校验要求 Origin/Referer 一致）。
     注意：route.continue({url}) 跨域改写会静默失败（请求永不结束）——必须 fetch + fulfill。 */
  await page.route("**/sbapi/**", async route => {
    const url = route.request().url().replace(/^https?:\/\/[^/]+/, PROD);
    const h = Object.assign({}, route.request().headers(), {
      origin: PROD, referer: PROD + "/", "user-agent": UA, apikey: "sb_publishable_ebjDgVECIpbwM2oGW_4pEg_tAAi0wqi",
    });
    delete h.host; delete h["content-length"];
    try { const r = await route.fetch({ url, headers: h }); await route.fulfill({ response: r }); }
    catch (e) { await route.abort().catch(() => {}); }
  });

  await page.goto(LOCAL, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3500);

  await page.evaluate(() => YRB_CLOUD.openLogin());
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector("#lgTabPwd").click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector("#lgGoReg").click());
  await page.waitForTimeout(300);
  ok(await page.$eval("#lgPwdSubmit", el => /注册并登录/.test(el.textContent)), "切到注册模式");

  await page.fill("#lgAcct", user);
  await page.fill("#lgPwd2", pwd);
  await page.evaluate(() => { const c = document.querySelector("#lgCk"); if (c && !c.classList.contains("on")) c.click(); });
  await page.evaluate(() => document.querySelector("#lgPwdSubmit").click());
  await page.waitForTimeout(6000);

  const r1 = await page.evaluate(() => ({
    err: (document.querySelector("#lgErr") || {}).textContent || "",
    signed: !!(window.YRB_CLOUD && YRB_CLOUD.signedIn()),
    sheetOpen: !!document.querySelector("#loginSheet.open"),
    secOpen: !!document.querySelector("#lgSec.open"),
    secBody: (document.querySelector("#lgSecBody") || {}).textContent || "",
    lastUser: localStorage.getItem("yrb_last_user") || "",
  }));
  ok(r1.signed, "注册成功并自动登录", r1);
  ok(!r1.secOpen, "未开通密保时不弹设置面板（不再一注册就撞失败）", r1);
  ok(!/开通中/.test(r1.secBody) || !r1.secOpen, "没有把「开通中」怼到新注册家长脸上", r1);
  ok(r1.lastUser === user, "本机记住了用户名", r1);
  ok(!r1.sheetOpen, "登录面板已收起", r1);

  /* 档案是否写进 yb_profiles（走生产只读查询） */
  const prof = await page.evaluate(async (u) => {
    try {
      const r = await YRB_CLOUD.client.database.from("yb_profiles").select("user_name").eq("user_name", u.toLowerCase());
      return (r && r.data && r.data.length) || 0;
    } catch (e) { return -1; }
  }, user);
  ok(prof === 1, "yb_profiles 已写入用户名", prof);

  /* 刷新后密码登录 */
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => { try { YRB_CLOUD.signOut(); } catch (e) {} YRB_CLOUD.openLogin(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector("#lgTabPwd").click());
  await page.waitForTimeout(500);
  const prefill = await page.$eval("#lgAcct", el => el.value);
  ok(prefill === user, "登录面板自动回填上次用户名（忘用户名兜底）", prefill);
  await page.fill("#lgPwd2", pwd);
  await page.evaluate(() => { const c = document.querySelector("#lgCk"); if (c && !c.classList.contains("on")) c.click(); });
  await page.evaluate(() => document.querySelector("#lgPwdSubmit").click());
  await page.waitForTimeout(5000);
  ok(await page.evaluate(() => !!(window.YRB_CLOUD && YRB_CLOUD.signedIn())), "刷新后密码登录成功");
  ok(errs.length === 0, "全程零脚本报错", errs.slice(0, 3));

  console.log(`\n账号：${user} / ${pwd}\n结果：${pass} 通过 / ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
