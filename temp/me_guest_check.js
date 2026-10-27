const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);          // 等 cloud boot 与 profile.apply 都跑完
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }
  await p.evaluate(() => switchTab("me"));
  await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({
    name: document.querySelector("#page-me .me-n").childNodes[0].nodeValue.trim(),
    idRow: document.querySelector("#page-me .me-id").textContent.trim(),
    hasChip: !!document.querySelector("#page-me .me-id .chip"),
    hasYrb: /yrb_/.test(document.querySelector("#page-me .me-id").textContent),
    bottomRow: (document.querySelector("#clAcctT") || {}).textContent
  }));
  console.log("未登录头部:", JSON.stringify(st));
  // 点头部昵称 → 应弹登录面板而不是编辑资料
  await p.evaluate(() => document.querySelector("#page-me .me-n").click());
  await p.waitForTimeout(600);
  console.log("点头部 → 登录面板:", await p.evaluate(() => document.querySelector("#loginSheet").classList.contains("open")),
    "| 编辑资料面板:", await p.evaluate(() => !!document.querySelector("#pfSheet.open")));
  // 关掉登录，确认头部仍是未登录（profile 不抢写）
  await p.evaluate(() => { const x = document.querySelector("#lgX"); x && x.click(); });
  await p.waitForTimeout(1200);
  console.log("关登录后昵称仍为:", await p.evaluate(() => document.querySelector("#page-me .me-n").childNodes[0].nodeValue.trim()));
  await b.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
