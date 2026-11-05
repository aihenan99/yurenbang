/* 线上验收：注册入口与注册全流程（2026-11-02）
   断言：1) 登录面板有「注册新账号」大按钮（ghost 款，登录按钮下方）
         2) 点它 → 主按钮变「注册并登录」
         3) 填用户名+密码+勾协议 → 注册成功并自动登录（信息流可发布态）
         4) 刷新后再用同一账号密码登录成功
   会在库里留下一个「验收XXXX」测试账号（清理方式同 2026-11-01 清理 SQL）。
   用法：node tests/diag/probe_register_flow.js */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "https://xn--gmqq09al6z.cn/";

(async () => {
  const stamp = Date.now().toString(36).slice(-4);
  const user = "验收" + stamp;
  const pwd = "Test" + stamp + "a";

  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3500);

  /* 打开登录面板：游客点「帮 忙」类入口会弹；这里直接用 DOM 路径（loginMask 会拦合成点击） */
  const opened = await page.evaluate(() => {
    try {
      if (window.YRB_CLOUD && YRB_CLOUD.openLogin) { YRB_CLOUD.openLogin(); return true; }
    } catch (e) {}
    const m = document.querySelector("#loginMask"); if (m) m.click();
    return !!document.querySelector("#loginSheet.open, #loginSheet .open");
  });
  await page.waitForTimeout(900);
  console.log(opened ? "✅ 登录面板已打开" : "❌ 登录面板没打开");

  /* 切到「用户名登录」页签 */
  await page.evaluate(() => { const t = document.querySelector("#lgTabPwd"); if (t) t.click(); });
  await page.waitForTimeout(400);

  /* ① 大按钮在位 */
  const hasGoReg = await page.$eval("#lgGoReg", el => !!(el.offsetParent || el.getClientRects().length) && /注册新账号/.test(el.textContent)).catch(() => false);
  console.log(hasGoReg ? "✅ 「注册新账号」大按钮可见" : "❌ 没找到「注册新账号」大按钮");

  /* ② 点它切注册模式 */
  await page.evaluate(() => { const g = document.querySelector("#lgGoReg"); if (g) g.click(); });
  await page.waitForTimeout(300);
  const regMode = await page.$eval("#lgPwdSubmit", el => /注册并登录/.test(el.textContent));
  const goRegText = await page.$eval("#lgGoReg", el => el.textContent.trim());
  console.log(regMode && goRegText === "已有账号？去登录" ? "✅ 点击后切换到注册模式" : "❌ 注册模式切换失败：" + goRegText);

  /* ③ 填表注册 */
  await page.fill("#lgAcct", user);
  await page.fill("#lgPwd2", pwd);
  await page.evaluate(() => { const c = document.querySelector("#lgCk"); if (c && !c.classList.contains("on")) c.click(); });
  await page.evaluate(() => { const s = document.querySelector("#lgPwdSubmit"); if (s) s.click(); });
  await page.waitForTimeout(4000);
  const err = await page.$eval("#lgErr", el => el.textContent.trim()).catch(() => "");
  const signedIn = await page.evaluate(() => !!(window.YRB_CLOUD && YRB_CLOUD.signedIn && YRB_CLOUD.signedIn()));
  console.log(err ? "提示：" + err : "");
  console.log(signedIn ? "✅ 注册成功并自动登录（" + user + "）" : "❌ 注册后未登录态");

  /* ④ 刷新后用同一账号重新登录 */
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    try { if (window.YRB_CLOUD && YRB_CLOUD.signOut) YRB_CLOUD.signOut(); } catch (e) {}
    if (window.YRB_CLOUD && YRB_CLOUD.openLogin) YRB_CLOUD.openLogin();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const t = document.querySelector("#lgTabPwd"); if (t) t.click(); });
  await page.waitForTimeout(300);
  await page.fill("#lgAcct", user);
  await page.fill("#lgPwd2", pwd);
  await page.evaluate(() => { const c = document.querySelector("#lgCk"); if (c && !c.classList.contains("on")) c.click(); });
  await page.evaluate(() => { const s = document.querySelector("#lgPwdSubmit"); if (s) s.click(); });
  await page.waitForTimeout(4000);
  const err2 = await page.$eval("#lgErr", el => el.textContent.trim()).catch(() => "");
  const signedIn2 = await page.evaluate(() => !!(window.YRB_CLOUD && YRB_CLOUD.signedIn && YRB_CLOUD.signedIn()));
  console.log(err2 ? "提示：" + err2 : "");
  console.log(signedIn2 ? "✅ 同一账号密码重新登录成功" : "❌ 重新登录失败");

  console.log(errs.length ? "❌ 脚本报错：" + errs.join(" | ") : "✅ 零脚本报错");
  await b.close();
  process.exit(hasGoReg && regMode && signedIn && signedIn2 && !errs.length ? 0 : 1);
})();
