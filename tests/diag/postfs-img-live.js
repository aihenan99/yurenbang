/* 2026-11-03 晚 用户反馈两条：
   ① 点求助卡片上的照片（红圈）没反应 —— 以前 img 被排除，点图片等于点空气
   ② 进详情后左边多出半截旧画面（原生全屏退出时视口重算把详情层挤偏）
   断言：
   I1 卡片照片可点
   I2 点照片 → 详情打开 + 全屏 + 自动朗读
   I3 全屏层几何：铺满视口（fixed 生效）
   I4 页面无横向溢出（不会有「左边漏一条」的物理条件）
   I5 全屏中点照片不退出全屏（防误触）
   I6 关闭详情 → 全屏类收回
   I7 ♥ 按钮仍不进全屏（回归）
   I8 原生全屏没有被调用（requestFullscreen 桩应保持 0 次） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='800'><rect width='600' height='800' fill='#c9d6e8'/><circle cx='300' cy='400' r='120' fill='#7c93b3'/></svg>");

const POSTS = [
  { id: 9101, user: "测试家长", title: "孩子参加科技竞赛", text: "看到孩子参加科技竞赛比赛。我感觉到非常欣慰。大家支持吗？",
    likes: 3, favs: 1, helps: 2, time: "10 分钟前", ava: "rabbit", tag: "求助", type: "img",
    media: [{ url: IMG, thumbUrl: IMG }],
    comments: [], roses: [], vis: 0, urg: 1 },
  { id: 9102, user: "另一位家长", title: "孩子不肯自己睡", text: "五岁了还要大人陪睡，一关灯就哭，怎么办？",
    likes: 0, favs: 0, helps: 0, time: "刚刚", ava: "rabbit", tag: "求助",
    comments: [], roses: [], vis: 0, urg: 1 }
];

const STUB = () => {
  function makeWav() {
    const sr = 8000, n = sr * 8;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: "audio/wav" });
  }
  window.__tts = [];
  const orig = window.fetch;
  window.fetch = function (u) {
    const url = String(u);
    if (url.indexOf("/yrbtts") > -1) {
      window.__tts.push(decodeURIComponent((url.match(/t=([^&]*)/) || ["", "?"])[1]).slice(0, 24));
      return Promise.resolve(new Response(makeWav(), { status: 200 }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
  /* 原生全屏桩：真机上就是这个 API 退出时把视口重算，导致「左边两个画面」。
     现在本层不再调它，计数应保持 0 */
  window.__fsCalls = 0;
  try {
    Element.prototype.requestFullscreen = function () { window.__fsCalls++; return Promise.resolve(); };
    document.documentElement.requestFullscreen = function () { window.__fsCalls++; return Promise.resolve(); };
  } catch (e) {}
};

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));

  await p.goto("http://127.0.0.1:8794/index.html?pfi=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(list => {
    S.posts = list;
    try { switchTab("home"); } catch (e) {}
    try { renderFeed(); } catch (e) {}
  }, POSTS);
  await p.waitForTimeout(800);

  const st = () => p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    const r = d.getBoundingClientRect();
    const h = document.documentElement;
    const btn = d.querySelector(".r23-dhead .mf-tts");
    return {
      open: d.classList.contains("open"), fs: d.classList.contains("mf-fs"),
      btnOn: !!(btn && btn.classList.contains("on")),
      tts: (window.__tts || []).length,
      cur: (function () { try { return String(S.curPost || ""); } catch (e) { return "?"; } })(),
      rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      vw: window.innerWidth, vh: window.innerHeight,
      overX: h.scrollWidth - h.clientWidth,
      fsCalls: window.__fsCalls || 0
    };
  });

  const hasImg = await p.evaluate(() => {
    const c = document.querySelector('#feed .card[data-id="9101"] .m-imgs img');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ck("I1 卡片照片已渲染且可见", !!hasImg && hasImg.w > 100 && hasImg.h > 60, JSON.stringify(hasImg));

  /* —— I2 点照片 → 全屏 + 朗读（用坐标点，命中真实元素，跟手指一样） —— */
  const box = await p.locator('#feed .card[data-id="9101"] .m-imgs').first().boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(1200);
  const s2 = await st();
  ck("I2 点照片 → 详情打开 + 全屏 + 自动朗读",
    s2.open && s2.fs && s2.cur === "9101" && s2.tts >= 1 && s2.btnOn, JSON.stringify(s2));

  ck("I3 全屏层铺满视口（fixed 生效）",
    s2.rect.l === 0 && s2.rect.t === 0 && s2.rect.w === s2.vw && s2.rect.h === s2.vh,
    JSON.stringify({ rect: s2.rect, vw: s2.vw, vh: s2.vh }));

  ck("I4 页面无横向溢出（不会左缘漏一条）", s2.overX <= 1, "overX=" + s2.overX);

  /* —— I5 全屏中点照片：不退出 —— */
  const t5 = s2.tts;
  const db = await p.locator("#r23Detail .r23-dimgs").first().boundingBox();
  await p.mouse.click(db.x + db.width / 2, Math.min(db.y + 80, 700));
  await p.waitForTimeout(700);
  const s5 = await st();
  ck("I5 全屏中点照片不退出全屏", s5.fs && s5.open, JSON.stringify({ fs: s5.fs, open: s5.open }));

  /* —— I6 关闭 → 收回 —— */
  await p.evaluate(() => { document.getElementById("r23DBack").click(); });
  await p.waitForTimeout(600);
  const s6 = await st();
  ck("I6 关闭详情 → 全屏类收回", !s6.open && !s6.fs, JSON.stringify({ open: s6.open, fs: s6.fs }));

  /* —— I7 ♥ 按钮回归 —— */
  await p.locator('#feed .card[data-id="9101"] .pa-btn.like').first().click();
  await p.waitForTimeout(700);
  const s7 = await st();
  ck("I7 点♥按钮不进全屏", !s7.open && !s7.fs, JSON.stringify({ open: s7.open, fs: s7.fs }));

  /* —— I8 全程没调原生全屏 —— */
  ck("I8 未调用原生 requestFullscreen", s7.fsCalls === 0, "calls=" + s7.fsCalls);

  console.log("\n" + pass + "/" + (pass + fail) + " 通过  （tts " + s2.tts + "→" + t5 + "）");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
