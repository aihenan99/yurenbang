/* 求助全屏「点照片进入」的目视截图：点卡片照片后 1.3s 截一张，用于人工核对版式 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const path = require("path");
const IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900'><rect width='1200' height='900' fill='#b9c9dd'/><circle cx='600' cy='430' r='210' fill='#7c93b3'/><rect x='0' y='700' width='1200' height='200' fill='#94a9c4'/></svg>");
const POSTS = [{ id: 9101, user: "爱河南99", title: "孩子参加科技竞赛", text: "看到孩子参加科技竞赛比赛。我感觉到非常欣慰。大家支持吗？",
  likes: 3, favs: 1, helps: 3, time: "4 小时前", ava: "rabbit", tag: "求助", type: "img",
  media: [{ url: IMG, thumbUrl: IMG }], comments: [], roses: [], vis: 0, urg: 1 }];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/index.html?shot=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(list => { S.posts = list; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POSTS);
  await p.waitForTimeout(800);
  const box = await p.locator('#feed .card[data-id="9101"] .m-imgs').first().boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(1300);
  await p.screenshot({ path: path.join(__dirname, "shot-postfs-img.png") });
  console.log("saved", path.join(__dirname, "shot-postfs-img.png"));
  await b.close();
})();
