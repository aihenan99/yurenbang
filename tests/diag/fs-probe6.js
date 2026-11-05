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
  p.on("console", m => { const t = m.text(); if (/fs|FS|full/i.test(t)) console.log("CONSOLE", t); });
  await p.goto("http://127.0.0.1:8794/?p6=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate((list) => {
    S.posts = []; S.cases = list; try { switchTab("cases"); } catch (e) {} try { renderCases(); } catch (e) {}
    window.__l = [];
    const v = document.getElementById("viewer");
    new MutationObserver(() => window.__l.push(Date.now() % 100000 + " cls=" + v.className)).observe(v, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("fullscreenchange", () => window.__l.push(Date.now() % 100000 + " FS=" + !!document.fullscreenElement), true);
    document.addEventListener("webkitfullscreenchange", () => window.__l.push(Date.now() % 100000 + " WFS"), true);
  }, CASES);
  await p.waitForTimeout(300);
  const title = await p.$("#caseGrid .case-card .c-title");
  await title.dblclick({ delay: 40 });
  await p.waitForTimeout(900);
  console.log("after card dblclick:", JSON.stringify(await p.evaluate(() => ({ l: window.__l, cls: document.getElementById("viewer").className, fsEl: !!document.fullscreenElement }))));
  await b.close();
})();
