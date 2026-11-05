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
  await p.goto("http://127.0.0.1:8794/?p2=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate((list) => {
    S.posts = []; S.cases = list; try { switchTab("cases"); } catch (e) {} try { renderCases(); } catch (e) {}
    window.__pd = [];
    document.addEventListener("pointerdown", e => {
      const t = e.target;
      window.__pd.push((t.id ? "#" + t.id : "") + "." + (t.className || t.tagName) + " btn=" + e.button);
    }, true);
    document.addEventListener("fullscreenchange", () => window.__pd.push("FS:" + !!document.fullscreenElement), true);
  }, CASES);
  await p.waitForTimeout(500);
  const title = await p.$("#caseGrid .case-card .c-title");
  await title.dblclick({ delay: 40 });
  for (const ms of [100, 300, 700, 1200]) {
    await p.waitForTimeout(ms);
    const s = await p.evaluate(() => ({
      cls: document.getElementById("viewer").className,
      open: document.getElementById("viewer").classList.contains("open"),
      fs: !!document.fullscreenElement,
      pd: (window.__pd || []).slice()
    }));
    console.log(ms, JSON.stringify(s));
  }
  await b.close();
})();
