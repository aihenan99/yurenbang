/* 资质证照 / 用户协议 入口与展示自检 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? (pass++, console.log("  ✅ " + n + (extra ? " ｜ " + extra : ""))) : (fail++, console.log("  ❌ " + n + (extra ? " ｜ " + extra : ""))); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.addInitScript(() => {
    /* 预置一张"已上传"的证照（1x1 png），用于验证查看链路 */
    localStorage.setItem("yrb_license_v1", JSON.stringify({
      license_business: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    }));
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.click("#splash"); await page.waitForTimeout(900);

  console.log("=== A. 设置 → 资质证照 ===");
  await page.click("#btnSet"); await page.waitForTimeout(300);
  const label = await page.evaluate(() => [...document.querySelectorAll("#dropdown .dd-item")].map(x => x.textContent.trim()).find(t => /资质/.test(t)));
  check("设置项名称已改为「资质证照」", /^📜资质证照/.test(label || ""), label);
  await page.click('#dropdown .dd-item[data-k="license"]'); await page.waitForTimeout(500);
  const lic = await page.evaluate(() => ({
    open: document.querySelector("#subpage").classList.contains("open"),
    title: document.querySelector("#spTitle").textContent,
    rows: [...document.querySelectorAll("#spBody .lic-row")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
    chips: [...document.querySelectorAll("#spBody .lic-row .chip")].map(c => c.textContent.trim())
  }));
  check("资质证照页打开", lic.open && lic.title === "资质证照", lic.title);
  check("5 项证照全部渲染", lic.rows.length === 5, lic.rows.length + " 行");
  check("已上传项显示「查看」/未上传显示「待上传」", lic.chips[0] === "查看" && lic.chips.filter(c => c === "待上传").length === 4, lic.chips.join(","));

  console.log("=== B. 查看证照原件 ===");
  await page.click("#spBody .lic-row"); await page.waitForTimeout(400);
  const v = await page.evaluate(() => ({ open: document.querySelector("#licView").classList.contains("open"), title: document.querySelector("#lvTitle").textContent, src: (document.querySelector("#lvImg").src || "").slice(0, 22) }));
  check("点「查看」打开全屏查看器", v.open && v.title === "营业执照", v.src);
  await page.click("#lvClose"); await page.waitForTimeout(200);
  check("可关闭查看器", !(await page.evaluate(() => document.querySelector("#licView").classList.contains("open"))));

  console.log("=== C. 未上传项点击有提示 ===");
  await page.click("#spBody .lic-row:nth-child(2)"); await page.waitForTimeout(300);
  const tip = await page.evaluate(() => (document.querySelector("#toast") || {}).textContent || "");
  check("未上传项给出明确提示", /尚未上传/.test(tip), tip.trim().slice(0, 30));

  console.log("=== D. 用户协议完整正文 ===");
  await page.click("#spBack").catch(() => {});
  await page.waitForTimeout(300);
  await page.click("#btnSet"); await page.waitForTimeout(300);
  await page.click('#dropdown .dd-item[data-k="agreement"]'); await page.waitForTimeout(500);
  const doc = await page.evaluate(() => ({
    title: document.querySelector("#spTitle").textContent,
    len: (document.querySelector("#spBody .lic-doc") || {}).textContent ? document.querySelector("#spBody .lic-doc").textContent.length : 0,
    tabs: [...document.querySelectorAll("#spBody .lic-tab")].map(t => t.textContent.trim()),
    hasH: document.querySelectorAll("#spBody .lic-doc .d-h").length
  }));
  check("协议标题正确", doc.title === "育人帮用户协议", doc.title);
  check("渲染完整正文（非摘要）", doc.len > 1200, doc.len + " 字");
  check("章节标题渲染（≥10 段）", doc.hasH >= 10, doc.hasH + " 段");
  check("可切换隐私政策", doc.tabs.length === 2, doc.tabs.join("/"));
  await page.click('#spBody .lic-tab[data-doc="privacy"]'); await page.waitForTimeout(300);
  check("切到隐私政策", (await page.evaluate(() => document.querySelector("#spTitle").textContent)) === "育人帮隐私政策");

  console.log("=== E. 关于页两个入口 ===");
  await page.click("#spBack").catch(() => {});
  await page.waitForTimeout(300);
  await page.click("#btnSet"); await page.waitForTimeout(300);
  await page.click('#dropdown .dd-item[data-k="about"]'); await page.waitForTimeout(400);
  const aboutIds = await page.evaluate(() => ({ lic: !!document.querySelector("#spLic"), agr: !!document.querySelector("#spAgr") }));
  check("关于页有「资质证照」「用户协议」入口", aboutIds.lic && aboutIds.agr);
  await page.click("#spLic"); await page.waitForTimeout(400);
  check("关于页 → 资质证照可跳转", (await page.evaluate(() => document.querySelector("#spTitle").textContent)) === "资质证照");

  console.log("=== F. 后台资质证照页签（源码级检查） ===");
  await page.click("#spBack").catch(() => {});
  const fs = require("fs");
  const adminSrc = fs.readFileSync("E:/育人帮/yurenbang-app/assets/admin.js", "utf8");
  check("后台新增「资质证照」页签", /\["license",\s*"📜 资质证照"\]/.test(adminSrc));
  check("后台页签渲染函数就绪", /function licenseTabHTML/.test(adminSrc));
  check("后台上传走 admin_set_setting（服务端鉴权）", /licRpc\("admin_set_setting"/.test(adminSrc));
  check("上传后派发 yrb-license 让前台即时刷新", /dispatchEvent\(new CustomEvent\("yrb-license"\)/.test(adminSrc));

  console.log("JS 错误:", errs.length ? errs.slice(0, 3) : "无");
  console.log(`\n===== 资质证照/协议测试：${pass} 通过 / ${fail} 失败 =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
