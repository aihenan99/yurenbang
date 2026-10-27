const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  p.on("console", m => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 200)); });
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }
  await p.evaluate(() => switchTab("cases"));
  await p.waitForTimeout(500);
  // 逐类型点击卡片
  for (const f of ["all", "img", "ppt", "video"]) {
    await p.evaluate(fl => { const t = document.querySelector(`#caseTabs .ct[data-f="${fl}"]`); t && t.click(); }, f);
    await p.waitForTimeout(250);
    const n = await p.evaluate(() => document.querySelectorAll("#caseGrid .case-card").length);
    const r = await p.evaluate(() => {
      const c = document.querySelector("#caseGrid .case-card");
      if (!c) return { none: true };
      c.click();
      return { open: document.querySelector("#viewer").classList.contains("open"),
        title: document.querySelector("#vwTitle").textContent,
        bodyLen: document.querySelector("#vwBody").innerHTML.length };
    });
    console.log(`[${f}] 卡片数=${n} →`, JSON.stringify(r));
    if (r.open) { await p.evaluate(() => document.querySelector("#vwX").click()); await p.waitForTimeout(200); }
  }
  // 检查 z-index / 遮挡
  const z = await p.evaluate(() => {
    const t = document.querySelector(`#caseTabs .ct[data-f="ppt"]`); t && t.click();
    const c = document.querySelector("#caseGrid .case-card");
    c.click();
    const v = document.querySelector("#viewer");
    const card = v.querySelector(".vw-card") || v;
    const r = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + 20, 830));
    return { open: v.classList.contains("open"), z: getComputedStyle(v).zIndex, hit: hit ? (hit.id || hit.className || hit.tagName) : null };
  });
  console.log("PPT 点击遮挡检查:", JSON.stringify(z));
  await b.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
