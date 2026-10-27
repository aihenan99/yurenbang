/* 检测确认弹窗按钮是否被其它层遮挡（elementFromPoint），多场景验证 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";

async function probe(page, label) {
  const r = await page.evaluate(() => {
    const btn = document.querySelector("#r23SolveOk");
    if (!btn) return { err: "no button" };
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const stack = document.elementsFromPoint(cx, cy).slice(0, 5).map(e => e.id ? "#" + e.id : (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : e.tagName));
    return {
      modalOpen: document.querySelector("#modal").classList.contains("open"),
      hitsButton: !!(hit && hit.closest && hit.closest("#r23SolveOk")),
      topEl: hit ? (hit.id ? "#" + hit.id : (typeof hit.className === "string" && hit.className ? "." + hit.className.split(" ")[0] : hit.tagName)) : null,
      stack,
      openLayers: ["commentSheet", "r23Detail", "viewer", "r23Viewer", "gift", "funcAddSheet", "publishSheet", "drawer", "subSheet", "subpage", "region", "r23Review", "fdSheet", "fdInSheet", "fdWlSheet", "loginSheet"]
        .filter(id => { const el = document.getElementById(id); return el && (el.classList.contains("open") || el.classList.contains("show")); })
    };
  });
  console.log(`[${label}]`, JSON.stringify(r));
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1000);
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }

  // 注入我的求助
  await p.evaluate(() => {
    S.posts.unshift({ id: 9201, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "求助测试", likes: 0, liked: false, favs: 0, faved: false, helps: 2, kinds: ["study"], media: [], roses: [],
      comments: [{ user: "李妈妈", flag: "🇨🇳", ava: "bear", kind: "text", text: "多陪孩子聊聊", likes: 0, liked: false },
                 { user: "王爸爸", flag: "🇨🇳", ava: "rabbit", kind: "voice", dur: "0:08", text: "可以试试", likes: 0, liked: false }] });
    renderFeed();
  });
  await p.waitForTimeout(400);

  // 场景1：从列表卡片点「帮忙」打开帮忙面板，再进详情标记已解决（用户常见路径）
  await p.evaluate(() => document.querySelector('.card[data-id="9201"] [data-act="cm"]').click());
  await p.waitForTimeout(500);
  console.log("帮忙面板 open:", await p.evaluate(() => document.querySelector("#commentSheet").classList.contains("open")));
  // 从面板进入详情（点查看完整求助）
  await p.evaluate(() => { const s = document.querySelector("#commentSheet .sh-x"); s && s.click(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-r23detail="9201"]').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector(".r23-solve").click());
  await p.waitForTimeout(400);
  await probe(p, "场景1 详情内弹确认框");

  // 场景2：详情页 + 帮忙面板同时打开（先开面板再从面板打开详情）
  await p.evaluate(() => { const c = document.querySelector('#mdCard [data-x="close"]'); c && c.click(); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { S.curPost = 9201; openSheet("commentSheet"); if (typeof renderComments === "function") renderComments(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector(".r23-solve").click());
  await p.waitForTimeout(400);
  await probe(p, "场景2 面板+详情叠加");

  await b.close();
  console.log("DONE");
})().catch(e => { console.error("FATAL", e); process.exit(1); });
