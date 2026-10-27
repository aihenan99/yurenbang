const { chromium } = require("playwright-core");
const src = require("fs").readFileSync("temp/admin_jj_check.js", "utf8");
const m = src.match(/const STUB = ( Childhood|[\s\S]*?);\r?\n\r?\nasync function newPage/);
const STUB = eval("(" + src.slice(src.indexOf("const STUB = ") + "const STUB = ".length, src.indexOf("async function newPage")).trim().replace(/;$/, "") + ")");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("pageerror", e => console.log("ERR:", String(e.message).slice(0, 200)));
  await p.goto("http://127.0.0.1:8791/yurenbang-app.html", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  await p.evaluate(STUB(""));
  await p.evaluate(() => { try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {} });
  await p.evaluate(() => YRB_CONSOLE.openAdmin());
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({
    body: document.querySelector("#adBody").textContent.slice(0, 120),
    tabs: document.querySelectorAll(".ad-tab").length
  }));
  console.log("BODY:", r.body.replace(/\s+/g, " "), "| tabs:", r.tabs);
  await p.click('[data-adtab="tutor"]');
  await p.waitForTimeout(500);
  const r2 = await p.evaluate(() => ({
    cards: document.querySelectorAll(".jj-ad-item").length,
    empty: (document.querySelector(".ad-empty") || {}).textContent || "",
    calls: (window.__JJ && Object.keys(window.__JJ.calls).map(k => k + ":" + window.__JJ.calls[k].length)) || null
  }));
  console.log("TUTOR TAB:", JSON.stringify(r2));
  await b.close();
})();
