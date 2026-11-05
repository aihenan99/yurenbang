/* 视觉核验：全屏阅读模式截图（双击案例文字后） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CASES = [
  { t: "自己的孩子自己爱", by: "爱河南99", ava: "rabbit", type: "img", helps: 3, likes: 5, favs: 1,
    content_html: "<h3>自己的孩子自己爱</h3>" +
      "<p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。孩子能感受到大人的紧绷，你越焦虑，他越不安。</p>" +
      "<p>先把自己安顿好，才有余力接住孩子的情绪。可以从小事开始：每天留十分钟给自己，喝杯热水、走一小段路。</p>" +
      "<p>第三段：长期的自我消耗会变成对孩子的隐性苛责，明明很爱，说出口的却是挑剔。</p>", media: [] }
];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", deviceScaleFactor: 2 });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/?shot=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate((list) => { S.posts = []; S.cases = list; try { switchTab("cases"); } catch (e) {} try { renderCases(); } catch (e) {} }, CASES);
  await p.waitForTimeout(500);
  await p.locator("#caseGrid .case-card .c-title").first().dblclick({ delay: 40 });
  await p.waitForTimeout(900);
  await p.screenshot({ path: "temp/fsread-full.png" });
  console.log("cls=", await p.evaluate(() => document.getElementById("viewer").className));
  await b.close();
})();
