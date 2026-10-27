/* 登录验证码「请先获取」回归（本地 deploy-cn，不真发短信）
   S1 已有未过期凭证 → 打开登录面板自动回填手机号 + 绿色提示「直接输入」
   S2 刷新页面后提交 → 不再报「请先获取该手机号的验证码」，而是真正走校验（拿到后端错误）
   S3 超过 10 分钟的凭证 → 视为过期：不回填、无提示
   S4 手机号与凭证不一致 → 提示「验证码是发给 138****xxxx」
   零 pageerror */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const BASE = "http://127.0.0.1:8794/";
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1800);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);

  /* S1：写入有效凭证 → 刷新 → 打开登录面板 */
  await p.evaluate(() => {
    sessionStorage.setItem("ybp_otp_v1", JSON.stringify({ phone: "13800138000", verificationId: "vid-test", isExistingUser: false, ts: Date.now() }));
  });
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(1800);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { try { YRB_CLOUD.openLogin(); } catch (e) { document.querySelector("#mmShare"); } });
  await p.waitForTimeout(600);
  const r1 = await p.evaluate(() => ({
    phone: (document.querySelector("#lgPhone") || {}).value,
    hintShown: (document.querySelector("#lgHint") || {}).style.display === "block",
    hint: ((document.querySelector("#lgHint") || {}).textContent || "").replace(/\s+/g, " ").slice(0, 60),
    sheet: !!document.querySelector("#loginSheet.open")
  }));
  console.log("S1 面板", r1.sheet, "| 回填手机号", r1.phone, "| 提示", r1.hintShown, "|", r1.hint);

  /* S2：勾协议 + 填码提交（后端会拒，但不应是「请先获取」） */
  const r2 = await p.evaluate(async () => {
    const ck = document.querySelector("#lgCk"); if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
    const code = document.querySelector("#lgCode"); code.value = "123456";
    document.querySelector("#lgSubmit").click();
    await new Promise(r => setTimeout(r, 3500));
    return {
      err: ((document.querySelector("#lgErr") || {}).textContent || "").trim(),
      btn: ((document.querySelector("#lgSubmit") || {}).textContent || "").trim()
    };
  });
  console.log("S2 提交后提示:", JSON.stringify(r2.err).slice(0, 120), "| 按钮:", r2.btn);
  console.log("   S2 不是「请先获取」:", !/请先获取该手机号/.test(r2.err));

  /* S3：过期凭证 */
  await p.evaluate(() => {
    sessionStorage.setItem("ybp_otp_v1", JSON.stringify({ phone: "13800138000", verificationId: "vid-old", isExistingUser: false, ts: Date.now() - 11 * 60 * 1000 }));
  });
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(1800);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => YRB_CLOUD.openLogin());
  await p.waitForTimeout(500);
  const r3 = await p.evaluate(() => ({
    phone: (document.querySelector("#lgPhone") || {}).value,
    hintShown: (document.querySelector("#lgHint") || {}).style.display === "block",
    cleared: !sessionStorage.getItem("ybp_otp_v1")
  }));
  console.log("S3 过期: 未回填", r3.phone === "", "| 无提示", !r3.hintShown, "| 已清理存储", r3.cleared);

  /* S4：手机号不一致 */
  const r4 = await p.evaluate(async () => {
    sessionStorage.setItem("ybp_otp_v1", JSON.stringify({ phone: "13800138000", verificationId: "vid-x", isExistingUser: false, ts: Date.now() }));
    document.querySelector("#lgPhone").value = "13900139000";
    const ck = document.querySelector("#lgCk"); if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
    document.querySelector("#lgCode").value = "123456";
    document.querySelector("#lgSubmit").click();
    await new Promise(r => setTimeout(r, 800));
    return ((document.querySelector("#lgErr") || {}).textContent || "").trim();
  });
  console.log("S4 不一致提示:", JSON.stringify(r4));

  console.log("PAGEERRORS:", errs.length ? errs.join(" | ").slice(0, 200) : "无");
  await b.close();
})();
