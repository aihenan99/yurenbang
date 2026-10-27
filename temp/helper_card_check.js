/* 帮忙者名片 + 送美食 / 送玫瑰 + 压缩 Worker 自检 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? (pass++, console.log("  ✅ " + n + (extra ? " ｜ " + extra : ""))) : (fail++, console.log("  ❌ " + n + (extra ? " ｜ " + extra : ""))); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [], failed = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("requestfailed", r => failed.push(r.url()));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  if (await page.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null); })) {
    await page.click("#splash"); await page.waitForTimeout(700);
  }
  /* 模拟已登录（只为了让 gate 放行；不碰真实会话） */
  await page.evaluate(() => { try { window.YRB_CLOUD.signedIn = () => true; window.YRB_CLOUD.who = () => ({ id: "u-test", name: "测试家长" }); window.YRB_CLOUD.name = () => "测试家长"; } catch (e) {} });

  console.log("=== A. 验证码倒计时 ===");
  const cd = await page.evaluate(async () => {
    const r = await fetch("assets/cloud.js", { cache: "no-store" });
    const t = await r.text();
    return /let left=20/.test(t);
  });
  check("重发等待已改为 20 秒", cd);

  console.log("=== B. 帮忙者名片 ===");
  /* 造一条「我发布的求助」+ 两条帮忙 */
  await page.evaluate(() => {
    const p = { id: 9001, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "孩子写作业总拖拉，想听听大家的办法", likes: 0, liked: false, favs: 0, faved: false,
      helps: 2, clouds: false, kinds: ["study"], media: [], roses: ["李妈妈"],
      comments: [
        { user: "李妈妈", flag: "🇨🇳", ava: "rabbit", kind: "text", text: "试试番茄钟，25 分钟一段中间休息 5 分钟", likes: 2, liked: false },
        { user: "王爸爸", flag: "🇨🇳", ava: "bear", kind: "voice", dur: "0:11", likes: 1, liked: false }
      ] };
    S.posts.unshift(p);
    renderFeed();
  });
  await page.waitForTimeout(500);
  const link = await page.locator('[data-r23detail="9001"]').count();
  check("卡片上出现「查看完整求助」", link > 0);
  await page.evaluate(() => document.querySelector('[data-r23detail="9001"]').click());
  await page.waitForTimeout(500);
  const items = await page.locator("#r23CmList .cm-item").count();
  check("详情页帮忙列表有 2 条", items === 2, "实际 " + items);
  const chips = await page.evaluate(() => [...document.querySelectorAll("#r23CmList .cm-name")].map(n => getComputedStyle(n, "::after").content).join("|"));
  check("帮忙条目带「名片」提示", /名片/.test(chips), chips);

  await page.evaluate(() => document.querySelector("#r23CmList .cm-item .cm-name").click());
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => {
    const c = document.querySelector("#mdCard");
    return { open: document.querySelector("#modal").classList.contains("open"), txt: c ? c.textContent : "", food: !!document.querySelector("#r23HpFood"), rose: !!document.querySelector("#r23HpRose") };
  });
  check("点条目弹出名片", card.open && /帮忙的家长/.test(card.txt));
  check("名片显示帮忙者昵称", /李妈妈/.test(card.txt));
  check("名片显示这条帮忙内容", /番茄钟/.test(card.txt));
  check("名片有「送份美食」按钮", card.food);
  check("名片有「送朵玫瑰」按钮", card.rose);
  await page.screenshot({ path: "E:/育人帮/temp/helper_card.png" });

  console.log("=== C. 送玫瑰 ===");
  const roseBefore = await page.evaluate(() => S.roses);
  await page.evaluate(() => document.querySelector("#r23HpRose").click());
  await page.waitForTimeout(900);
  const rose = await page.evaluate(() => ({
    roses: S.roses,
    c: S.posts.find(p => p.id === 9001).comments[0].rosed,
    list: (S.posts.find(p => p.id === 9001).roses || []).length,
    gift: !!document.querySelector("#gift.open"),
    modal: document.querySelector("#modal").classList.contains("open")
  }));
  check("玫瑰计入本地玫瑰数", rose.roses === roseBefore + 1, roseBefore + " → " + rose.roses);
  check("该条帮忙标记为已送玫瑰", rose.c === true);
  check("求助的玫瑰墙 +1", rose.list === 2);
  check("满屏玫瑰动画触发", rose.gift);
  check("名片已关闭", !rose.modal);

  console.log("=== F. 底部帮忙面板入口 + 帖子不会串 ===");
  /* 造第二条求助，并先把它的详情打开再返回（制造 curDetail 残留） */
  await page.evaluate(() => {
    S.posts.unshift({ id: 9002, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "第二条求助", likes: 0, liked: false, favs: 0, faved: false, helps: 1, kinds: ["study"], media: [], roses: [],
      comments: [{ user: "张阿姨", flag: "🇨🇳", ava: "bear", kind: "text", text: "多陪孩子聊聊", likes: 0, liked: false }] });
    renderFeed();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-r23detail="9002"]').click());
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector("#r23DBack").click());
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('.card[data-id="9001"] [data-act="cm"]').click());
  await page.waitForTimeout(400);
  const sheetN = await page.evaluate(() => document.querySelectorAll("#cmList .cm-item").length);
  check("底部帮忙面板有 2 条", sheetN === 2, "实际 " + sheetN);
  await page.evaluate(() => document.querySelector("#cmList .cm-item .cm-name").click());
  await page.waitForTimeout(350);
  const who = await page.evaluate(() => (document.querySelector("#mdCard") || {}).textContent || "");
  check("面板里点条目打开对应的人", /李妈妈/.test(who), who.replace(/\s+/g, " ").slice(0, 30));
  check("不会串到上一条帖子的人", !/张阿姨/.test(who));
  await page.evaluate(() => document.querySelector("#mdCard [data-x='close']").click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector("#commentSheet .sh-x").click());
  await page.waitForTimeout(500);
  console.log("  [debug] 卡片:", await page.evaluate(() => [...document.querySelectorAll("#feed .card")].slice(0,4).map(c => c.dataset.id + ":" + !!c.querySelector("[data-r23detail]")).join(",")));

  console.log("=== D. 送美食 ===");
  await page.evaluate(() => document.querySelector('[data-r23detail="9001"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll("#r23CmList .cm-item")[1].querySelector(".cm-name").click());
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector("#r23HpFood").click());
  await page.waitForTimeout(500);
  const fd = await page.evaluate(() => ({
    open: !!document.querySelector("#fdSheet") && document.querySelector("#fdSheet").classList.contains("open"),
    to: (document.querySelector("#fdToName") || {}).textContent || "",
    cards: document.querySelectorAll("#fdSheet .fd-card").length
  }));
  check("答谢面板打开", fd.open);
  check("受赠人是这条帮忙的家长", fd.to === "王爸爸", fd.to);
  check("面板含 9 道菜 + 玫瑰", fd.cards === 10, "实际 " + fd.cards);
  await page.screenshot({ path: "E:/育人帮/temp/helper_food.png" });

  console.log("=== E. 压缩 Worker ===");
  const w = await page.evaluate(async () => {
    const r = await fetch("assets/img-worker.js", { cache: "no-store" });
    return { status: r.status, len: (await r.text()).length };
  });
  check("img-worker.js 可访问", w.status === 200 && w.len > 500, w.status + " / " + w.len + "B");

  console.log("\nJS 错误:", errs.length ? errs.join("\n") : "无");
  console.log("失败请求:", failed.length ? failed.join("\n") : "无");
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
