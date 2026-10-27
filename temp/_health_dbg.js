const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const reqs = [];
  p.on("response", r => { if (/health|upgrade|guard/.test(r.url())) reqs.push(r.status() + " " + r.url().split("/").pop()); });
  p.on("pageerror", e => console.log("ERR:", String(e).slice(0,200)));
  p.on("console", m => { if (m.type()==="error") console.log("CONSOLE-ERR:", m.text().slice(0,200)); });
  await p.goto("http://127.0.0.1:8796/yurenbang-app.html?t=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  const info = await p.evaluate(() => ({
    hasHealth: !!window.YRB_HEALTH,
    hasGuard: !!window.YRB_GUARD,
    hasUpgrade: !!window.YRB_UPGRADE,
    scriptCount: document.querySelectorAll('script[src^="assets/"]').length,
    lastScripts: [...document.querySelectorAll('script[src^="assets/"]')].slice(-4).map(s=>s.getAttribute("src")),
    healthTag: !!document.querySelector('script[src*="health"]'),
    resources: performance.getEntriesByType("resource").filter(r=>/health|upgrade|guard/.test(r.name)).map(r=>r.name.split("/").pop()+" dur="+Math.round(r.duration))
  }));
  console.log(JSON.stringify(info, null, 1));
  console.log("响应:", reqs);
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
