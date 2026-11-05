/* 视觉核验：案例广场筛选栏（去掉多余筛选后的版式） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", deviceScaleFactor: 2 });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/index.html?t=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(300);
  await p.evaluate(() => { try { switchTab("cases"); } catch (e) {} });
  await p.waitForTimeout(900);
  const info = await p.evaluate(() => {
    const t = document.querySelector("#caseTabs");
    return { btn: t ? Array.from(t.querySelectorAll(".ct")).map(x => x.textContent.trim()) : null,
             h: t ? t.getBoundingClientRect().height : null };
  });
  console.log(JSON.stringify(info));
  const el = await p.$("#page-cases .pg-head");
  await el.screenshot({ path: "temp/casetabs.png" });
  await p.screenshot({ path: "temp/casetabs-full.png" });
  await b.close();
})();
