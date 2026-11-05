/* 线上复现：触摸设备点卡片 / 点「查看完整求助」后，mf-fs 是否稳定存在 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const PHOTO = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8fb3c7"/></svg>').toString("base64");
const POST = { id: 9402, user: "爱河南99", flag: "CN", ava: "rabbit", time: "3小时前", title: "", text: "看到孩子参加科技竞赛比赛，我感到非常欣慰。大家支持吗？", type: "img", urg: 0, helps: 3, likes: 0, favs: 0, vis: 0, roses: [], comments: [], media: [{ kind: "img", url: PHOTO, thumbUrl: PHOTO }] };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("https://xn--gmqq09al6z.cn/index.html?r=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(post => { S.posts = [post]; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POST);
  await p.waitForTimeout(800);

  const snap = async (tag) => {
    const s = await p.evaluate(() => {
      const d = document.getElementById("r23Detail");
      return { open: d.classList.contains("open"), fs: d.classList.contains("mf-fs"), cls: d.className, fsEl: !!document.fullscreenElement };
    });
    console.log(tag, JSON.stringify(s));
  };
  /* A：点卡片文字（触摸） */
  const t = p.locator('#feed .card[data-id="9402"] .p-text').first();
  await t.tap();
  for (const ms of [200, 500, 900, 1500, 2500]) { await p.waitForTimeout(ms === 200 ? 200 : 400); await snap("A+" + ms); }
  await p.evaluate(() => { try { document.getElementById("r23DBack").click(); } catch (e) {} });
  await p.waitForTimeout(700);
  /* B：点「查看完整求助」按钮（触摸） */
  await p.locator('#feed .card[data-id="9402"] [data-r23detail]').first().tap();
  for (const ms of [300, 800, 1600, 2600]) { await p.waitForTimeout(400); await snap("B+" + ms); }
  await b.close();
})();
