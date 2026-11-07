/* 教师信息登记表 · 界面实拍 + 交互冒烟
   用途：确认棕黄表格在真实手机视口里的排版、位置（绿色扫码卡上方）、
   以及三组单选和前端校验是否按预期工作。
   跑法：node tests/diag/tutor-teacher-shot.js [--elder] */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const http = require("http");

const BASE = process.env.BASE || "http://127.0.0.1:8795";
const ELDER = process.argv.includes("--elder");

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

  await page.goto(BASE + "/index.html?d=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  /* 启动屏要点击才进入，否则后续点击全落在它上面 */
  await page.click("#splash", { force: true }).catch(() => {});
  await page.waitForTimeout(600);
  if (ELDER) await page.evaluate(() => { document.getElementById("phone").dataset.elder = "1"; });
  /* 家教页在 #app 里，正常路径是点栏目 chip 进入；测试直接切 tab 时把层显示出来 */
  await page.evaluate(() => {
    const app = document.getElementById("app");
    if (app) app.classList.remove("hidden");
    if (window.switchTab) window.switchTab("jiaojiao");
  });
  await page.waitForTimeout(1200);
  /* 登录门槛会先弹「请登录」把点击吃掉，导致校验逻辑测不到；
     这条用例只验前端校验与排版，所以临时让云服务不可用（gate 会放行、saveTeacher 直接 return） */
  await page.evaluate(() => {
    try { window.YRB_CLOUD.enabled = () => false; } catch (e) {}
  });

  /* 1) 位置关系：表格必须在绿色扫码卡之前 */
  const layout = await page.evaluate(() => {
    const sheet = document.querySelector("#page-jiaojiao .jt-sheet");
    const wx = document.querySelector("#page-jiaojiao .jj-wx");
    const btn = document.querySelector("#page-jiaojiao #jjSubmit");
    if (!sheet || !wx) return { ok: false };
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top + window.scrollY, h: Math.round(b.height) }; };
    return {
      ok: true,
      sheetTop: Math.round(r(sheet).top),
      sheetH: r(sheet).h,
      wxTop: Math.round(r(wx).top),
      beforeGreen: r(sheet).top + r(sheet).h <= r(wx).top + 2,
      afterSubmit: r(sheet).top > r(btn).top,
    };
  });

  /* 2) 表格结构：9 行字段是否齐全 */
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#page-jiaojiao .jt-tb th")].map((t) => t.textContent.replace(/\s+/g, ""))
  );
  const bg = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector("#page-jiaojiao .jt-sheet"));
    return { bg: s.backgroundImage.slice(0, 60), radius: s.borderRadius };
  });

  /* 3) 点空校验：直接点提交，应当被拦并提示 */
  await page.evaluate(() => {
    window.__toast = [];
    const t = window.toast;
    window.toast = function (m) { window.__toast.push(String(m)); return t && t.apply(this, arguments); };
  });
  await page.click("#jtSubmit", { force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const emptyToast = await page.evaluate(() => window.__toast.slice(-1)[0] || "");

  /* 4) 三组单选互斥 */
  const pick = await page.evaluate(() => {
    const box = (n) => document.querySelector(`#page-jiaojiao .jt-opts[data-jt="${n}"]`);
    const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const g = box("gender");
    click(g.children[0]); click(g.children[1]);
    const gOn = [...g.querySelectorAll(".jt-opt.on")].map((x) => x.dataset.v);
    const j = box("job");
    click(j.children[0]); click(j.children[2]);
    const jOn = [...j.querySelectorAll(".jt-opt.on")].map((x) => x.dataset.v);
    const s = box("serve");
    click(s.children[1]);
    const sOn = [...s.querySelectorAll(".jt-opt.on")].map((x) => x.dataset.v);
    return { gOn, jOn, sOn };
  });

  /* 5) 填完整 + 年龄越界 */
  await page.fill("#jtName", "王老师");
  await page.fill("#jtAge", "9");
  await page.fill("#jtGradeSub", "初二初三 · 数学物理");
  await page.fill("#jtPhone", "13800138000");
  await page.fill("#jtArea", "浦东金桥");
  await page.evaluate(() => { window.__toast = []; });
  await page.click("#jtSubmit", { force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const ageToast = await page.evaluate(() => window.__toast.slice(-1)[0] || "");

  /* 6) 截图：整张表 + 绿色卡同框 */
  await page.evaluate(() => {
    const s = document.querySelector("#page-jiaojiao .jt-sheet");
    s.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(600);
  const shot = ELDER ? "temp/shot-jt-elder.png" : "temp/shot-jt.png";
  await page.screenshot({ path: shot, fullPage: false });

  /* 7) 触控目标尺寸抽查 */
  const hit = await page.evaluate(() => {
    const a = [...document.querySelectorAll("#page-jiaojiao .jt-opt")].map((x) => Math.round(x.getBoundingClientRect().height));
    const inp = [...document.querySelectorAll("#page-jiaojiao .jt-in")].map((x) => Math.round(x.getBoundingClientRect().height));
    return { optMin: Math.min(...a), inMin: Math.min(...inp), overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });

  console.log("=== 位置 ===");
  console.log(`  表格 top=${layout.sheetTop} 高=${layout.sheetH} ｜ 绿色卡 top=${layout.wxTop}`);
  console.log(`  在绿色信息栏之上: ${layout.beforeGreen ? "✅" : "❌"} ｜ 在提交按钮之下: ${layout.afterSubmit ? "✅" : "❌"}`);
  console.log("=== 字段 ===");
  console.log("  " + rows.join(" / ") + `  （共 ${rows.length} 项）`);
  console.log("=== 外观 ===");
  console.log(`  背景: ${bg.bg}… 圆角 ${bg.radius}`);
  console.log("=== 交互 ===");
  console.log(`  空表提交提示: ${emptyToast || "（无）"}`);
  console.log(`  性别单选: ${pick.gOn.join(",")} ｜ 类型: ${pick.jOn.join(",")} ｜ 服务: ${pick.sOn.join(",")}`);
  console.log(`  年龄 9 岁提示: ${ageToast || "（无）"}`);
  console.log("=== 触控 ===");
  console.log(`  jt-opt 最小高 ${hit.optMin}px ｜ 输入框最小高 ${hit.inMin}px ｜ 横向溢出 ${hit.overflowX ? "❌有" : "✅无"}`);
  console.log(`=== JS 报错 === ${errs.length ? errs.join(" | ") : "无"}`);
  console.log(`截图：${shot}`);

  await browser.close();
})();
