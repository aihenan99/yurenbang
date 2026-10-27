const { chromium } = require("playwright-core");
const src = require("fs").readFileSync("temp/admin_jj_check.js", "utf8");
const STUB = eval("(" + src.slice(src.indexOf("const STUB = ") + 13, src.indexOf("async function newPage")).trim().replace(/;$/, "") + ")");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("console", m => { const t = m.text(); if (!/net::|sourcemap|DevTools/.test(t)) console.log("CON:", t.slice(0, 160)); });
  p.on("pageerror", e => console.log("ERR:", String(e.message).slice(0, 200)));
  await p.goto("http://127.0.0.1:8791/yurenbang-app.html", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  await p.evaluate(STUB(""));
  await p.evaluate(() => {
    /* 给桩的 from 加日志 */
    const real = window.YRB_CLOUD.client.database.from;
    window.YRB_CLOUD.client.database.from = function (t) {
      console.log("FROM " + t);
      const f = real(t);
      return new Proxy(f, { get(o, k) { return o[k]; } });
    };
    try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {}
  });
  await p.evaluate(() => YRB_CONSOLE.openAdmin());
  await p.waitForTimeout(1200);
  await p.evaluate(() => { document.querySelector('[data-adtab="tutor"]').click(); });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    cards: document.querySelectorAll(".jj-ad-item").length,
    dbrows: window.__JJ.db.yb_tutor_req.length,
    empty: (document.querySelector(".ad-empty") || {}).textContent || ""
  }));
  console.log("RESULT:", JSON.stringify(r));
  await b.close();
})();
