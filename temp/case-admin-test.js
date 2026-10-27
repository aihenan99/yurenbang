/* 2026-10-25 回归：①后台案例管理（列表+删除）②卡片布局（侧边列下移/头部缩小/底部行紧凑/视频通栏） */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const URL = "http://127.0.0.1:8794/?caseadm=" + Date.now();
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  console.log((ok ? "✅" : "❌") + " " + name + (extra ? "  [" + extra + "]" : ""));
  ok ? pass++ : fail++;
}
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2400);

  /* ======== 一、卡片布局 ======== */
  const L = await p.evaluate(async () => {
    try { enterApp(); } catch (e) {}
    /* 造一张带视频、有帮助数的云端卡片 */
    S.posts.unshift({
      id: 990001, __cloud: true, user: "测试家长", flag: "🇨🇳", time: "1小时前", loc: "北京·附近",
      tag: "学习辅导", text: "布局回归测试正文", type: "video", dur: "0:08",
      media: [{ kind: "video", url: "data:video/mp4;base64,AAAA", path: "p/1.mp4" }],
      helps: 2, likes: 0, favs: 0
    });
    renderFeed();
    await new Promise(r => setTimeout(r, 700));              /* 等 access 层装饰出 .p-side */
    const card = document.querySelector('#feed .card[data-id="990001"]');
    if (!card) return { err: "no card" };
    const cs = getComputedStyle(card);
    const side = card.querySelector(".p-side");
    const sideTop = side ? parseFloat(getComputedStyle(side).top) : -1;
    const cardH = card.offsetHeight;
    const ava = card.querySelector(".m-who .m-ava");
    const sub = card.querySelector(".p-sub");
    const subSt = sub ? getComputedStyle(sub) : null;
    const noHead = !card.querySelector(".p-head");
    const hasWho = !!card.querySelector(".m-who");
    const acts = card.querySelector(".p-acts");
    const help = card.querySelector(".p-acts .pa-help");
    const pill = card.querySelector(".p-acts .helps-pill");
    const link = card.querySelector(".p-acts .r23-detail-link");
    const vid = card.querySelector(".m-realvideo");
    return {
      sideOk: !!side && !!side.querySelector(".pa-btn.like") && !!side.querySelector("[data-tts]"),
      sideCentered: side ? Math.abs((sideTop + side.offsetHeight / 2) - cardH / 2) < cardH * 0.25 : false,
      padR: cs.paddingRight,
      avaW: ava ? ava.offsetWidth : -1,
      noHead: noHead,
      hasWho: hasWho,
      subNowrap: subSt ? subSt.whiteSpace.includes("nowrap") : false,
      subHidden: subSt ? (subSt.overflow === "hidden") : false,
      rowH: help ? help.offsetHeight : -1,
      rowW: help ? help.offsetWidth : -1,
      pillShow: !!pill && pill.offsetHeight < 30,
      linkW: link ? link.offsetWidth : -1,
      vidFull: vid ? vid.getBoundingClientRect().width >= card.getBoundingClientRect().width - 2 : false,
      vidW: vid ? Math.round(vid.getBoundingClientRect().width) : -1
    };
  });
  if (L.err) { console.log("❌ 布局测试没跑到：" + L.err); fail++; }
  else {
    ck("侧边列存在且含 ♥/⭐/🔊", L.sideOk);
    ck("侧边列垂直居中下移", L.sideCentered, "top=" + L.sideTop);
    /* 2026-10-25 抖音式改版：媒体卡右侧 padding 62→14px，作者信息改叠画面左下（.m-who 34px 头像） */
    ck("媒体卡右侧收紧（14px，画面更满）", L.padR === "14px", L.padR);
    ck("作者头像叠画面左下（34px）", L.avaW === 34, String(L.avaW));
    ck("媒体卡无头部行（作者信息走 .m-who）", L.noHead && L.hasWho);
    ck("帮忙按钮恢复矮宽（不被挤成竖条）", L.rowH > 0 && L.rowH <= 40 && L.rowW >= 60, `h=${L.rowH} w=${L.rowW}`);
    ck("帮忙数 pill 单行", L.pillShow);
    ck("查看完整求助不再占满整行", L.linkW > 0 && L.linkW < 220, "w=" + L.linkW);
    ck("视频通栏铺满卡片宽度", L.vidFull, "w=" + L.vidW);
  }

  /* ======== 二、后台案例管理 ======== */
  const A = await p.evaluate(async () => {
    /* 模拟云 SDK：yb_cases 返回两条案例 */
    const casesData = [
      { id: 501, title: "案例A·亲子沟通", type: "img", owner_name: "家长甲", created_at: new Date().toISOString(), media: [{ kind: "image", path: "case/a.jpg" }] },
      { id: 502, title: "案例B·英语启蒙PPT", type: "ppt", owner_name: "家长乙", created_at: new Date().toISOString(), media: [{ kind: "file", path: "case/b.pptx", name: "b.pptx" }] }
    ];
    function q(data) {
      const o = { select() { return o; }, order() { return o; }, eq() { return o; }, limit() { return Promise.resolve({ data }); }, maybeSingle() { return Promise.resolve({ data: null }); } };
      return o;
    }
    const delCalls = [];
    /* 在真实 YRB_CLOUD 上叠加桩：只换 client/deleteCase，其余方法保留（否则其他层会炸） */
    const orig = window.YRB_CLOUD || {};
    window.YRB_CLOUD = Object.assign({}, orig, {
      enabled: () => true,
      signedIn: () => true,
      who: () => ({ id: "2110319594408247296", phone: "18037345855", name: "管理员" }),
      client: { database: { from(t) { return q(t === "yb_cases" ? casesData : []); } } },
      deleteCase(id, media) { delCalls.push([id, media]); return Promise.resolve({ ok: true }); },
      loadCases() { /* noop */ }
    });
    window.YRB_ADMINGUARD = { needed: () => true, unlocked: () => true, prompt() {} };
    window.confirm = () => true;
    try { YRB_CONSOLE.isAdmin = () => true; } catch (e) {}
    try { YRB_CONSOLE.openAdmin(); } catch (e) { return { err: "openAdmin: " + e.message }; }
    await new Promise(r => setTimeout(r, 600));
    /* 切到案例页签 */
    const tab = document.querySelector('[data-adtab="cases"]');
    if (!tab) return { err: "no cases tab" };
    tab.click();
    await new Promise(r => setTimeout(r, 400));
    const items = document.querySelectorAll("#adBody .ad-item");
    /* 点删除案例B */
    const btn = document.querySelector('[data-ad="casedel"][data-id="502"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 600));
    return {
      tabLabel: tab.textContent,
      itemCount: items.length,
      hasA: document.querySelector("#adBody .ad-item .ad-t").textContent.indexOf("案例A") >= 0 || items.length >= 2,
      deleted: delCalls.map(c => c[0]),
      mediaPassed: delCalls.length && Array.isArray(delCalls[0][1])
    };
  });
  if (A.err) { console.log("❌ 后台测试没跑到：" + A.err); fail++; }
  else {
    ck("后台出现「案例管理」页签", (A.tabLabel || "").indexOf("案例") >= 0, A.tabLabel);
    ck("案例列表渲染（2 条）", A.itemCount === 2, "n=" + A.itemCount);
    ck("删除调用带上了素材（供清理文件）", A.mediaPassed, JSON.stringify(A.deleted));
    ck("删除调用了 deleteCase(502)", A.deleted.map(String).indexOf("502") >= 0, JSON.stringify(A.deleted));
  }
  ck("页面零脚本错误", errs.length === 0, errs.join(" | ").slice(0, 120));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
