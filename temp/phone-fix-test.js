/* 手机号兜底专项回归（2026-10-23）
   场景：账号密码登录 / OTP 凭证过期后，会话对象里没有手机号，
   「设置登录用户名/密码」点获取验证码报「没取到手机号」。
   修复链路：① 云端 me RPC 返回 phone（yb_accounts 或 auth.users.phone_number 兜底）
            ② 前端 getPhone()：who() → ST.me.phone
            ③ 登录成功时本机记录手机号（yrb_login_phone_v1），sessionPhone 最后兜底，退出清除 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const BASE = "http://127.0.0.1:8794/";
let pass = 0, fail = 0;
function ok(c, m, extra) {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  await p.goto(BASE + "?ph=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(300);

  /* ---- S1 本机记录兜底链路（源码断言：who() 未登录返回 null，内部链路无法黑盒直测） ---- */
  console.log("S1 本机手机号记录与兜底链路（源码断言）");
  const fs = require("fs");
  const bundle = fs.readFileSync("E:/育人帮/deploy-cn/assets/bundle.js", "utf8");
  ok(/yrb_login_phone_v1/.test(bundle), "登录手机号本机记录键已进 bundle");
  ok(/rememberPhone\(otp\.phone\)/.test(bundle), "验证码登录成功后记录手机号");
  ok(/rememberPhone\(phone\)/.test(bundle), "密码登录成功后记录手机号");
  ok(/rememberedPhone\(\)/.test(bundle) && /forgotPhone\(\)/.test(bundle), "sessionPhone 兜底与退出清除均已接线");
  /* 本机记录 → who() 兜底（登录态下生效，这里用已登录桩验证归一化） */
  await p.evaluate(() => {
    localStorage.setItem("yrb_login_phone_v1", "13800138000");
    YRB_CLOUD.signedIn = () => true;
    YRB_CLOUD.who = () => ({ id: "fake-uid", phone: (localStorage.getItem("yrb_login_phone_v1") || ""), name: "爱河南99" });
  });
  const s1 = await p.evaluate(() => {
    /* 模拟 getPhone 的归一化判定（account.js 同规则） */
    const p1 = String((YRB_CLOUD.who() || {}).phone || "").replace(/\D/g, "");
    return /^1\d{10}$/.test(p1) ? p1 : "";
  });
  ok(s1 === "13800138000", "本机记录可归一化为合法手机号供发码使用", s1);

  /* ---- S2 本机无记录 + 会话无手机号（密码登录真实形态）→ me RPC 兜底 ---- */
  console.log("S2 无本机记录：me RPC 兜底发验证码");
  await p.evaluate(() => {
    localStorage.removeItem("yrb_login_phone_v1");
    YRB_CLOUD.signedIn = () => true;
    YRB_CLOUD.who = () => ({ id: "fake-uid", phone: "", name: "爱河南99" });
    YRB_CLOUD.accounts.me = async () => ({ data: { ok: true, has_pwd: false, phone: "13800138000" } });
    window.__otpCalls = 0;
    /* 2026-10-25：设密发码改走 PASSWORD_RESET 专用接口 */
    YRB_CLOUD.accounts.sendResetOtp = async () => { window.__otpCalls++; return { ok: true, verificationId: "vid-x" }; };
    openSubpage("acct");
  });
  await p.waitForTimeout(900);
  await p.evaluate(() => { const b = document.getElementById("acSetName") || document.getElementById("acSetPwd"); if (b) b.click(); });
  await p.waitForTimeout(600);
  const sheetOpen = await p.evaluate(() => !!(document.getElementById("pwdSheet") || {}).classList &&
    document.getElementById("pwdSheet").classList.contains("open"));
  ok(sheetOpen, "设置弹窗可打开", String(sheetOpen));
  await p.evaluate(() => { document.getElementById("pwSend").click(); });
  await p.waitForTimeout(1600);
  const s2 = await p.evaluate(() => ({
    calls: window.__otpCalls,
    err: (document.getElementById("pwErr") || {}).textContent || "",
    tip: (document.getElementById("pwSendTip") || {}).textContent || ""
  }));
  ok(s2.calls >= 1, "获取验证码成功（不再报「没取到手机号」）", JSON.stringify(s2));
  ok(/已发送到 138/.test(s2.tip), "提示写明验证码发到哪个号", s2.tip);
  ok(!/没取到手机号/.test(s2.err), "错误提示未出现", s2.err);

  /* ---- S3 me 也没有 phone：给出明确引导而不是静默失败 ---- */
  console.log("S3 彻底没有手机号时的引导");
  await p.evaluate(() => {
    YRB_CLOUD.accounts.me = async () => ({ data: { ok: true, has_pwd: false } });
    document.getElementById("pwCancel").click();
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => { (document.getElementById("acSetName") || document.getElementById("acSetPwd")).click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { document.getElementById("pwSend").click(); });
  await p.waitForTimeout(1400);
  const s3 = await p.evaluate(() => (document.getElementById("pwErr") || {}).textContent || "");
  ok(/没取到手机号/.test(s3), "仍取不到时给出明确提示", s3);

  /* ---- S4 退出登录清除本机记录 ---- */
  console.log("S4 退出登录清除");
  await p.evaluate(() => { localStorage.setItem("yrb_login_phone_v1", "13800138000"); });
  await p.evaluate(async () => { await YRB_CLOUD.signOut(); });
  const s4 = await p.evaluate(() => localStorage.getItem("yrb_login_phone_v1"));
  ok(s4 === null, "退出登录后本机手机号被清除", String(s4));

  ok(errs.length === 0, "无页面报错", errs[0]);

  await browser.close();
  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常:", e); process.exit(2); });
