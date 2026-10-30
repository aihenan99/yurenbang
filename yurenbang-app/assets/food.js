/* =========================================================
   育人帮 · 美食答谢层（food.js）
   需求（2026-10-18）：对帮了自己的人，可以送"餐饮系硬菜"动画答谢——
   红烧鲤鱼 / 烧鸡 / 烤鸭 / 红烧肘子 / 烤生蚝 / 烤鱿鱼 / 蒜香鲍鱼 / 麻辣小龙虾 / 帝王蟹，
   送出瞬间飘满屏幕；收到礼物的人打开时也满屏飘（体验帮助带来的快感）。
   实现（增强层约定，不改 app.js/refine23 结构）：
     1) 截获两处「送玫瑰」按钮 → 打开答谢面板（9 道菜 + 🌹 玫瑰）
     2) 送出：满屏菜品飞舞 + 蒸汽 + 掌声（复用 reward.js applause）
     3) 收到：我的页「收到的答谢」入口 + 打开时满屏回放 + 云端已读
     4) 云端 yb_gifts（登录后入库）；离线/未登录只放动画并记本地
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS_OUT = "yrb_food_out_v1";

  const FOODS = [
    { k: "fish",     n: "红烧鲤鱼",   img: "assets/gifts/fish.webp" },
    { k: "chicken",  n: "烧鸡",       img: "assets/gifts/chicken.webp" },
    { k: "duck",     n: "烤鸭",       img: "assets/gifts/duck.webp" },
    { k: "knuckle",  n: "红烧肘子",   img: "assets/gifts/knuckle.webp" },
    { k: "oyster",   n: "连排烤生蚝", img: "assets/gifts/oyster.webp" },
    { k: "squid",    n: "连排烤鱿鱼", img: "assets/gifts/squid.webp" },
    { k: "abalone",  n: "蒜香鲍鱼",   img: "assets/gifts/abalone.webp" },
    { k: "crayfish", n: "麻辣小龙虾", img: "assets/gifts/crayfish.webp" },
    { k: "crab",     n: "帝王蟹",     img: "assets/gifts/crab.webp" }
  ];
  const foodOf = k => FOODS.find(f => f.k === k);
  const preloaded = {};
  function preload(f) {
    if (preloaded[f.k]) return;
    const im = new Image(); im.src = f.img; preloaded[f.k] = true;
  }

  /* ---------- 送出记录（本地留档；云端尽力而为） ---------- */
  function outLog() { try { return JSON.parse(localStorage.getItem(LS_OUT) || "[]") || []; } catch (e) { return []; } }
  function logOut(rec) {
    const a = outLog(); a.unshift(rec);
    try { localStorage.setItem(LS_OUT, JSON.stringify(a.slice(0, 100))); } catch (e) {}
  }
  function myId() {
    try { const w = window.YRB_CLOUD && YRB_CLOUD.who && YRB_CLOUD.who(); return (w && w.id) ? String(w.id) : ""; }
    catch (e) { return ""; }
  }
  function myNick() {
    try { if (window.YRB_CLOUD && YRB_CLOUD.signedIn()) return YRB_CLOUD.name(); } catch (e) {}
    try { return (JSON.parse(localStorage.getItem("yrb_profile_v1") || "{}").nick) || "我"; } catch (e) { return "我"; }
  }

  /* ---------- 答谢面板 ---------- */
  let target = null;   /* { name, id, postId } */
  function openPanel(t) {
    target = t || { name: "TA" };
    ensurePanel();
    $("#fdToName").textContent = target.name || "TA";
    $("#fdSheet").classList.add("open");
    $("#fdMask").classList.add("open");
    FOODS.forEach(preload);
  }
  function closePanel() {
    const s = $("#fdSheet"), m = $("#fdMask");
    if (s) s.classList.remove("open");
    if (m) m.classList.remove("open");
  }
  function ensurePanel() {
    if ($("#fdSheet")) return;
    const host = $("#phone") || document.body;
    const cards = [`<button type="button" class="fd-card fd-rose" data-food="rose"><span class="fd-e">🌹</span><b>玫瑰花</b><i>传统答谢</i></button>`]
      .concat(FOODS.map(f => `<button type="button" class="fd-card" data-food="${f.k}"><img src="${f.img}" alt="${esc(f.n)}" loading="lazy"><b>${esc(f.n)}</b><i>点开就馋</i></button>`)).join("");
    host.insertAdjacentHTML("beforeend", `
      <div id="fdMask"></div>
      <div id="fdSheet" role="dialog" aria-label="答谢">
        <div class="fd-bar"><b>🎁 请 <span id="fdToName">TA</span> 吃大餐</b><button id="fdX" aria-label="关闭">✕</button></div>
        <div class="fd-sub">选一道硬菜送出，感谢 TA 的帮忙</div>
        <div class="fd-grid">${cards}</div>
      </div>`);
    $("#fdMask").addEventListener("click", closePanel);
    $("#fdX").addEventListener("click", closePanel);
    $("#fdSheet").addEventListener("click", e => {
      const c = e.target.closest(".fd-card"); if (!c) return;
      send(c.dataset.food);
    });
  }

  /* ---------- 嘉年华式大礼动画（2026-10-18 定稿） ----------
     用户：「向抖音那样的嘉年华礼物飘动那样，一个大大的就行」
     → 一份超大菜品从屏幕下方冲出，金光放射 + 光晕呼吸 + 星星爆散 + 光波扩散，
       停在画面中央轻轻浮动（约 6 秒），最后上浮淡出。 */
  function fly(f, caption) {
    const old = $("#fdFx"); if (old) old.remove();
    const host = $("#phone") || document.body;
    const fx = document.createElement("div");
    fx.id = "fdFx";
    host.appendChild(fx);

    const W = fx.clientWidth || 390, H = fx.clientHeight || 844;
    const cx = Math.round(W / 2), cy = Math.round(H * 0.48);
    const size = Math.round(Math.min(W * 0.86, 360));      /* 超大：86% 屏宽 */
    const DUR = 6000;

    fx.insertAdjacentHTML("beforeend", `
      <div class="fd-rays" style="left:${cx}px;top:${cy}px;width:${Math.round(W * 2.6)}px;height:${Math.round(W * 2.6)}px"></div>
      <div class="fd-halo" style="left:${cx}px;top:${cy}px;width:${Math.round(size * 1.5)}px;height:${Math.round(size * 1.5)}px"></div>
      <div class="fd-hero" style="left:${cx}px;top:${cy}px;width:${size}px">
        <img class="fd-gift fd-big" src="${f.img}" alt="${esc(f.n)}">
      </div>
      <div class="fd-sparks"></div>
      <div class="fd-cap"><span class="fd-cap1">${esc(caption || "")}</span><b class="fd-cap2">${esc(f.n)}</b></div>`);

    const hero = $("#fdFx .fd-hero"), img = $("#fdFx .fd-gift");

    /* 1) 大礼从屏幕下方冲出 → 悬停中央 → 结尾上浮 */
    hero.animate([
      { transform: `translate(-50%,-50%) translateY(${Math.round(H * 0.95)}px)`, offset: 0 },
      { transform: "translate(-50%,-50%) translateY(0px)", offset: 0.17, easing: "cubic-bezier(.15,1.06,.3,1)" },
      { transform: "translate(-50%,-50%) translateY(-14px)", offset: 0.40, easing: "ease-in-out" },
      { transform: "translate(-50%,-50%) translateY(6px)", offset: 0.60, easing: "ease-in-out" },
      { transform: "translate(-50%,-50%) translateY(-10px)", offset: 0.80, easing: "ease-in-out" },
      { transform: "translate(-50%,-50%) translateY(-150px)", offset: 1, easing: "ease-in" }
    ], { duration: DUR, fill: "forwards" });

    /* 2) 礼物本体：弹入回弹 → 轻摆 → 放大淡出 */
    img.animate([
      { transform: "scale(.4) rotate(-10deg)", opacity: 0, offset: 0 },
      { transform: "scale(1.14) rotate(2.5deg)", opacity: 1, offset: 0.17, easing: "ease-out" },
      { transform: "scale(1) rotate(0deg)", opacity: 1, offset: 0.27, easing: "ease-in-out" },
      { transform: "scale(1.02) rotate(-1.5deg)", opacity: 1, offset: 0.50, easing: "ease-in-out" },
      { transform: "scale(1) rotate(1.5deg)", opacity: 1, offset: 0.72, easing: "ease-in-out" },
      { transform: "scale(1.12) rotate(0deg)", opacity: 0, offset: 1 }
    ], { duration: DUR, fill: "forwards" });

    /* 3) 落定瞬间轻微震动（叠加在 hero 位移之上） */
    try {
      hero.animate([
        { transform: "translateX(0px)" },
        { transform: "translateX(-4px)", offset: .3 },
        { transform: "translateX(4px)", offset: .62 },
        { transform: "translateX(0px)" }
      ], { duration: 460, delay: 640, easing: "ease-in-out", composite: "add" });
    } catch (e) {}

    /* 4) 星星爆散（两拨） */
    const sparkHost = $("#fdFx .fd-sparks");
    for (let i = 0; i < 24; i++) {
      const s = document.createElement("i");
      s.className = "fd-spark";
      const sz = 5 + Math.random() * 9;
      s.style.width = s.style.height = sz + "px";
      s.style.left = cx + "px"; s.style.top = cy + "px";
      sparkHost.appendChild(s);
      const ang = Math.random() * Math.PI * 2;
      const dist = size * (0.5 + Math.random() * 0.62);
      const dx = Math.round(Math.cos(ang) * dist);
      const dy = Math.round(Math.sin(ang) * dist * 0.92);
      s.animate([
        { transform: "translate(-50%,-50%) scale(.2)", opacity: 0 },
        { transform: `translate(calc(-50% + ${Math.round(dx * .45)}px),calc(-50% + ${Math.round(dy * .45)}px)) scale(1.15)`, opacity: 1, offset: .35 },
        { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.35)`, opacity: 0 }
      ], {
        duration: 1600 + Math.random() * 900,
        delay: 180 + Math.random() * 700,
        iterations: 2, easing: "cubic-bezier(.2,.72,.3,1)", fill: "forwards"
      });
    }

    /* 5) 光波扩散（两圈） */
    for (let w = 0; w < 2; w++) {
      const ring = document.createElement("div");
      ring.className = "fd-wave";
      ring.style.left = cx + "px"; ring.style.top = cy + "px";
      ring.style.width = ring.style.height = Math.round(size * 1.05) + "px";
      fx.appendChild(ring);
      ring.animate([
        { transform: "translate(-50%,-50%) scale(.35)", opacity: .9 },
        { transform: "translate(-50%,-50%) scale(1.85)", opacity: 0 }
      ], { duration: 1500, delay: 260 + w * 700, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
    }

    /* 6) 热气：大礼上方持续升腾 */
    for (let i = 0; i < 3; i++) {
      const st = document.createElement("span");
      st.className = "fd-steam fd-steam-big";
      st.style.left = (cx - size * 0.2 + i * size * 0.2) + "px";
      st.style.top = (cy - size * 0.42) + "px";
      fx.appendChild(st);
      st.animate([
        { transform: "translate(-50%,0) scale(.5)", opacity: 0 },
        { transform: "translate(-50%,-52px) scale(1.5)", opacity: .45 },
        { transform: "translate(-50%,-110px) scale(2.3)", opacity: 0 }
      ], { duration: 2400, delay: 900 + i * 380, iterations: 2, easing: "ease-out" });
    }

    /* 掌声 + 收场 */
    try { if (typeof applause === "function") applause(1); } catch (e) {}
    setTimeout(() => { fx.classList.add("bye"); }, DUR - 780);
    setTimeout(() => { fx.remove(); }, DUR + 300);
  }

  /* ---------- 送出 ---------- */
  /* 云端入库（登录 + 有对方 id 才写；失败不影响动画与本地记录）
     —— 2026-10-19：玫瑰也走这里，对方「我的 → 收到的答谢」才真的能看到 */
  async function saveGift(key, t) {
    const C = window.YRB_CLOUD, uid = myId();
    if (!C || !C.enabled || !C.enabled() || !C.signedIn || !C.signedIn() || !uid) return;
    if (!C.client || !C.client.database) return;
    try {
      const ins = await C.client.database.from("yb_gifts").insert({
        from_id: uid, from_name: myNick(),
        to_id: (t && t.id) || "", to_name: (t && t.name) || "",
        food: key, post_id: (t && t.postId) || null
      });
      if (ins && ins.error) console.warn("[答谢] 云端记录失败：", ins.error.message || ins.error);
    } catch (e) { console.warn("[答谢] 云端记录失败：", e && e.message); }
  }

  async function send(key) {
    closePanel();
    const tg = target || { name: "TA" };      /* 先固定本次目标，避免异步过程中被重置 */
    if (key === "rose") {
      /* 玫瑰走原有满屏玫瑰流程 */
      try { if (typeof openGift === "function") openGift("满屏感谢", `你把玫瑰送给了 ${tg.name} 的帮忙`); } catch (e) {}
      logOut({ food: "rose", name: "玫瑰花", to: tg.name || "", toId: tg.id || "", postId: tg.postId || null, at: new Date().toISOString(), by: myNick() });
      toast && toast(`玫瑰已送到 ${tg.name} 手中 🌹`);
      saveGift("rose", tg);
      target = null;
      return;
    }
    const f = foodOf(key); if (!f) { target = null; return; }
    const rec = {
      food: key, name: f.n, to: tg.name || "",
      toId: tg.id || "", postId: tg.postId || null,
      at: new Date().toISOString(), by: myNick()
    };
    fly(f, `请 ${tg.name || "TA"} 吃了一份`);
    logOut(rec);
    toast && toast(`已送上「${f.n}」，感谢 TA 的帮忙 🍽`);
    saveGift(key, tg);
    target = null;
  }

  /* ---------- 收到的答谢 ---------- */
  function inboxBtn() {
    const menu = $("#meMenu"); if (!menu || $("#fdInboxBtn")) return;
    menu.insertAdjacentHTML("beforeend",
      `<button class="me-item" id="fdInboxBtn"><span class="ic">🎁</span><span>收到的答谢</span><span class="sub" id="fdInboxN"></span><span class="arr">›</span></button>`);
    $("#fdInboxBtn").addEventListener("click", openInbox);
  }
  function setBadge(n) {
    const el = $("#fdInboxN"); if (!el) return;
    el.textContent = n > 0 ? `${n} 份新的` : "";
  }
  async function openInbox() {
    ensureInbox();
    $("#fdInList").innerHTML = `<div class="fd-empty">正在加载…</div>`;
    $("#fdInSheet").classList.add("open"); $("#fdInMask").classList.add("open");
    const rows = await fetchInbox();
    rowStore.in = rows;
    renderInbox(rows);
    /* 有未读：满屏回放最新的一份，再标记已读 */
    const unseen = rows.filter(r => !r.seen);
    if (unseen.length) {
      const latest = unseen[0];
      const f = foodOf(latest.food);
      if (f) fly(f, `${latest.from_name || "家长"} 请你吃了一份`);
      if (window.toast) toast(`收到 ${unseen.length} 份答谢 🎉`);
      markSeen(unseen.map(r => r.id));
    } else {
      setBadge(0);
    }
  }
  function ensureInbox() {
    if ($("#fdInSheet")) return;
    const host = $("#phone") || document.body;
    host.insertAdjacentHTML("beforeend", `
      <div id="fdInMask"></div>
      <div id="fdInSheet" role="dialog" aria-label="收到的答谢">
        <div class="fd-bar"><b>🎁 收到的答谢</b><button id="fdInX" aria-label="关闭">✕</button></div>
        <div class="fd-sub">每一份硬菜，都是一句"谢谢你帮了我"</div>
        <div id="fdInList"></div>
      </div>`);
    $("#fdInMask").addEventListener("click", closeInbox);
    $("#fdInX").addEventListener("click", closeInbox);
  }
  function closeInbox() {
    const s = $("#fdInSheet"), m = $("#fdInMask");
    if (s) s.classList.remove("open");
    if (m) m.classList.remove("open");
  }

  /* ---------- 我的钱包（玫瑰余额 + 收到的礼物） ----------
     2026-10-19 用户：「我的钱包，玫瑰，再增加一个收到礼物（主要是指美食系列，
     打开再展示给获得者一次）」→ 钱包里玫瑰 + 收到的礼物两栏；点任意一份礼物，
     关掉面板后再满屏播一次，让获得者重新体验收到大餐的快乐。 */
  function rosesNow() {
    try { return (typeof S !== "undefined" && S && typeof S.roses === "number") ? S.roses : 0; } catch (e) { return 0; }
  }
  function ensureWallet() {
    if ($("#fdWlSheet")) return;
    const host = $("#phone") || document.body;
    host.insertAdjacentHTML("beforeend", `
      <div id="fdWlMask"></div>
      <div id="fdWlSheet" role="dialog" aria-label="我的钱包">
        <div class="fd-bar"><b>💰 我的钱包</b><button id="fdWlX" aria-label="关闭">✕</button></div>
        <div class="fd-sub">赠人玫瑰，手留余香 · 收到的硬菜都在这里</div>
        <div class="fd-wl-stats">
          <div class="fd-wl-stat fd-wl-rose"><span class="fd-wl-ic">🌹</span><b id="fdWlRose">0</b><i>朵玫瑰</i></div>
          <div class="fd-wl-stat fd-wl-gift"><span class="fd-wl-ic">🍽</span><b id="fdWlGift">0</b><i>份收到</i></div>
        </div>
        <div class="fd-wl-h">🎁 收到的礼物<span id="fdWlCnt"></span></div>
        <div id="fdWlList"></div>
      </div>`);
    $("#fdWlMask").addEventListener("click", closeWallet);
    $("#fdWlX").addEventListener("click", closeWallet);
  }
  function openWallet() {
    ensureWallet();
    $("#fdWlRose").textContent = rosesNow();
    $("#fdWlList").innerHTML = `<div class="fd-empty">正在加载…</div>`;
    $("#fdWlSheet").classList.add("open"); $("#fdWlMask").classList.add("open");
    loadWalletRows();
  }
  async function loadWalletRows() {
    const rows = await fetchInbox();
    rowStore.wl = rows; rowStore.in = rows;
    $("#fdWlGift").textContent = rows.length;
    $("#fdWlCnt").textContent = rows.length ? ` · 共 ${rows.length} 份` : "";
    renderList($("#fdWlList"), rows, EMPTY_WL);
    setBadge(rows.filter(r => !r.seen).length);
    syncWalletEntry(rows.length);
  }
  function closeWallet() {
    const s = $("#fdWlSheet"), m = $("#fdWlMask");
    if (s) s.classList.remove("open");
    if (m) m.classList.remove("open");
  }
  /* 「我的」页钱包那一行的副标题：玫瑰朵数 + 收到份数 */
  function syncWalletEntry(n) {
    const b = document.querySelector('[data-act="memu"][data-t="钱包 · 玫瑰"]');
    if (!b) return;
    const arr = b.querySelector(".arr"); if (!arr) return;
    const roses = rosesNow();
    arr.textContent = (typeof n === "number" && n > 0) ? `${roses} 朵 · ${n} 份礼物` : `${roses} 朵玫瑰`;
  }
  /* 回放一份礼物：先关面板，再满屏播一次嘉年华 */
  function replay(r) {
    if (!r) return;
    closeInbox(); closeWallet();
    if (!r.seen) { r.seen = true; markSeen([r.id]); }
    /* 玫瑰：没有菜品图，用原有满屏玫瑰动画回放 */
    if (r.food === "rose") {
      setTimeout(() => {
        try { if (typeof openGift === "function") openGift("满屏感谢", `${r.from_name || "家长"} 送了你一朵玫瑰花 🌹`); } catch (e) {}
      }, 280);
      return;
    }
    const f = foodOf(r.food); if (!f) return;
    setTimeout(() => fly(f, `${r.from_name || "家长"} 请你吃了一份`), 280);
  }
  function rel(t) {
    const d = (Date.now() - new Date(t).getTime()) / 1000;
    if (d < 60) return "刚刚"; if (d < 3600) return Math.floor(d / 60) + " 分钟前";
    if (d < 86400) return Math.floor(d / 3600) + " 小时前"; if (d < 604800) return Math.floor(d / 86400) + " 天前";
    try { return new Date(t).toLocaleDateString("zh-CN"); } catch (e) { return ""; }
  }
  const EMPTY_IN = `<div class="fd-empty">还没有收到答谢。<br>认真帮忙，很快就会有家长请你吃大餐 🍽</div>`;
  const EMPTY_WL = `<div class="fd-empty">还没有收到答谢。<br>认真帮忙，很快就会有家长请你吃大餐 🍽<br>
    <button type="button" class="fd-try" data-fd-try="crab">👉 点这里试看效果</button></div>`;

  /* 列表渲染：每一份都可点击「再看一次」（2026-10-19 用户要求：打开再展示给获得者一次） */
  function renderList(el, rows, emptyHTML) {
    if (!el) return;
    if (!rows || !rows.length) { el.innerHTML = emptyHTML || EMPTY_IN; return; }
    el.innerHTML = rows.map((r, i) => {
      const isRose = r.food === "rose";
      const f = foodOf(r.food) || { n: isRose ? "玫瑰花" : (r.food || "礼物"), img: "" };
      return `<button type="button" class="fd-in-item ${r.seen ? "" : "new"}" data-fd-replay="${i}"
        data-fd-food="${esc(r.food || "")}" data-fd-from="${esc(r.from_name || "")}">
        ${f.img ? `<img src="${f.img}" alt="">` : `<span class="fd-e">🌹</span>`}
        <span class="fd-in-m"><b>${esc(r.from_name || "家长")} ${isRose ? "送你" : "请你吃了"}「${esc(f.n)}」</b>
          <span>${esc(rel(r.created_at || r.at || Date.now()))}${r.seen ? "" : " · 新"}</span></span>
        <span class="fd-again">▶ 再看</span>
      </button>`;
    }).join("");
  }
  function renderInbox(rows) { renderList($("#fdInList"), rows, EMPTY_IN); }

  /* 当前列表数据（点击回放时按索引取） */
  const rowStore = { in: [], wl: [] };

  /* ---------- 云端收件箱 ---------- */
  async function fetchInbox() {
    const C = window.YRB_CLOUD, uid = myId();
    if (C && C.enabled && C.enabled() && C.signedIn && C.signedIn() && C.client && uid) {
      try {
        /* 审核（2026-10-30）：原来 `.or(to_id..., from_id...).limit(60)` —— 送出记录把
           limit 占满时收件会被挤掉（漏单）；且返回值只消费 to 侧。改成只查 to_id，语义等价 */
        const r = await C.client.database.from("yb_gifts").select("*").eq("to_id", uid)
          .order("created_at", { ascending: false }).limit(60);
        if (r && !r.error) {
          const mine = (r.data || []).filter(x => x.to_id === uid);
          FOODS.forEach(preload);
          return mine;
        }
      } catch (e) { console.warn("[答谢] 收件箱读取失败：", e && e.message); }
    }
    return [];
  }
  async function markSeen(ids) {
    const C = window.YRB_CLOUD;
    /* 审核（2026-10-30）：原来逐条 await update（N+1 次请求）。优先一条 .in() 批量更新；
       SDK 版本差异导致 .in 不可用时自动退回逐条（与旧行为等价），保证不因升级翻车 */
    if (!C || !C.client || !ids || !ids.length) return;
    try {
      await C.client.database.from("yb_gifts").update({ seen: true }).in("id", ids);
    } catch (e) {
      for (const id of ids) {
        try { await C.client.database.from("yb_gifts").update({ seen: true }).eq("id", id); } catch (e2) {}
      }
    }
    setBadge(0);
    refreshBadge();
  }
  /* 未读角标：打开应用时查一次 */
  async function refreshBadge() {
    const uid = myId();
    if (!uid) { setBadge(0); syncWalletEntry(0); return; }
    try {
      const rows = await fetchInbox();
      setBadge(rows.filter(r => !r.seen).length);
      syncWalletEntry(rows.length);
    } catch (e) {}
  }

  /* ---------- 启动 & 入口接线 ---------- */
  /* 钱包入口：拦截「我的」页原有「🌹 钱包 · 玫瑰」行（原行为只播一段玫瑰动画） */
  document.addEventListener("click", e => {
    const m = e.target.closest('[data-act="memu"]');
    if (m && m.dataset.t === "钱包 · 玫瑰") {
      e.preventDefault(); e.stopPropagation();
      openWallet();
    }
  }, true);

  /* 列表项「▶ 再看」→ 回放该份大餐；空态「试看效果」→ 示例动画 */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-fd-replay]");
    if (b) {
      e.preventDefault(); e.stopPropagation();
      const rows = b.closest("#fdWlList") ? rowStore.wl : rowStore.in;
      const r = rows[+b.dataset.fdReplay] ||
        (b.dataset.fdFood ? { food: b.dataset.fdFood, from_name: b.dataset.fdFrom || "", seen: true } : null);
      replay(r);
      return;
    }
    const t = e.target.closest("[data-fd-try]");
    if (t) {
      e.preventDefault(); e.stopPropagation();
      const f = foodOf(t.dataset.fdTry); if (!f) return;
      closeWallet();
      setTimeout(() => fly(f, "示例：家长请你吃了一份"), 280);
    }
  }, true);

  document.addEventListener("click", e => {
    /* 拦截两处原有「送玫瑰」按钮 → 改为打开答谢面板（含玫瑰选项） */
    const a = e.target.closest('[data-act="cgift"]');
    if (a) {
      e.stopPropagation(); e.preventDefault();
      const p = (typeof S !== "undefined" && S && S.posts) ? S.posts.find(x => x.id === S.curPost) : null;
      const i = +a.dataset.i;
      const c = p && p.comments && p.comments[i];
      openPanel({ name: (c && c.user) || "TA", id: (c && c.owner) || "", postId: p ? p.cloudId || null : null });
      return;
    }
    const d = e.target.closest("[data-dcgift]");
    if (d) {
      e.stopPropagation(); e.preventDefault();
      const p = (typeof S !== "undefined" && S && S.posts) ? S.posts.find(x => x.id === S.curPost) : null;
      const i = +d.dataset.dcgift;
      const c = p && p.comments && p.comments[i];
      openPanel({ name: (c && c.user) || "TA", id: (c && c.owner) || "", postId: p ? p.cloudId || null : null });
      return;
    }
  }, true);

  function boot() {
    inboxBtn();
    syncWalletEntry();
    refreshBadge();
  }
  /* 「我的」页每次切入都会重建 #meMenu（app.js renderMe）——包装它，重建后自动补回入口 */
  try {
    const _renderMe = renderMe;
    renderMe = function () { _renderMe(); try { inboxBtn(); syncWalletEntry(); } catch (e) {} };
  } catch (e) {}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("yrb-auth", () => { setTimeout(() => { inboxBtn(); refreshBadge(); }, 500); });
  /* 打开「我的」页时也刷新一次角标（轻量，仅在已登录时发请求） */
  document.addEventListener("click", e => {
    if (e.target.closest('.tb-item[data-p="me"]')) setTimeout(refreshBadge, 400);
  }, true);

  window.YRB_FOOD = { foods: FOODS, openPanel, send, refreshBadge, fly, openWallet, replay, openInbox };
})();
