const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CASES = [
  { id: "c1", t: "自己的孩子自己爱", by: "测试家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
    content_html: "<h3>自己的孩子自己爱</h3><p>很多家长把全部精力放在孩子身上。</p>", media: [] }
];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/?p8=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate((list) => { S.posts = []; S.cases = list; try { switchTab("cases"); } catch (e) {} try { renderCases(); } catch (e) {} }, CASES);
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    window.__t0 = Date.now(); window.__l = [];
    const v = document.getElementById("viewer");
    new MutationObserver(() => window.__l.push((Date.now() - window.__t0) + " cls=" + v.className)).observe(v, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("pointerdown", e => window.__l.push((Date.now() - window.__t0) + " pd " + (e.target.id || e.target.className || e.target.tagName)), true);
  });
  await p.locator("#caseGrid .case-card .c-title").first().dblclick({ delay: 40 });
  await p.waitForTimeout(1500);
  console.log("1st:", JSON.stringify(await p.evaluate(() => window.__l.splice(0))));
  await p.locator("#vwBody .yrb-doc-body p").first().dblclick({ delay: 40 });
  await p.waitForTimeout(1200);
  console.log("2nd:", JSON.stringify(await p.evaluate(() => window.__l.splice(0))));
  await p.locator("#vwBody .yrb-doc-body p").first().dblclick({ delay: 40 });
  await p.waitForTimeout(1200);
  console.log("3rd:", JSON.stringify(await p.evaluate(() => window.__l.splice(0))), "cls=", await p.evaluate(() => document.getElementById("viewer").className));
  await b.close();
})();
