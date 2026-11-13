/* 自助找回密码（密保问题）回归（2026-11-13）
   覆盖：
   ①登录面板「忘记密码」进入找回面板（不再是"请联系站长"的 toast）
   ②输用户名 → 取回密保问题（RPC yb_sec_info）
   ③答对 → 重设密码（RPC yb_sec_reset）→ 面板关闭、用户名回填
   ④答错 → 提示答案不对，仍停在原步骤
   ⑤没设过密保 / 用户名打错 → 提示联系站长，不泄露账号是否存在
   ⑥数据库还没跑迁移（RPC 404）→ 降级提示，不当成"用户名错了"
   ⑦「我的—账号与安全—密保问题」可打开设置面板并保存（RPC yb_sec_set）
   用法：node tests/diag/password_recovery_test.js [url]
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

  /* RPC 假后端：按测试需要返回不同结果 */
  let mode = "ok";
  const calls = [];
  await page.route("**/rpc/yb_sec_info", async (route) => {
    calls.push("info");
    if (mode === "missing") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.yb_sec_info" }) });
    if (mode === "not_set") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "not_set" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, q: "孩子的小名是什么？" }) });
  });
  await page.route("**/rpc/yb_sec_reset", async (route) => {
    calls.push("reset");
    const body = route.request().postData() || "";
    if (mode === "bad") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "bad_answer" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, got: body }) });
  });
  await page.route("**/rpc/yb_sec_set", async (route) => {
    calls.push("set");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto(URL, { waitUntil: "load" });
  await page.touchscreen.tap(195, 420).catch(() => {});
  await page.waitForTimeout(600);

  /* ---------- ① 从登录面板进入 ---------- */
  await page.evaluate(() => { try { YRB_CLOUD.openLogin(); } catch (e) {} });
  await page.waitForTimeout(400);
  await page.click("#lgToSms", { force: true }).catch(() => {});
  await page.waitForTimeout(500);
  const s1 = await page.evaluate(() => {
    const p = document.querySelector("#lgSec");
    return { open: !!p && p.classList.contains("open"), title: (document.querySelector("#lgSecTitle") || {}).textContent, hasName: !!document.querySelector("#secName") };
  });
  ok("① 点「忘记密码」打开找回面板", s1.open && s1.title === "找回密码" && s1.hasName, s1);

  /* ---------- ② 取回问题 ---------- */
  await page.fill("#secName", "小明妈妈");
  await page.click("#secNext", { force: true });
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => ({
    q: (document.querySelector(".lg-sec-q") || {}).textContent || "",
    hasAns: !!document.querySelector("#secAns"),
    calls: 0,
  }));
  ok("② 取回密保问题并进入答题步骤", /孩子的小名/.test(s2.q) && s2.hasAns, s2);
  ok("② 调用了 yb_sec_info", calls.includes("info"), calls);

  /* ---------- ④ 答错 → 提示且不关闭 ---------- */
  mode = "bad";
  await page.fill("#secAns", "错误答案");
  await page.fill("#secPwd", "newpass123");
  await page.fill("#secPwd2", "newpass123");
  await page.click("#secReset", { force: true });
  await page.waitForTimeout(600);
  const s4 = await page.evaluate(() => ({
    err: (document.querySelector("#secErr") || {}).textContent || "",
    stillOpen: (document.querySelector("#lgSec") || {}).classList.contains("open"),
  }));
  ok("④ 答错提示「答案不对」且不关闭面板", /答案不对/.test(s4.err) && s4.stillOpen, s4);

  /* ---------- ③ 答对 → 重设成功 ---------- */
  mode = "ok";
  await page.click("#secReset", { force: true });
  await page.waitForTimeout(700);
  const s3 = await page.evaluate(() => ({
    open: (document.querySelector("#lgSec") || {}).classList.contains("open"),
    acct: (document.querySelector("#lgAcct") || {}).value || "",
  }));
  ok("③ 重设成功后面板关闭、用户名回填", s3.open === false && s3.acct === "小明妈妈", s3);
  ok("③ 调用了 yb_sec_reset", calls.includes("reset"), calls);

  /* ---------- ⑤ 没设过密保 ---------- */
  mode = "not_set";
  await page.evaluate(() => { YRB_CLOUD.security.open("recover"); });
  await page.waitForTimeout(400);
  await page.fill("#secName", "查无此人");
  await page.click("#secNext", { force: true });
  await page.waitForTimeout(500);
  const s5 = await page.evaluate(() => (document.querySelector("#secErr") || {}).textContent || "");
  ok("⑤ 没设密保 → 提示联系站长（不区分账号是否存在）", /没设过密保|联系站长/.test(s5), s5);

  /* ---------- ⑥ 迁移未执行（RPC 404） ---------- */
  mode = "missing";
  await page.fill("#secName", "小明妈妈");
  await page.click("#secNext", { force: true });
  await page.waitForTimeout(600);
  const s6 = await page.evaluate(() => (document.querySelector("#secErr") || {}).textContent || "");
  ok("⑥ 数据库未跑迁移 → 降级提示「暂未开通」", /暂未开通/.test(s6), s6);

  /* ---------- ⑦ 设置密保（账号与安全入口） ---------- */
  mode = "ok";
  await page.evaluate(() => { YRB_CLOUD.security.open("set"); });
  await page.waitForTimeout(500);
  const s7a = await page.evaluate(() => ({
    title: (document.querySelector("#lgSecTitle") || {}).textContent,
    chips: document.querySelectorAll(".lg-sec-chip").length,
    sheetOpen: (document.querySelector("#loginSheet") || {}).classList.contains("open"),
  }));
  ok("⑦ 设置面板打开（并自动带出登录壳）", s7a.title === "设置密保问题" && s7a.chips >= 2 && s7a.sheetOpen, s7a);
  await page.click(".lg-sec-chip");                        /* 点常见问题自动填 */
  await page.fill("#secAIn", "豆豆");
  await page.click("#secSave", { force: true });
  await page.waitForTimeout(600);
  const s7b = await page.evaluate(() => ({
    open: (document.querySelector("#lgSec") || {}).classList.contains("open"),
    q: "",
  }));
  ok("⑦ 保存密保后面板关闭", s7b.open === false, s7b);
  ok("⑦ 调用了 yb_sec_set", calls.includes("set"), calls);

  ok("⑧ 无页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
