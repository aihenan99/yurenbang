/* 复现「上传案例卡住」：模拟用户输入标题 + 选微视频 + 点发布 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  p.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE-" + m.type().toUpperCase(), m.text().slice(0, 200)); });
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1000);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.click("#splash"); await p.waitForTimeout(800); }

  // 进入案例广场
  await p.evaluate(() => { switchTab("cases"); });
  await p.waitForTimeout(500);

  // 点 + 打开上传面板
  await p.evaluate(() => document.querySelector("#caseFab").click());
  await p.waitForTimeout(300);
  console.log("面板 open:", await p.evaluate(() => document.querySelector("#caseUpSheet").classList.contains("open")));

  // 输入标题 + 选微视频
  await p.evaluate(() => {
    const t = document.querySelector("#cuTitle");
    t.value = "测试";
    t.dispatchEvent(new Event("input", { bubbles: true }));
    const btn = document.querySelector('#cuTypes .seg-btn[data-t="video"]');
    btn.click();
  });
  await p.waitForTimeout(200);

  // 点发布
  await p.evaluate(() => document.querySelector("#cuGo").click());
  await p.waitForTimeout(600);
  const st = await p.evaluate(() => ({
    sheetOpen: document.querySelector("#caseUpSheet").classList.contains("open"),
    title: document.querySelector("#cuTitle").value,
    caseN: (window.S && S.cases || []).length,
    firstCase: (window.S && S.cases || [])[0] ? { t: S.cases[0].t, type: S.cases[0].type, by: S.cases[0].by } : null,
    gridCards: document.querySelectorAll("#caseGrid .case-card").length,
    page: document.querySelector(".page.open") ? document.querySelector(".page.open").id : null
  }));
  console.log("发布后状态:", JSON.stringify(st));

  // 再点新卡片看查看器能否打开
  await p.evaluate(() => document.querySelector('#caseGrid .case-card').click());
  await p.waitForTimeout(400);
  console.log("查看器 open:", await p.evaluate(() => document.querySelector("#viewer").classList.contains("open")));

  await b.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
