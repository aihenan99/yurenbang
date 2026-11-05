const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const PHOTO = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8fb3c7"/></svg>').toString("base64");
const POST = { id: "9401", user: "爱河南99", flag: "CN", ava: "rabbit", time: "3小时前", title: "", text: "看到孩子参加科技竞赛比赛。", type: "img", urg: 0, helps: 3, likes: 0, favs: 0, vis: 0, roses: [], comments: [], media: [{ kind: "img", url: PHOTO, thumbUrl: PHOTO }] };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/index.html?dbg=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(post => { S.posts = [post]; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POST);
  await p.waitForTimeout(800);
  console.log(JSON.stringify(await p.evaluate(() => ({
    cards: document.querySelectorAll("#feed .card").length,
    ids: Array.from(document.querySelectorAll("#feed .card")).map(c => c.dataset.id),
    links: Array.from(document.querySelectorAll("#feed .card [data-r23detail]")).length,
    html: (document.querySelector("#feed .card") || {}).innerHTML ? document.querySelector("#feed .card").innerHTML.slice(0, 200) : null
  })), null, 1));
  await b.close();
})();
