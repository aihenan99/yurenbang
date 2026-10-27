const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }
  // 造一条我的求助（有两位家长帮忙）
  await p.evaluate(() => {
    S.posts.unshift({ id: 9401, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "孩子不愿写作业怎么办？", likes: 0, liked: false, favs: 0, faved: false, helps: 2, kinds: ["study"], media: [], roses: [],
      comments: [{ user: "李妈妈", flag: "🇨🇳", ava: "bear", kind: "text", text: "可以先陪他列个计划表", likes: 0, liked: false },
                 { user: "王爸爸", flag: "🇨🇳", ava: "rabbit", kind: "text", text: "我们家是分段完成，中间休息", likes: 0, liked: false }] });
    renderFeed();
  });
  await p.waitForTimeout(400);

  // 1) 详情页：帮忙条目上的「答谢大餐」按钮
  await p.evaluate(() => document.querySelector('[data-r23detail="9401"]').click());
  await p.waitForTimeout(600);
  const detailBtns = await p.evaluate(() => [...document.querySelectorAll("#r23CmList .gift")].map(b => b.textContent.trim()));
  console.log("详情页每条帮忙的按钮:", JSON.stringify(detailBtns));
  await p.screenshot({ path: "E:/育人帮/temp/food_entry_detail.png" });

  // 2) 点「答谢大餐」→ 面板是否打开、几道菜
  await p.evaluate(() => document.querySelector("#r23CmList .gift").click());
  await p.waitForTimeout(600);
  console.log("答谢面板打开:", await p.evaluate(() => { const s = document.querySelector("#fdSheet"); return !!(s && s.classList.contains("open")); }),
    "| 菜品数:", await p.evaluate(() => document.querySelectorAll("#fdSheet .fd-card").length),
    "| 卡片文字:", await p.evaluate(() => [...document.querySelectorAll("#fdSheet .fd-card")].map(c => c.querySelector("b").textContent).join("/")));
  await p.screenshot({ path: "E:/育人帮/temp/food_panel.png" });
  await p.evaluate(() => { const x = document.querySelector("#fdX"); x && x.click(); });
  await p.waitForTimeout(400);

  // 3) 点帮忙条目 → 名片 → 送份美食
  await p.evaluate(() => document.querySelector("#r23CmList .cm-item .cm-name").click());
  await p.waitForTimeout(500);
  console.log("名片按钮:", await p.evaluate(() => [...document.querySelectorAll("#mdCard .r23-hp-b")].map(b => b.textContent.trim())));
  await p.screenshot({ path: "E:/育人帮/temp/food_entry_card.png" });
  await p.evaluate(() => { const c = document.querySelector('#mdCard [data-x="close"]'); c && c.click(); });
  await p.waitForTimeout(300);

  // 4) 我的页：收到的答谢
  await p.evaluate(() => { document.querySelector("#r23DBack").click(); switchTab("me"); });
  await p.waitForTimeout(700);
  const meRows = await p.evaluate(() => [...document.querySelectorAll("#meMenu .me-item")].map(b => b.textContent.replace(/\s+/g, " ").trim()).slice(0, 9));
  console.log("我的页菜单:", JSON.stringify(meRows));
  await p.screenshot({ path: "E:/育人帮/temp/food_entry_me.png" });

  await b.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
