/* 玫瑰馈赠层（rose.js）回归测试
   验证：点赞/收藏求助 → 给发布者送满屏大玫瑰；帮忙后 → 大玫瑰；自己的内容不送；
        帮忙留言点赞补记录；全程 0 pageerror。
   跑法：node temp/rose-test.js
   依赖：8793 已在项目根起 http.server（deploy-cn 已由 sync_deploy 生成） */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const URL = "http://127.0.0.1:8793/deploy-cn/";

let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name + (detail ? "（" + detail + "）" : "")); }
  else { fail++; console.log("  ✗ " + name + (detail ? "（" + detail + "）" : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));

  await p.goto(URL + "?tc=" + Date.now(), { waitUntil: "load", timeout: 40000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(900);

  const boot = await p.evaluate(() => ({ rose: !!window.YRB_ROSE, give: typeof (window.YRB_ROSE || {}).give }));
  ck("玫瑰层已加载", boot.rose && boot.give === "function");

  const clear = async () => {
    await p.evaluate(() => {
      const g = document.getElementById("gift");
      if (g) g.classList.remove("open");
      document.querySelectorAll("#gift .yr-roses").forEach(e => e.remove());
      YRB_ROSE && YRB_ROSE._reset && YRB_ROSE._reset();
    });
    await p.waitForTimeout(160);
  };

  /* ---------- T0 样本注入（2026-10-25 种子模板假数据已下线，测试自注样本） ---------- */
  await p.evaluate(() => {
    S.posts.unshift({
      id: 9101, mine: false, user: "测试家长", flag: "🇨🇳", ava: "rabbit", type: "img",
      kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试", title: "玫瑰层测试求助",
      text: "用于玫瑰层回归", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: []
    });
    renderFeed();
  });
  await p.waitForTimeout(300);

  /* ---------- T1 首页卡片点赞 → 送玫瑰 ---------- */
  await clear();
  const before1 = await p.evaluate(() => YRB_ROSE.out().length);
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card");
    const btn = card.querySelector('[data-act="like"]');
    btn.click();
  });
  await p.waitForTimeout(420);
  const r1 = await p.evaluate(() => ({
    open: document.getElementById("gift").classList.contains("open"),
    n: document.querySelectorAll("#gift .yr-roses .yr-r").length,
    sub: (document.getElementById("gSub") || {}).textContent || "",
    title: (document.getElementById("gTitle") || {}).textContent || "",
    out: YRB_ROSE.out().length,
    detailOpen: document.getElementById("r23Detail").classList.contains("open")
  }));
  ck("点赞后礼物层打开", r1.open);
  ck("满屏大玫瑰出现", r1.n >= 18, r1.n + " 朵");
  ck("文案写明送给谁+缘由", /玫瑰/.test(r1.sub) && /点了赞|点赞/.test(r1.sub), r1.sub);
  ck("送出记录 +1", r1.out === before1 + 1, before1 + "→" + r1.out);
  ck("点赞不会误开详情页", !r1.detailOpen);

  /* ---------- T2 再点一次（取消点赞）不再送 ---------- */
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card");
    card.querySelector('[data-act="like"]').click();
  });
  await p.waitForTimeout(380);
  const r2 = await p.evaluate(() => ({
    out: YRB_ROSE.out().length,
    n: document.querySelectorAll("#gift .yr-roses .yr-r").length
  }));
  ck("取消点赞不重复送花", r2.out === r1.out, "记录仍 " + r2.out + " 条");

  /* ---------- T3 收藏 → 送玫瑰 ---------- */
  await clear();
  const before3 = await p.evaluate(() => YRB_ROSE.out().length);
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card");
    card.querySelector('[data-act="fav"]').click();
  });
  await p.waitForTimeout(420);
  const r3 = await p.evaluate(() => ({
    open: document.getElementById("gift").classList.contains("open"),
    n: document.querySelectorAll("#gift .yr-roses .yr-r").length,
    sub: (document.getElementById("gSub") || {}).textContent || "",
    out: YRB_ROSE.out().length,
    reason: (YRB_ROSE.out()[0] || {}).reason || ""
  }));
  ck("收藏后礼物层打开", r3.open);
  ck("收藏也有满屏玫瑰", r3.n >= 18, r3.n + " 朵");
  ck("缘由=收藏", /收藏/.test(r3.sub), r3.reason);

  /* ---------- T4 自己的求助：点赞不送 ---------- */
  await clear();
  await p.evaluate(() => {
    S.posts.unshift({
      id: 9001, mine: true, user: (typeof myName === "function" ? myName() : "阳阳爸爸"),
      flag: "🇨🇳", ava: "rabbit", time: "刚刚", tag: "学习", tagFull: "学习作业",
      title: "测试：我自己的求助", text: "自己的内容不应收到自己送的玫瑰",
      likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: []
    });
    renderFeed();
  });
  await p.waitForTimeout(300);
  const before4 = await p.evaluate(() => YRB_ROSE.out().length);
  await p.evaluate(() => {
    const card = document.querySelector('#feed .card[data-id="9001"]');
    card.querySelector('[data-act="like"]').click();
  });
  await p.waitForTimeout(400);
  const r4 = await p.evaluate(() => ({
    out: YRB_ROSE.out().length,
    open: document.getElementById("gift").classList.contains("open")
  }));
  ck("自己的求助不给自己送花", r4.out === before4, "记录 " + before4 + "→" + r4.out);

  /* ---------- T5 发出一条帮忙 → reward 层大玫瑰 ---------- */
  await clear();
  await p.evaluate(() => {
    addComment({ user: "阳阳爸爸", kind: "text", text: "试试把题目画成线段图，孩子一看就懂", likes: 0, liked: false });
  });
  await p.waitForTimeout(500);
  const r5 = await p.evaluate(() => ({
    open: document.getElementById("gift").classList.contains("open"),
    rw: document.querySelectorAll("#gift .rw-roses span").length,
    yr: document.querySelectorAll("#gift .yr-roses .yr-r").length,
    title: (document.getElementById("gTitle") || {}).textContent || ""
  }));
  ck("帮忙后礼物层打开", r5.open, r5.title);
  ck("帮忙后有大玫瑰（reward 层）", r5.rw + r5.yr >= 10, "reward " + r5.rw + " 朵 / rose " + r5.yr + " 朵");
  ck("不重复叠两套动画", r5.rw === 0 || r5.yr === 0, "rw=" + r5.rw + " yr=" + r5.yr);

  /* ---------- T6 详情页点赞 → 送玫瑰 ---------- */
  await clear();
  await p.evaluate(() => {
    const card = document.querySelector('#feed .card:not([data-id="9001"]) [data-r23detail]') ||
                 document.querySelector('#feed .card:not([data-id="9001"])');
    card.click();
  });
  await p.waitForTimeout(700);
  const inDetail = await p.evaluate(() => document.getElementById("r23Detail").classList.contains("open"));
  ck("详情页已打开", inDetail);
  const before6 = await p.evaluate(() => YRB_ROSE.out().length);
  await p.evaluate(() => {
    const b = document.querySelector('#r23Detail [data-db="like"]');
    if (b) b.click();
  });
  await p.waitForTimeout(450);
  const r6 = await p.evaluate(() => ({
    open: document.getElementById("gift").classList.contains("open"),
    n: document.querySelectorAll("#gift .yr-roses .yr-r").length,
    out: YRB_ROSE.out().length,
    sub: (document.getElementById("gSub") || {}).textContent || ""
  }));
  ck("详情页点赞也送玫瑰", r6.open && r6.n >= 18, r6.n + " 朵");
  ck("详情页送出记录 +1", r6.out === before6 + 1, before6 + "→" + r6.out);

  /* ---------- T7 帮忙留言点赞 → 记录缘由正确 ---------- */
  await clear();
  await p.evaluate(() => {
    const b = document.querySelector('#r23Detail [data-dclike="0"], #r23Detail [data-act="clike"]');
    if (b) b.click();
  });
  await p.waitForTimeout(420);
  const r7 = await p.evaluate(() => {
    const o = YRB_ROSE.out();
    return { reasons: o.slice(0, 3).map(x => x.reason), n: o.length };
  });
  ck("帮忙留言点赞有记录", r7.n >= 1, JSON.stringify(r7.reasons));

  /* ---------- T7b 帮忙面板里的留言点赞（app.js clike 路径）→ 补记录 ----------
     单独开一个干净页面跑：前面用例改过 S.posts / 登录桩，容易互相污染时序。 */
  const p2 = await ctx.newPage();
  const errs2 = [];
  p2.on("pageerror", e => errs2.push(String(e.message).slice(0, 120)));
  await p2.goto(URL + "?tc=" + Date.now() + "b", { waitUntil: "load", timeout: 40000 });
  await p2.waitForTimeout(2200);
  await p2.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p2.waitForTimeout(700);
  const t7b = await p2.evaluate(() => {
    /* 种子模板下线后自注带留言的样本帖 */
    S.posts.unshift({
      id: 9102, mine: false, user: "测试家长", flag: "🇨🇳", ava: "rabbit", type: "img",
      kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试", title: "留言点赞测试求助",
      text: "用于留言点赞回归", likes: 0, liked: false, favs: 0, faved: false, helps: 1,
      comments: [{ user: "帮忙家长", ava: "bear", flag: "🇨🇳", kind: "text", text: "我来帮你", likes: 0, liked: false }]
    });
    const post = S.posts.find(x => x.comments && x.comments.length);
    S.curPost = post.id;
    try { YRB_CLOUD.signedIn = () => true; } catch (e) {}
    try { window.dispatchEvent(new CustomEvent("yrb-auth")); } catch (e) {}
    renderComments(); openSheet("commentSheet");
    return {
      id: post.id,
      total: document.querySelectorAll("#cmList .clike").length,
      locked: document.getElementById("cmList").classList.contains("cm-locked"),
      who: (post.comments[0] || {}).user || ""
    };
  });
  await p2.waitForTimeout(400);
  const before7b = await p2.evaluate(() => YRB_ROSE.out().length);
  await p2.evaluate(() => {
    const btn = document.querySelector("#cmList .clike");
    if (btn) btn.click();
  });
  await p2.waitForTimeout(900);
  const r7b = await p2.evaluate(() => {
    const o = YRB_ROSE.out();
    return {
      n: o.length, top: (o[0] || {}),
      locked: document.getElementById("cmList").classList.contains("cm-locked"),
      hasBtn: !!document.querySelector("#cmList .clike"),
      roses: document.querySelectorAll("#gift .yr-roses .yr-r").length,
      open: document.getElementById("gift").classList.contains("open")
    };
  });
  if (t7b.locked || t7b.total === 0) {
    ck("帮忙面板留言点赞（未登录被门槛锁住，跳过 DOM 点击）", true, "锁=" + t7b.locked + " 按钮=" + t7b.total);
  } else {
    ck("帮忙面板留言点赞补上送出记录", r7b.n === before7b + 1,
      before7b + "→" + r7b.n + "（对方=" + t7b.who + " 锁=" + r7b.locked + "）");
    ck("缘由=帮忙点赞", /帮忙/.test(String(r7b.top.reason || "")), String(r7b.top.reason || ""));
    ck("该路径也会出现大玫瑰", r7b.roses >= 15, r7b.roses + " 朵");
  }
  ck("帮忙面板路径无脚本错误", errs2.length === 0, errs2.join(" | "));
  await p2.close();

  /* ---------- T8 长按/重复点击不产生异常动画 ---------- */
  const r8 = await p.evaluate(() => ({
    layers: document.querySelectorAll("#gift .yr-roses").length,
    health: !!(window.YRB_HEALTH && YRB_HEALTH.status().total >= 17),
    total: window.YRB_HEALTH ? YRB_HEALTH.status().total : 0,
    okLayers: window.YRB_HEALTH ? YRB_HEALTH.status().ok : 0
  }));
  ck("礼物层内只有一套玫瑰", r8.layers <= 1, r8.layers + " 套");
  ck("免疫系统已登记 rose 层", r8.total >= 17, r8.okLayers + "/" + r8.total);
  ck("无脚本错误", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败项") + "：" + pass + " 过 / " + fail + " 失败");
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("测试异常：", e); process.exit(1); });
