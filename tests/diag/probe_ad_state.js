const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("console", m => { if (/warn|error|家教|后台/.test(m.text())) console.log("CON:", m.text().slice(0, 200)); });
  p.on("pageerror", e => console.log("ERR:", String(e.message).slice(0, 200)));
  await p.goto("http://127.0.0.1:8791/yurenbang-app.html", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  await p.evaluate(() => {
    window.YRB_CLOUD = {
      enabled(){ return true; }, signedIn(){ return true; },
      who(){ return { id: "2110319594408247296", phone: "18037345855", name: "家长5855" }; },
      openLogin(){}, signOut(){ return Promise.resolve(); },
      client: { database: {
        rpc(){ return Promise.resolve({ data: { ok: true, is_set: true, fail_count: 0, locked_until: null }, error: null }); },
        from(t){ console.log("FROM:", t); const f = { select(){ return f; }, order(){ return f; }, limit(){ return f; }, eq(){ return f; }, maybeSingle(){ return Promise.resolve({ data: null, error: null }); } }; return f; }
      } }
    };
    try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {}
  });
  await p.evaluate(() => YRB_CONSOLE.openAdmin());
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => document.querySelector("#adBody").textContent.slice(0, 200));
  console.log("BODY:", r);
  await b.close();
})();
