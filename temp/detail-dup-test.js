/* detail-dup-test：详情页去重复标题/去地区行 + 朗读去重（2026-10-25 用户反馈） */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?ddup=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  /* 注入两条：A=自动截断标题（与正文重复） B=真实独立标题 */
  await p.evaluate(() => {
    S.posts.unshift(
      { id: 9601, mine: false, user: "爱河南99", flag: "🇨🇳", ava: "rabbit", type: "img", kinds: ["outdoor"],
        time: "58分钟前", tag: "辅导", tagFull: "辅导", age: "6-12岁",
        title: "今天带孩子到公园去玩，他非要坐…",
        text: "今天带孩子到公园去玩，他非要坐船，我觉得危险 并且价格比较高，请问大家我该怎么办",
        loc: "北京 · 🇨🇳 附近", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [] },
      { id: 9602, mine: false, user: "测试家长", flag: "🇨🇳", ava: "cat", type: "img", kinds: ["study"],
        time: "刚刚", tag: "学习", tagFull: "学习",
        title: "周末遛娃好去处",
        text: "想问问大家周末都带孩子去哪里玩，有没有推荐的地方",
        loc: "上海 · 🇨🇳 附近", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [] });
    renderFeed();
  });
  await p.waitForTimeout(400);
  const openDetail = (id) => p.evaluate(id2 => {
    const card = document.querySelector("#feed .card[data-id='" + id2 + "']");
    (card.querySelector(".r23-detail-link") || card).click();
  }, id);
  const back = () => p.evaluate(() => document.getElementById("r23DBack").click());

  /* T1 重复标题：详情页不渲染标题行（无 …），无地区行 */
  await openDetail(9601);
  await p.waitForTimeout(600);
  const t1 = await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    const body = d.querySelector(".r23-dbody");
    return {
      open: d.classList.contains("open"),
      hasEllipsis: (body.textContent || "").indexOf("…") >= 0,
      sub: !!d.querySelector(".r23-dbody .p-sub"),
      bodyText: (body.querySelector(".r23-dcard .p-text:last-of-type") || {}).textContent || ""
    };
  });
  ck("重复标题不再渲染（无 …）", t1.open && !t1.hasEllipsis, JSON.stringify(t1).slice(0, 160));
  ck("详情页头部地区行已移除", !t1.sub, "p-sub 仍存在");

  /* T1b 徽章缩小生效 */
  const t1b = await p.evaluate(() => {
    const tag = document.querySelector("#r23Detail .r23-dcard .p-tag");
    return tag ? getComputedStyle(tag).fontSize : "";
  });
  ck("详情页徽章缩小为 10.5px", t1b === "10.5px", t1b);
  await back();
  await p.waitForTimeout(400);

  /* T2 独立标题：正常保留 */
  await openDetail(9602);
  await p.waitForTimeout(600);
  const t2 = await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    return {
      titleShown: (d.textContent || "").indexOf("周末遛娃好去处") >= 0,
      textShown: (d.textContent || "").indexOf("有没有推荐的地方") >= 0
    };
  });
  ck("独立标题正常显示", t2.titleShown && t2.textShown, JSON.stringify(t2));
  await back();
  await p.waitForTimeout(400);

  /* T3 卡片朗读去重：stub YRB_MEDIAFULL.speak 捕获文本 */
  await p.evaluate(() => {
    window.__ttsTexts = [];
    const old = window.YRB_MEDIAFULL;
    window.YRB_MEDIAFULL = Object.assign({}, old, { speak: (t) => { window.__ttsTexts.push(String(t)); return true; } });
  });
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9601']");
    const btn = card.querySelector("[data-tts]") || card.querySelector(".p-side [data-tts]");
    btn.click();
  });
  await p.waitForTimeout(400);
  const t3 = await p.evaluate(() => (window.__ttsTexts || []).join("||"));
  ck("卡片朗读不含重复标题", t3.length > 0 && t3.indexOf("…") < 0 && t3.indexOf("今天带孩子到公园去玩，他非要坐船") === 0, t3.slice(0, 80));

  /* T4 独立标题的卡片朗读仍带标题 */
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9602']");
    const btn = card.querySelector("[data-tts]") || card.querySelector(".p-side [data-tts]");
    btn.click();
  });
  await p.waitForTimeout(400);
  const t4 = await p.evaluate(() => (window.__ttsTexts || []).slice(-1)[0] || "");
  ck("独立标题朗读保留标题", t4.indexOf("周末遛娃好去处。") === 0, t4.slice(0, 80));

  ck("无页面报错", errs.length === 0, errs.join(" | "));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
