"use strict";
/* 回归：卡片操作行点击不被悬浮层截走（2026-11-13 复核「帮忙栏目点了没反应」）
 *
 * 背景与本次改动：
 *   病根之一是 #mfAuto 跟读胶囊（z92，离底 172px）压在卡片操作行上，把 tap 截走。
 *   当时加了「遮挡即淡出」兜底；随后用户又要求「不自动阅读」，自动朗读整体下线，
 *   胶囊（buildAutoPill）在 AUTO_READ=false 时根本不注入 —— 根本原因消失，遮挡兜底
 *   作为历史代码保留（autoPill 为 null 时全部早退）。
 *
 * 所以本脚本的口径改为「当前形态下的等价回归」：
 *   ① 页面上不再有 #mfAuto（也就没有它遮挡点击的可能）
 *   ② 操作行（🤝 帮忙 / ♥ / 📄 查看完整求助）在原来那条带区里点击照常生效
 *   ③ 点卡片正文照常进详情（pfDown 不吞点击）
 *
 * 注意：信息流一旦重渲染（renderFeed）会清掉注入的卡，所以每步点击前都重新 ensure 一次。
 *
 * 跑法：先起 8796（源码站），node tests/diag/pill_unblock_test.js
 */
const fs = require("fs"), path = require("path");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => fs.existsSync(p));
let pass = 0, fail = 0;
function ok(name, cond, extra) { cond ? pass++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); }

/* 幂等注入测试卡：把操作行放到离底约 172px（当年胶囊中心线） */
function ensureCard() {
  const f = document.querySelector("#feed");
  if (!f) return { ok: false, err: "no feed" };
  let d = document.querySelector("#feed .card[data-id='9901']");
  if (!d) {
    const sp = document.createElement("div");
    sp.style.height = "420px"; sp.id = "spacer9900";
    if (!document.getElementById("spacer9900")) f.appendChild(sp);
    d = document.createElement("div");
    d.className = "card"; d.dataset.id = "9901";
    d.innerHTML = '<div class="p-text">测试求助正文，点这里进详情。</div>' +
      '<div class="p-acts">' +
      '<button class="pa-btn like" data-act="like">♥ <span class="n">1</span></button>' +
      '<button class="pa-btn fav" data-act="fav">⭐ <span class="n">2</span></button>' +
      '<span class="helps-pill" data-act="cm">🤝 3 个帮忙</span>' +
      '<button class="pa-help" data-act="cm">🤝 帮忙</button>' +
      '<button class="r23-detail-link" data-r23detail="9901">📄 查看完整求助<span class="ar">›</span></button>' +
      '</div>';
    f.appendChild(d);
  }
  if (!window.__hit) window.__hit = { helps: 0, like: 0, detailLink: 0 };
  /* 桩帖要进 S.posts：点正文走 pfOpen → [data-r23detail].click() → app.js openDetail(id)，
     列表里没有这条帖时 openDetail 会静默返回，详情永远打不开（测试会误判成「点击被吞」） */
  try {
    if (!S.posts.some(x => String(x.id) === "9901")) {
      S.posts.push({ id: 9901, title: "测试求助标题", text: "测试求助正文，点这里进详情。", user: "测试家长",
        ava: "rabbit", time: Date.now(), likes: 1, favs: 2, helps: 3, comments: [] });
    }
  } catch (e) {}
  const ph = document.querySelector("#page-home");
  const ar = d.querySelector(".p-acts").getBoundingClientRect();
  const want = window.innerHeight - 172;
  if (Math.abs(ar.top + ar.height / 2 - want) > 30) ph.scrollTop = Math.max(0, ph.scrollTop + ar.top + ar.height / 2 - want);
  return { ok: true, actsTop: Math.round(d.querySelector(".p-acts").getBoundingClientRect().top) };
}

(async () => {
  const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await c.addInitScript("Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await p.goto("http://127.0.0.1:8796/yurenbang-app.html?" + Date.now(), { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  /* ---------- ① 胶囊已下线 ---------- */
  const pill = await p.evaluate(() => ({
    inDom: !!document.getElementById("mfAuto"),
    autoRead: (() => { try { return YRB_MEDIAFULL.autoRead.enabled(); } catch (e) { return "?"; } })(),
  }));
  ok("① 跟读胶囊已下线（#mfAuto 不存在）", pill.inDom === false && pill.autoRead === false, pill);

  /* 点击记账（capture 阶段，先于各业务的 stopPropagation） */
  await p.evaluate(() => {
    window.__hit = { helps: 0, like: 0, detailLink: 0 };
    document.addEventListener("click", e => {
      const t = e.target.closest && e.target.closest(".p-acts [data-act='cm'],.pa-btn.like,[data-r23detail]");
      if (!t) return;
      if (t.getAttribute("data-act") === "cm") window.__hit.helps++;
      else if (t.classList.contains("like")) window.__hit.like++;
      else if (t.hasAttribute("data-r23detail")) window.__hit.detailLink++;
    }, true);
  });

  /* ---------- ② 点 🤝 帮忙 ---------- */
  const inj1 = await p.evaluate(ensureCard);
  ok("② 测试卡片与操作行已就位（离底约 172px 带区）", inj1.ok === true, inj1);
  await p.waitForTimeout(400);
  const hp = await p.evaluate(() => {
    try {
      const r = document.querySelector("#feed .card[data-id='9901'] .helps-pill").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 };
    } catch (e) { return { ok: false }; }
  });
  if (hp.ok) await p.touchscreen.tap(hp.x, hp.y);
  await p.waitForTimeout(1000);
  const st2 = await p.evaluate(() => ({
    hit: window.__hit,
    detailOpen: !!(document.querySelector("#r23Detail") || {}).classList && document.querySelector("#r23Detail").classList.contains("open"),
  }));
  ok("③ 点「🤝 N 个帮忙」→ click 送达（不被截走，也不误开详情）", st2.hit.helps >= 1 && !st2.detailOpen, st2);

  /* ---------- ③ 操作行每个按钮的中心点是否都命中自己（无悬浮层遮挡） ----------
     比「点一下看计数」更直接：elementFromPoint 就是浏览器真实的命中测试，
     当年 #mfAuto 压在上面时这里会返回胶囊而不是按钮。 */
  await p.evaluate(() => {
    try { closeSheet && closeSheet("commentSheet"); } catch (e) {}
    const s = document.querySelector("#commentSheet"); if (s) s.classList.remove("open");
    /* drMask 是通用遮罩（app.js 由 closeSheet/openDrawer 控制）：只摘 .open 不会让它收起，
       留着的话会盖住操作行，elementFromPoint 会命中遮罩而非按钮（假阳性失败） */
    const m = document.getElementById("drMask"); if (m) m.classList.remove("show");
    const d = document.getElementById("drawer"); if (d) d.classList.remove("open");
  });
  await p.waitForTimeout(300);
  await p.evaluate(ensureCard);
  await p.waitForTimeout(400);
  const cover = await p.evaluate(() => {
    const acts = document.querySelectorAll("#feed .card[data-id='9901'] .p-acts > *");
    const out = { total: acts.length, blocked: [] };
    for (const b of acts) {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const self = el && (el === b || b.contains(el));
      if (!self) out.blocked.push({ el: b.className || b.tagName, top: el ? (el.id || el.className || el.tagName) : "null" });
    }
    return out;
  });
  ok("④ 操作行每个按钮中心都命中自己（无悬浮层截走点击）", cover.total >= 3 && cover.blocked.length === 0, cover);

  /* ---------- ④ 点正文 → 进详情 ---------- */
  await p.evaluate(ensureCard);
  await p.waitForTimeout(300);
  const tp = await p.evaluate(() => {
    try {
      const r = document.querySelector("#feed .card[data-id='9901'] .p-text").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 };
    } catch (e) { return { ok: false }; }
  });
  if (tp.ok) await p.touchscreen.tap(tp.x, tp.y);
  await p.waitForTimeout(1500);
  const st4 = await p.evaluate(() => ({
    detailOpen: !!(document.querySelector("#r23Detail") || {}).classList && document.querySelector("#r23Detail").classList.contains("open"),
    hits: window.__hit,
  }));
  ok("⑤ 点卡片正文 → 进详情（pfDown 不吞点击）", st4.detailOpen === true, st4);

  ok("⑥ 无页面异常", errs.length === 0, errs.slice(0, 3));

  console.log("==== " + pass + " 通过 / " + fail + " 失败 ====");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
