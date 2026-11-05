/* 视觉核验：后台「案例二次编辑」面板截图（2026-11-03） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8794/index.html";
const IMG = "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#EFD9C8"/><text x="160" y="96" font-size="20" text-anchor="middle" fill="#8A6A55">示意图</text></svg>'
).toString("base64");

const STUB = `
(function(){
  var CASES = [
    { id: 11, title: "孩子写作业拖拉怎么办", owner_name: "家长5855", type: "img",
      content_html: '<h3>先弄清拖拉的原因</h3><p>很多家长以为是懒，其实是畏难。作业一下子摆满桌，孩子不知道从哪下手，就本能的躲。</p><img data-yrb-media="0"><p>把作业拆成三段，每段十分钟，中间让他站起来走一走。完成一段就打个勾，比催十遍都管用。</p>',
      media: [{ kind: "img", path: "case/a.jpg", url: ${JSON.stringify(IMG)} }],
      created_at: new Date().toISOString() },
    { id: 12, title: "青春期不肯沟通", owner_name: "家长1111", type: "img",
      content_html: "<p>先别急着讲道理。</p>", media: [], created_at: new Date().toISOString() }
  ];
  function res(d){ return Promise.resolve({ data: d, error: null }); }
  function q(table){
    var rows = table === "yb_cases" ? CASES.slice() : [];
    var f = {
      select: function(){ return f; }, order: function(){ return f; }, limit: function(){ return f; },
      eq: function(k, v){ rows = rows.filter(function(r){ return String(r[k]) === String(v); }); return f; },
      maybeSingle: function(){ return res(rows[0] || null); },
      update: function(){ return f; }, insert: function(o){ return res(o); },
      delete: function(){ return { eq: function(){ return res(null); } }; },
      then: function(ok, bad){ return Promise.resolve({ data: rows, error: null }).then(ok, bad); }
    };
    return f;
  }
  window.toast = function(){};
  window.YRB_CLOUD = {
    enabled: function(){ return true; }, signedIn: function(){ return true; },
    who: function(){ return { id: "2110319594408247296", phone: "18000005855", name: "家长5855" }; },
    name: function(){ return "家长5855"; }, openLogin: function(){}, signOut: function(){ return Promise.resolve(); },
    loadCases: function(){}, updateCase: function(){ return Promise.resolve({ ok: true }); },
    client: { database: { from: q, rpc: function(fn){
      if (fn === "admin_guard_status") return res({ ok: true, is_set: true, fail_count: 0, locked_until: null });
      return res({ ok: true });
    } } }
  };
})();`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(BASE + "?shot=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2600);
  await p.evaluate(STUB);
  await p.evaluate(() => { try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {} });
  await p.evaluate(() => YRB_CONSOLE.openAdmin());
  await p.waitForSelector(".ad-tab", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);
  await p.click('[data-adtab="cases"]');
  await p.waitForTimeout(400);
  await p.screenshot({ path: "temp/adm-case-list.png" });
  await p.click('[data-ad="caseedit"][data-id="11"]');
  await p.waitForTimeout(900);
  await p.screenshot({ path: "temp/adm-case-edit.png" });
  console.log("ok", await p.evaluate(() => !document.getElementById("adCaseEdit").hidden));
  await b.close();
})();
