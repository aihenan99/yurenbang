/* 线上登录流程验收：打开 .cn → 登录面板 → 获取验证码 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";
let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? "[PASS] " : "[FAIL] ") + name + (extra ? "  → " + extra : ""));
  ok ? pass++ : fail++;
}
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on("request", r => { if (r.url().includes("/yrbapi/")) apiCalls.push(r.method() + " " + r.url().replace("https://xn--gmqq09al6z.cn", "")); });
  page.on("response", r => { if (r.url().includes("/yrbapi/")) apiCalls.push("  ↳ " + r.status()); });
  page.on("pageerror", e => console.log("PAGEERROR:", String(e.message).slice(0, 150)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4200);

  // 云服务初始化
  const cloudReady = await page.evaluate(() => ({ has: typeof window.YRB_CLOUD !== "undefined", ok: !!(window.YRB_CLOUD && window.YRB_CLOUD.ready !== false) }));
  check("YRB_CLOUD 已加载", cloudReady.has);

  // 打开登录面板
  await page.evaluate(() => { const m = document.querySelector("#meTab") || document.querySelector('[data-p="me"]'); if (m) m.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const btn = document.querySelector("#meLogin") || [...document.querySelectorAll("#meMenu .row, .menu-row, button")].find(e => /登录/.test(e.textContent || ""));
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);
  const vis = await page.evaluate(() => { const p = document.querySelector("#loginPanel, #loginMask"); return p && (p.offsetParent !== null || p.classList.contains("open")); });
  check("登录面板已打开", !!vis);

  // 填手机号（管理员的号），点「获取验证码」
  await page.fill("#lgPhone", "18037345855");
  await page.evaluate(() => { const c = document.querySelector("#lgAgree"); if (c && !c.classList.contains("on")) c.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const s = document.querySelector("#lgSend"); if (s) s.click(); });

  // 等待结果（最多 25 秒）
  let outcome = "";
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate(() => ({
      err: (document.querySelector("#lgErr") || {}).textContent || "",
      btn: (document.querySelector("#lgSend") || {}).textContent || "",
      toast: [...document.querySelectorAll(".toast, [class*=toast]")].map(e => e.textContent).join("|"),
    }));
    if (/已发送/.test(st.toast) || /后重发/.test(st.btn)) { outcome = "SENT"; break; }
    if (st.err && st.err.trim()) { outcome = "ERR: " + st.err.trim(); break; }
  }
  check("验证码请求成功（真实短信已发）", outcome === "SENT", outcome);

  console.log("\n--- 经代理的 API 调用 ---");
  apiCalls.slice(0, 12).forEach(l => console.log("  " + l));

  await page.screenshot({ path: "E:/育人帮/temp/otp_live.png" });
  await b.close();
  console.log("\n结果：%d 通过 / %d 失败", pass, fail);
  process.exit(fail ? 1 : 0);
})();
