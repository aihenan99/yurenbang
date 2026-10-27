/* 个人资料编辑自检：入口 / 保存 / 持久化 / 作者名联动 / 长辈模式 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? (pass++, console.log("  ✅ " + n + (extra ? " ｜ " + extra : ""))) : (fail++, console.log("  ❌ " + n + (extra ? " ｜ " + extra : ""))); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.click("#splash"); await page.waitForTimeout(800);
  await page.click('.tb-item[data-p="me"]'); await page.waitForTimeout(500);

  console.log("=== A. 入口 ===");
  const hasPencil = await page.evaluate(() => {
    const el = document.querySelector("#page-me .me-n");
    return { text: el.textContent.trim(), cursor: getComputedStyle(el).cursor, after: getComputedStyle(el, "::after").content };
  });
  check("昵称区有可点暗示（铅笔 + 手型）", hasPencil.cursor === "pointer" && /✎/.test(hasPencil.after), hasPencil.text + " " + hasPencil.after);
  await page.click("#page-me .me-n");
  await page.waitForTimeout(400);
  const sheet = await page.evaluate(() => ({ open: document.querySelector("#pfSheet").classList.contains("open"), title: document.querySelector("#pfSheet .pf-bar b").textContent, ages: document.querySelectorAll("#pfAges .pf-age").length, phone: document.querySelector("#pfPhone").textContent }));
  check("点昵称打开编辑面板", sheet.open && sheet.title === "编辑资料", sheet.title);
  check("年龄段 6 档可选", sheet.ages === 6, sheet.ages + " 档");
  check("手机号只读展示（未登录有说明）", /未登录|1\d{2}\*{4}\d{4}/.test(sheet.phone), sheet.phone);

  console.log("=== B. 校验 ===");
  await page.fill("#pfNick", "一");
  await page.click("#pfSave"); await page.waitForTimeout(300);
  check("昵称过短被拦下", (await page.textContent("#pfErr")).includes("2-12"), await page.textContent("#pfErr"));

  console.log("=== C. 保存 ===");
  await page.fill("#pfNick", "乐乐妈妈");
  await page.click('#pfAges .pf-age[data-a="6-12岁"]');
  await page.fill("#pfCity", "北京");
  await page.fill("#pfBio", "两个孩子的妈妈，喜欢分享育儿经验");
  await page.click("#pfSave"); await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    closed: !document.querySelector("#pfSheet").classList.contains("open"),
    name: document.querySelector("#page-me .me-n").textContent.trim(),
    saved: localStorage.getItem("yrb_profile_v1"),
    toast: (document.querySelector("#toast") || {}).textContent || ""
  }));
  check("保存后面板关闭", after.closed);
  check("昵称立即更新到「我的」页", /乐乐妈妈/.test(after.name), after.name);
  check("资料写入本地", /乐乐妈妈/.test(after.saved || ""), (after.saved || "").slice(0, 60));
  check("给出成功提示", /资料已更新/.test(after.toast), after.toast.trim());

  console.log("=== D. 刷新后仍生效 ===");
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(900);
  await page.click("#splash"); await page.waitForTimeout(700);
  await page.click('.tb-item[data-p="me"]'); await page.waitForTimeout(400);
  check("刷新后昵称保持", /乐乐妈妈/.test(await page.textContent("#page-me .me-n")));

  console.log("=== E. 昵称联动作者名 ===");
  const nm = await page.evaluate(() => (window.YRB_CLOUD && YRB_CLOUD.name) ? YRB_CLOUD.name() : "");
  check("发布/留言作者名使用自定义昵称", nm === "乐乐妈妈", nm);

  console.log("=== F. 主人号 / 只读项 ===");
  await page.click("#page-me .me-id"); await page.waitForTimeout(350);
  const uid = await page.evaluate(() => ({ uid: document.querySelector("#pfUid").textContent, phone: document.querySelector("#pfPhone").textContent }));
  check("未登录时育人帮号显示 —", uid.uid === "—", uid.uid);
  await page.click("#pfCancel");

  console.log("=== G. 长辈模式放大 ===");
  await page.evaluate(() => { const p = document.querySelector("#phone"); p.dataset.elder = "1"; });
  await page.waitForTimeout(350);
  await page.click("#page-me .me-n"); await page.waitForTimeout(350);
  const big = await page.evaluate(() => ({ lb: parseFloat(getComputedStyle(document.querySelector("#pfSheet .pf-lb")).fontSize), btn: parseFloat(getComputedStyle(document.querySelector("#pfSheet .pf-btn")).fontSize) }));
  check("长辈模式标签 ≥16px", big.lb >= 16, big.lb + "px");
  check("长辈模式按钮 ≥18px", big.btn >= 18, big.btn + "px");

  console.log("JS 错误:", errs.length ? errs.slice(0, 3) : "无");
  console.log(`\n===== 个人资料测试：${pass} 通过 / ${fail} 失败 =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
