/* 内容保护层回归测试（protect.js）
   覆盖：默认拦截、白名单放行、管理员豁免、核心功能不被误伤、打印与长按 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const BASE = "http://127.0.0.1:8794/";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  [" + extra + "]" : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({
    viewport: { width: 412, height: 900 },
    serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));

  await p.goto(BASE + "?pv=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  /* ---------- T0 样本注入（2026-10-25 种子模板假数据已下线，测试自注图片帖样本） ---------- */
  await p.evaluate(() => {
    S.posts.unshift({
      id: 9401, mine: false, user: "测试家长", flag: "🇨🇳", ava: "rabbit", type: "img",
      kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试", title: "保护层测试求助",
      text: "用于保护层回归", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [],
      media: [{ kind: "img", url: "assets/icon-192.png" }]
    });
    renderFeed();
  });
  await p.waitForTimeout(400);

  /* ---------- T1 层就位 ---------- */
  const t1 = await p.evaluate(() => ({
    layer: !!window.YRB_PROTECT,
    guard: document.documentElement.classList.contains("yrb-guard"),
    admin: !!(window.YRB_CONSOLE && YRB_CONSOLE.isAdmin && YRB_CONSOLE.isAdmin()),
    health: !!(window.YRB_HEALTH && YRB_HEALTH.status().layers || []).length
  }));
  ck("保护层已加载", t1.layer, JSON.stringify(t1));
  ck("非管理员默认加锁（html.yrb-guard）", t1.guard === true, String(t1.guard));

  /* ---------- T2 右键菜单被拦 ---------- */
  const t2 = await p.evaluate(() => {
    const el = document.querySelector("#feed .card") || document.body;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    return { ok: el.dispatchEvent(ev) === false, prevented: ev.defaultPrevented };
  });
  ck("正文右键被拦截", t2.ok, JSON.stringify(t2));

  /* ---------- T3 快捷键：全选/复制/另存/源码/开发者工具 ---------- */
  const t3 = await p.evaluate(() => {
    function k(key, mod) {
      const ev = new KeyboardEvent("keydown", Object.assign({ key: key, bubbles: true, cancelable: true }, mod || { ctrlKey: true }));
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    }
    return {
      a: k("a"), c: k("c"), x: k("x"),
      s: k("s"), p: k("p"), u: k("u"),
      i: k("i", { ctrlKey: true, shiftKey: true }),
      f12: k("F12", { ctrlKey: false })
    };
  });
  ck("Ctrl+A 全选被拦", t3.a);
  ck("Ctrl+C 复制被拦", t3.c);
  ck("Ctrl+X 剪切被拦", t3.x);
  ck("Ctrl+S 另存被拦", t3.s);
  ck("Ctrl+P 打印被拦", t3.p);
  ck("Ctrl+U 源码被拦", t3.u);
  ck("Ctrl+Shift+I 开发者工具被拦", t3.i);
  ck("F12 被拦", t3.f12);

  /* ---------- T4 正文 copy 事件被拦 ---------- */
  const t4 = await p.evaluate(() => {
    const ev = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
    document.querySelector("#feed").dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  ck("正文复制事件被拦截", t4 === true, String(t4));

  /* ---------- T5 输入框必须正常（验证码/昵称/搜索） ---------- */
  const t5 = await p.evaluate(() => {
    const inp = document.querySelector("input[type=text], input:not([type]), #searchInput, #q, input");
    if (!inp) return { skip: true };
    const cs = getComputedStyle(inp).userSelect || getComputedStyle(inp).webkitUserSelect;
    const ev = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
    inp.dispatchEvent(ev);
    const cev = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
    inp.dispatchEvent(cev);
    return { sel: cs, keyOk: !ev.defaultPrevented, copyOk: !cev.defaultPrevented };
  });
  ck("输入框可选中（user-select:text）", t5.skip || /text/.test(String(t5.sel)), String(t5.sel));
  ck("输入框内 Ctrl+A 不被拦", t5.skip || t5.keyOk);
  ck("输入框内复制不被拦", t5.skip || t5.copyOk);

  /* ---------- T6 分享面板白名单（转发链接必须能复制） ---------- */
  const t6 = await p.evaluate(() => {
    try { YRB_CONSOLE.openShare(); } catch (e) {}
    const layer = document.getElementById("shareLayer");
    const url = document.getElementById("slUrl");
    if (!layer || !url) return { skip: true };
    const cs = getComputedStyle(url).userSelect || getComputedStyle(url).webkitUserSelect;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    url.dispatchEvent(ev);
    const cev = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
    url.dispatchEvent(cev);
    return { open: layer.classList.contains("open"), sel: cs, menu: ev.defaultPrevented, copy: cev.defaultPrevented };
  });
  ck("分享面板可打开", t6.skip || t6.open);
  /* .sl-url span 原本就是 user-select:all（点一下全选链接），属于「可复制」 */
  ck("分享链接可选中复制", t6.skip || (/text|all/.test(String(t6.sel)) && t6.copy === false), JSON.stringify(t6));
  ck("分享面板内不拦右键（便于复制链接）", t6.skip || t6.menu === false);

  /* ---------- T7 图片禁长按保存，但点图仍能看大图 ---------- */
  const t7 = await p.evaluate(() => {
    const img = document.querySelector("#feed img");
    const pe = img ? getComputedStyle(img).pointerEvents : "";
    const drag = img ? getComputedStyle(img).webkitUserDrag : "";
    return { hasImg: !!img, pe: pe, drag: drag };
  });
  ck("正文图片禁用指针事件（防长按保存）", !t7.hasImg || t7.pe === "none", JSON.stringify(t7));

  /* T7b 点击穿透：详情页点图看大图依赖「点击落到 .di 而不是 img」 */
  const t7b = await p.evaluate(() => {
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:20px;top:120px;width:200px;height:120px;z-index:9999";
    wrap.innerHTML = '<div class="di" id="hitDi" style="width:100%;height:100%">' +
      '<img id="hitImg" src="assets/icon-192.png" style="width:100%;height:100%;display:block"></div>';
    document.body.appendChild(wrap);
    var di = document.getElementById("hitDi");
    var box = di.getBoundingClientRect();
    var hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    var out = {
      tag: hit ? hit.tagName : "",
      closestDi: !!(hit && hit.closest && hit.closest(".di")),
      qrPass: (function () { var q = document.querySelector(".jj-qr"); return q ? getComputedStyle(q).pointerEvents : "skip"; })()
    };
    wrap.remove();
    return out;
  });
  ck("图片点击穿透到容器（看大图不受影响）", t7b.closestDi, JSON.stringify(t7b));
  ck("二维码保留可长按保存（转发工具）", t7b.qrPass === "auto" || t7b.qrPass === "skip", String(t7b.qrPass));

  /* 打开一个图片帖 → 点图 → 大图查看器应打开 */
  const t8 = await p.evaluate(() => {
    const post = (window.S && S.posts || []).find(x => x.type === "img" || (x.media || []).length);
    if (!post) return { skip: true };
    try { openDetail(post.id); } catch (e) { return { err: String(e.message) }; }
    return { id: post.id };
  });
  await p.waitForTimeout(900);
  const t8b = await p.evaluate(() => {
    const di = document.querySelector("#r23Detail .di");
    if (!di) return { skip: true, hasDetail: !!document.querySelector("#r23Detail.open") };
    const box = di.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  });
  if (t8b.skip) {
    ck("详情页图片点击（无图可测，跳过）", true, JSON.stringify(t8b));
  } else {
    await p.mouse.click(t8b.x, t8b.y);
    await p.waitForTimeout(600);
    const t8c = await p.evaluate(() => ({
      viewer: !!(document.getElementById("r23Viewer") || {}).classList &&
        document.getElementById("r23Viewer").classList.contains("open"),
      big: !!document.querySelector("#r23Big img")
    }));
    ck("图片禁用指针后仍能点开大图（功能未瘫）", t8c.viewer && t8c.big, JSON.stringify(t8c));
    await p.evaluate(() => { const v = document.getElementById("r23Viewer"); if (v) v.classList.remove("open"); });
  }

  /* ---------- T9 点赞等核心交互仍正常 ---------- */
  await p.evaluate(() => {
    const d = document.getElementById("r23Detail"); if (d) d.classList.remove("open");
    document.getElementById("gift").classList.remove("open");
  });
  await p.waitForTimeout(300);
  const t9 = await p.evaluate(() => {
    const card = document.querySelector("#feed .card");
    const btn = card && card.querySelector('[data-act="like"]');
    const before = (S.posts[0] || {}).likes || 0;
    if (btn) btn.click();
    return { hasBtn: !!btn, before: before };
  });
  await p.waitForTimeout(600);
  const t9b = await p.evaluate(() => ({
    likes: (S.posts[0] || {}).likes || 0,
    gift: document.getElementById("gift").classList.contains("open")
  }));
  ck("点赞仍可点击（保护层不拦交互）", t9.hasBtn && (t9b.likes > t9.before || t9b.gift), JSON.stringify(t9b));
  await p.evaluate(() => { document.getElementById("gift").classList.remove("open"); });

  /* ---------- T10 打印时不出正文 ---------- */
  await p.emulateMedia({ media: "print" });
  await p.waitForTimeout(200);
  const t10 = await p.evaluate(() => {
    const app = document.querySelector("#app");
    const cs = app ? getComputedStyle(app) : {};
    return { visibility: cs.visibility, display: cs.display };
  });
  await p.emulateMedia({ media: "screen" });
  ck("打印模式下正文不可见（只留提示）", t10.visibility === "hidden", JSON.stringify(t10));

  /* ---------- T11 管理员豁免 ---------- */
  const t11 = await p.evaluate(() => {
    const orig = window.YRB_CONSOLE && YRB_CONSOLE.isAdmin;
    try { YRB_CONSOLE.isAdmin = function () { return true; }; } catch (e) {}
    YRB_PROTECT.refresh();
    const guard = document.documentElement.classList.contains("yrb-guard");
    const pass = document.documentElement.classList.contains("yrb-pass");
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.querySelector("#feed").dispatchEvent(ev);
    const cev = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
    document.querySelector("#feed").dispatchEvent(cev);
    const sel = getComputedStyle(document.querySelector("#feed .card") || document.body).userSelect;
    /* 还原 */
    try { YRB_CONSOLE.isAdmin = orig; } catch (e) {}
    YRB_PROTECT.refresh();
    return { guard: guard, pass: pass, menu: ev.defaultPrevented, copy: cev.defaultPrevented, sel: sel };
  });
  ck("管理员身份时自动解锁（html.yrb-guard 移除）", t11.guard === false && t11.pass === true, JSON.stringify(t11));
  ck("管理员右键不被拦", t11.menu === false);
  ck("管理员复制不被拦", t11.copy === false);
  ck("管理员可选中正文文本", /text|auto/.test(String(t11.sel)), String(t11.sel));

  const t11b = await p.evaluate(() => ({
    guard: document.documentElement.classList.contains("yrb-guard"),
    admin: YRB_PROTECT.state().admin
  }));
  ck("退出管理员后自动重新加锁", t11b.guard === true && t11b.admin === false, JSON.stringify(t11b));

  /* ---------- T12 健康面板收录保护层 ---------- */
  const t12 = await p.evaluate(() => {
    if (!window.YRB_HEALTH) return { skip: true };
    const st = YRB_HEALTH.status();
    const ids = YRB_HEALTH.layers();
    return {
      has: ids.indexOf("protect") >= 0,
      state: (st.detail && st.detail.protect && st.detail.protect.state) || "",
      total: st.total, ok: st.ok
    };
  });
  ck("免疫系统已收录 protect 层", t12.skip || (t12.has && t12.state === "ok"), JSON.stringify(t12));

  ck("无脚本报错", errs.length === 0, errs.join(" | "));

  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常:", e.message); process.exit(2); });
