/* isolated-test：云端数据库被平台隔离（503 DATABASE_RESOURCE_ISOLATED）
   → 不能误报「网络不稳定」，要显示「维护中 + 自动恢复」，并挂维护横幅 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass = 0, fail = 0;
const ck = (n, c, d) => { if (c) { pass++; console.log("  ✅", n); } else { fail++; console.log("  ✗", n, d || ""); } };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?iso=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2400);

  /* T1-T4 错误分类 */
  const cls = await p.evaluate(() => {
    const f = YRB_CLOUD.isIsolated;
    return {
      s503: f({ status: 503 }),
      code: f({ code: "DATABASE_RESOURCE_ISOLATED", message: "Database resource is isolated." }),
      msg: f({ message: "Database resource is isolated. For more information..." }),
      perm: f({ code: "42501", message: "permission denied" }),
      timeout: f(new Error("加载云端求助超时（网络较慢），请检查网络后重试")),
      empty: f(null)
    };
  });
  ck("503 → 判定为隔离", cls.s503 === true, String(cls.s503));
  ck("错误码 DATABASE_RESOURCE_ISOLATED → 隔离", cls.code === true);
  ck("英文 message 含 isolated → 隔离", cls.msg === true);
  ck("42501/超时/空 不误判", cls.perm === false && cls.timeout === false && cls.empty === false,
    JSON.stringify([cls.perm, cls.timeout, cls.empty]));

  /* T4b 用户可见文案：503 不许说「网络」 */
  const msg = await p.evaluate(() => ({
    iso: YRB_CLOUD.errText({ status: 503 }),
    code: YRB_CLOUD.errText({ code: "DATABASE_RESOURCE_ISOLATED", message: "database resource isolated" }),
    perm: YRB_CLOUD.errText({ code: "42501" })
  }));
  ck("503 文案说「维护」不说「网络」",
    msg.iso.includes("维护") && msg.iso.indexOf("网络") < 0, msg.iso);
  ck("隔离错误码文案一致", msg.code === msg.iso, msg.code);
  ck("权限类错误文案不被改写", msg.perm.indexOf("权限") >= 0, msg.perm);

  /* T5 信息流 isolated 空态 */
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    S.posts = [];
    const orig = YRB_CLOUD.postsState;
    YRB_CLOUD.postsState = () => "isolated";
    renderFeed();
    YRB_CLOUD.postsState = orig;
  });
  const t5 = await p.evaluate(() => ({
    txt: (document.querySelector("#feed .empty") || {}).textContent || "",
    btn: !!document.getElementById("feedRetry")
  }));
  ck("isolated 空态说「维护」不说「网络不稳定」",
    t5.txt.includes("维护") && t5.txt.indexOf("网络不稳定") < 0, t5.txt.slice(0, 60));
  ck("isolated 空态说明自动重试", t5.txt.includes("20 秒") && t5.txt.includes("自己"), t5.txt.slice(0, 80));
  ck("isolated 空态保留手动重试按钮", t5.btn);

  /* T6 案例 isolated 空态 */
  const t6 = await p.evaluate(() => {
    S.cases = [];
    const orig = YRB_CLOUD.casesState;
    YRB_CLOUD.casesState = () => "isolated";
    renderCases();
    YRB_CLOUD.casesState = orig;
    return (document.querySelector("#caseGrid .empty") || {}).textContent || "";
  });
  ck("案例 isolated 空态含「维护」", t6.includes("维护") && t6.indexOf("网络不稳定") < 0, t6.slice(0, 60));

  /* T7 维护横幅 显隐 */
  const t7 = await p.evaluate(() => {
    YRB_CLOUD.paintMaint(true);
    const on = document.getElementById("maintBar");
    const info = { has: !!on, txt: on ? on.textContent : "", parent: on && on.parentNode ? on.parentNode.id : "" };
    YRB_CLOUD.paintMaint(false);
    info.gone = !document.getElementById("maintBar");
    /* 幂等：连续两次 true 只留一个 */
    YRB_CLOUD.paintMaint(true); YRB_CLOUD.paintMaint(true);
    info.single = document.querySelectorAll("#maintBar").length;
    YRB_CLOUD.paintMaint(false);
    return info;
  });
  ck("维护横幅可显示且含「维护中」", t7.has && t7.txt.includes("维护中"), t7.txt);
  ck("横幅挂在 #app 内 #pages 之前", t7.parent === "app", t7.parent);
  ck("paintMaint(false) 可移除", t7.gone === true);
  ck("重复调用不产生多条", t7.single === 1, String(t7.single));

  ck("页面无脚本错误", errs.length === 0, errs.join(" | "));
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
