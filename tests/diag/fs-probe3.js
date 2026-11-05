const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CASES = [
  { id: "c1", t: "自己的孩子自己爱", by: "测试家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
    content_html: "<h3>自己的孩子自己爱</h3><p>很多家长把全部精力放在孩子身上。</p>", media: [] },
  { id: "c2", t: "一分钟跳绳示范", by: "测试家长", ava: "rabbit", type: "video", dur: "0:20",
    helps: 1, likes: 2, favs: 0, media: [{ kind: "video", url: "" }] }
];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/?p3=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate((list) => {
    S.posts = []; S.cases = list; try { switchTab("cases"); } catch (e) {} try { renderCases(); } catch (e) {}
    window.__log = [];
    const v = document.getElementById("viewer");
    new MutationObserver(() => window.__log.push(Date.now() % 100000 + " cls=" + v.className)).observe(v, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("pointerdown", e => window.__log.push(Date.now() % 100000 + " pd " + (e.target.id || e.target.className || e.target.tagName)), true);
  }, CASES);
  await p.waitForTimeout(400);
  const title = await p.$("#caseGrid .case-card .c-title");
  await title.dblclick({ delay: 40 });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({
    log: window.__log,
    cls: document.getElementById("viewer").className,
    doc: !!document.querySelector("#vwBody .yrb-doc-body"),
    bodyLen: (document.querySelector("#vwBody") || {}).innerHTML?.length,
    tts: (window.__tts || []).length,
    cased: window.YRB_CASED && window.YRB_CASED.version
  }));
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
