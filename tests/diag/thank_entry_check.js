const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { c ? (pass++, console.log("  ✅", n, extra)) : (fail++, console.log("  ❌", n, extra)); };
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
  await p.evaluate(() => {
    S.posts.unshift({ id: 9501, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "孩子不愿写作业怎么办？", likes: 0, liked: false, favs: 0, faved: false, helps: 2, kinds: ["study"], media: [], roses: [],
      comments: [{ user: "李妈妈", flag: "🇨🇳", ava: "bear", kind: "text", text: "先陪他列个计划表", likes: 0, liked: false },
                 { user: "王爸爸", flag: "🇨🇳", ava: "rabbit", kind: "voice", dur: "0:08", text: "", likes: 0, liked: false }] });
    S.posts.unshift({ id: 9502, mine: false, user: "另一位家长", flag: "🇨🇳", type: "img", tag: "求助", time: "刚刚",
      loc: "本地", text: "没人帮忙的帖子", likes: 0, liked: false, favs: 0, faved: false, helps: 0, kinds: ["study"], media: [], roses: [], comments: [] });
    renderFeed();
  });
  await p.waitForTimeout(500);

  const strips = await p.evaluate(() => [...document.querySelectorAll("#feed .card")].map(c => ({ id: c.dataset.id, has: !!c.querySelector("[data-act='thank']"), txt: (c.querySelector("[data-act='thank']") || {}).textContent?.replace(/\s+/g, " ").trim() })));
  ok("有帮忙的卡片出现答谢条", strips.find(x => x.id === "9501")?.has === true, JSON.stringify(strips.find(x => x.id === "9501")?.txt));
  ok("0 帮忙的卡片不出现", strips.find(x => x.id === "9502")?.has === false);

  console.log("=== 未登录点击 ===");
  await p.evaluate(() => document.querySelector('.card[data-id="9501"] [data-act="thank"]').click());
  await p.waitForTimeout(700);
  ok("未登录提示登录并拉起登录面板", await p.evaluate(() => document.querySelector("#loginSheet").classList.contains("open")));
  await p.evaluate(() => { const x = document.querySelector("#lgX"); x && x.click(); });
  await p.waitForTimeout(400);

  console.log("=== 模拟登录后 ===");
  await p.evaluate(() => { try { YRB_CLOUD.signedIn = () => true; } catch (e) {} });
  await p.evaluate(() => document.querySelector('.card[data-id="9501"] [data-act="thank"]').click());
  await p.waitForTimeout(600);
  const list = await p.evaluate(() => ({
    open: document.querySelector("#modal").classList.contains("open"),
    items: [...document.querySelectorAll("#mdCard .tk-item")].map(it => ({
      name: it.querySelector("b").textContent, quote: it.querySelector("i").textContent,
      btns: [...it.querySelectorAll(".tk-b")].map(x => x.textContent.trim())
    }))
  }));
  ok("答谢名单打开", list.open);
  ok("名单里有 2 位家长", list.items.length === 2, JSON.stringify(list.items.map(i => i.name)));
  ok("每位都有送玫瑰+送美食按钮", list.items.every(i => i.btns.length === 2 && /玫瑰/.test(i.btns[0]) && /美食/.test(i.btns[1])));
  ok("语音帮忙被正确描述", /语音/.test(list.items[1]?.quote || ""), list.items[1]?.quote);
  await p.screenshot({ path: "E:/育人帮/temp/thank_list.png" });

  // 送玫瑰
  const roseBefore = await p.evaluate(() => S.roses);
  await p.evaluate(() => document.querySelector('#mdCard [data-tk-rose="0"]').click());
  await p.waitForTimeout(600);
  ok("点送玫瑰 → 弹窗关闭且满屏玫瑰动画打开", await p.evaluate(() => !document.querySelector("#modal").classList.contains("open") && document.querySelector("#gift").classList.contains("open")));
  ok("玫瑰余额 +1", (await p.evaluate(() => S.roses)) === roseBefore + 1, `${roseBefore} → ${await p.evaluate(() => S.roses)}`);
  await p.screenshot({ path: "E:/育人帮/temp/thank_rose.png" });
  await p.evaluate(() => document.querySelector("#gift").classList.remove("open"));
  await p.waitForTimeout(300);

  // 送美食
  await p.evaluate(() => document.querySelector('.card[data-id="9501"] [data-act="thank"]').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('#mdCard [data-tk-food="1"]').click());
  await p.waitForTimeout(700);
  ok("点送美食 → 选菜面板打开（10 项）", await p.evaluate(() => { const s = document.querySelector("#fdSheet"); return !!(s && s.classList.contains("open")); }),
    "菜品数=" + await p.evaluate(() => document.querySelectorAll("#fdSheet .fd-card").length));
  await p.screenshot({ path: "E:/育人帮/temp/thank_food.png" });

  console.log(`\n===== 答谢入口测试：${pass} 通过 / ${fail} 失败 =====`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
