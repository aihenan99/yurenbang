const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("console", m => console.log("CON:", m.text().slice(0, 160)));
  p.on("pageerror", e => console.log("ERR:", String(e.message).slice(0, 200)));
  await p.goto("http://127.0.0.1:8791/yurenbang-app.html", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  await p.evaluate(() => {
    var DB = { yb_posts: [], yb_comments: [], yb_tutor_req: [{ id: 101, grade: "三年级" }], yb_settings: [{ key: "jiaojiao_qr", value: "" }] };
    window.__DB = DB;
    function res(d){ return Promise.resolve({ data: d, error: null }); }
    function q(table){
      var rows = (DB[table] || []).slice();
      console.log("FROM " + table + " rows=" + rows.length);
      var f = {
        select(){ return f; }, order(){ return f; }, limit(){ return f; },
        eq(k, v){ rows = rows.filter(r => String(r[k]) === String(v)); return f; },
        maybeSingle(){ console.log("  maybeSingle ->", JSON.stringify(rows[0] || null).slice(0, 60)); return res(rows[0] || null); },
        delete(){ return { eq(){ return res(null); } }; },
        insert(o){ return res(o); }
      };
      return f;
    }
    window.YRB_CLOUD = {
      enabled(){ return true; }, signedIn(){ return true; },
      who(){ return { id: "2110319594408247296", phone: "18037345855", name: "家长5855" }; },
      openLogin(){}, signOut(){ return Promise.resolve(); },
      client: { database: { rpc(){ return res({ ok: true, is_set: true }); }, from: q } }
    };
    try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {}
  });
  await p.evaluate(() => YRB_CONSOLE.openAdmin());
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => document.querySelectorAll(".jj-ad-item").length);
  console.log("cards:", r);
  await b.close();
})();
