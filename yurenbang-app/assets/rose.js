/* 育人帮 · 玫瑰馈赠层（rose.js）  2026-10-23
   ------------------------------------------------------------------
   用户需求：「发出帮忙后系统自动送大大的玫瑰花，同时其他点赞或收藏时也送给
   发布者（包括求助的和帮忙的）」。

   现状与缺口：
     · 帮忙后 reward.js 已有「满屏玫瑰 + 掌声」，但那份玫瑰只有 46~100px、12~16 朵，
       且只在 addComment 的结算路径里出现；
     · 点赞 / 收藏求助卡片与详情页，完全没有送玫瑰，也没有通知发布者；
     · 帮忙留言被点赞（app.js 的 clike）只播动画，不写云端，对方收件箱看不到。

   这一层不改任何业务逻辑，只做三件事：
     1) 把「送出玫瑰」统一成一个动作：满屏大玫瑰动画（56~130px、20 朵以上）+ 云端
        写 yb_gifts（对方「我的 → 收到的答谢」能看到），文案写明送给了谁、为什么；
     2) 接管 点赞 / 收藏 的点击（捕获阶段只读判断，不阻止原逻辑），给内容发布者送玫瑰；
     3) 帮忙留言点赞补一条云端记录（动画仍由 app.js 负责，不重复播）。

   铁律（沿用项目踩坑经验）：
     · 云端一律 YRB_CLOUD.client.database.from(...)，SDK 异步 → 运行时取值
     · 不给自己送花；同一条内容同一原因只送一次（会话内去重）
     · 插进 #gift 的动画节点必须可重复创建且会被清理，避免 MutationObserver 死循环
   ------------------------------------------------------------------ */
(function () {
  if (window.YRB_ROSE) { return; }

  var LS = "yrb_rose_out_v1";
  var sent = {};                 /* 会话内去重 */
  var cleanTimers = [];

  /* ---------------- 基础取值（都在运行时取，避免别的层晚加载） ---------------- */
  function ST() { try { return (typeof S !== "undefined") ? S : null; } catch (e) { return null; } }
  function nick() {
    try { return (typeof myName === "function" && myName()) || ""; } catch (e) { return ""; }
  }
  function uid() {
    try {
      var C = window.YRB_CLOUD;
      if (C && typeof C.who === "function") { var w = C.who(); if (w && w.id != null) return String(w.id); }
    } catch (e) {}
    return "";
  }
  function plain(t) { return String(t == null ? "" : t).replace(/[<>&]/g, ""); }

  /* ---------------- 云端：写一笔玫瑰礼物 ---------------- */
  function cloudRose(t) {
    try {
      var C = window.YRB_CLOUD;
      if (!C || typeof C.enabled !== "function" || !C.enabled()) return;
      if (typeof C.signedIn !== "function" || !C.signedIn()) return;
      if (!t || !t.id) return;                        /* 演示数据没有 owner，只做本地动画 */
      var me = uid();
      if (me && String(me) === String(t.id)) return;  /* 不给自己送 */
      var db = C.client && C.client.database;         /* 铁律：必须 client.database */
      if (!db || typeof db.from !== "function") return;
      var r = db.from("yb_gifts").insert({
        from_id: me || "guest",
        from_name: nick() || "家长",
        to_id: String(t.id),
        to_name: t.name || "",
        food: "rose",
        post_id: t.postId || null
      });
      if (r && typeof r.catch === "function") r.catch(function () {});
      /* 对方若在线，下次开收件箱/刷新红点就能看到 */
    } catch (e) {}
  }

  /* ---------------- 本地留档（送出记录，便于排查与「我送出的玫瑰」） ---------------- */
  function logOut(rec) {
    try {
      var arr = JSON.parse(localStorage.getItem(LS) || "[]");
      if (!Array.isArray(arr)) arr = [];
      arr.unshift(rec);
      localStorage.setItem(LS, JSON.stringify(arr.slice(0, 60)));
    } catch (e) {}
  }

  /* ---------------- 满屏大玫瑰（插进 #gift，与现有礼物层共用深色底） ---------------- */
  function plantRoses(host, n) {
    if (!host) return;
    var old = host.querySelector(".yr-roses");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var w = document.createElement("div");
    w.className = "yr-roses";
    n = n || 22;
    for (var i = 0; i < n; i++) {
      var s = document.createElement("span");
      s.className = "yr-r";
      s.textContent = i % 6 === 0 ? "💐" : "🌹";
      s.style.left = (Math.random() * 92).toFixed(1) + "%";
      s.style.fontSize = Math.round(56 + Math.random() * 74) + "px";
      s.style.animationDelay = (Math.random() * 1.5).toFixed(2) + "s";
      s.style.animationDuration = (3 + Math.random() * 2.2).toFixed(2) + "s";
      w.appendChild(s);
    }
    host.insertBefore(w, host.firstChild);
    var tm = setTimeout(function () {
      if (w.parentNode) w.parentNode.removeChild(w);
    }, 6200);
    cleanTimers.push(tm);
    if (cleanTimers.length > 20) cleanTimers.shift();
  }

  /* 统一出口：播一次「收到/送出玫瑰」的完整动画（不虚增我的玫瑰余额） */
  function show(title, sub) {
    var g = document.getElementById("gift");
    if (!g || typeof openGiftRaw !== "function") {
      try { if (typeof toast === "function") toast(sub || "🌹 玫瑰已送出"); } catch (e) {}
      return;
    }
    var keep = null;
    try { var s = ST(); if (s && typeof s.roses === "number") keep = s.roses; } catch (e) {}
    openGiftRaw(title, sub);
    /* 点赞/收藏送花不是「我收到玫瑰」，把 app.js 里 +1 的计数还原 */
    try { var s2 = ST(); if (s2 && keep !== null) s2.roses = keep; } catch (e) {}
    try { if (typeof renderMe === "function") renderMe(); } catch (e) {}
    plantRoses(g, 26);
  }

  /* ---------------- 送玫瑰（唯一入口） ----------------
     t = { id: 对方 uid, name: 对方昵称, postId: 云端帖 id, key: 去重键 }
     reason = 送花缘由（写进提示文案与留档）
     opts.animate === false → 只记账不动画（调用方自己已经播过） */
  function give(t, reason, opts) {
    opts = opts || {};
    if (!t || !t.name) return false;
    var k = (t.key || "") + "|" + (t.id || t.name) + "|" + reason;
    if (sent[k]) return false;
    sent[k] = 1;

    var me = nick();
    if (me && t.name === me) return false;               /* 自己的内容不送 */
    var muid = uid();
    if (muid && t.id && String(muid) === String(t.id)) return false;

    logOut({
      to: t.name, toId: t.id || "", postId: t.postId || null,
      reason: reason, at: new Date().toISOString(), by: me || "家长"
    });
    cloudRose(t);
    if (opts.animate !== false) {
      show("满屏感谢", "🌹 一朵大大的玫瑰，已送到 " + plain(t.name) + " 手中 · " + reason);
    }
    return true;
  }

  /* ---------------- 目标解析 ---------------- */
  function findPost(id) {
    var s = ST();
    var arr = (s && s.posts) || [];
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].id) === String(id)) return arr[i];
    }
    return null;
  }
  /* 首页卡片：.card[data-id] */
  function postFromCard(el) {
    var card = el.closest && el.closest(".card");
    if (!card || !card.dataset || !card.dataset.id) return null;
    return findPost(card.dataset.id);
  }
  /* 求助详情页：没有 .card，按 S.curPost 取；再退一步用标题文本核对 */
  function postFromDetail(el) {
    if (!(el.closest && el.closest("#r23Detail"))) return null;
    var s = ST();
    var p = findPost(s && s.curPost);
    if (p) return p;
    try {
      var t = document.querySelector("#r23Detail .r23-dcard .p-text");
      var txt = t ? String(t.textContent || "").trim() : "";
      var arr = (s && s.posts) || [];
      for (var i = 0; i < arr.length; i++) {
        if (txt && String(arr[i].title || "").trim() === txt) return arr[i];
      }
    } catch (e) {}
    return null;
  }

  /* ---------------- 点击接管（捕获阶段，只读判断，不阻止原逻辑） ---------------- */
  function onLikeClick(e) {
    var b = e.target.closest && e.target.closest('[data-act="like"],[data-act="fav"],[data-db="like"],[data-db="fav"]');
    if (!b) return;
    if (b.classList && b.classList.contains("on")) return;   /* 取消点赞/收藏，不送 */
    var kind = b.getAttribute("data-act") || b.getAttribute("data-db");
    var p = postFromCard(b) || postFromDetail(b);
    if (!p) return;
    if (p.mine) return;                                     /* 自己的求助，不给自己送 */
    var nm = p.user || p.by || "家长";
    var my = nick();
    if (my && nm === my) return;
    give({
      id: p.owner || "",
      name: nm,
      postId: p.cloudId || null,
      key: "post" + (p.cloudId || p.id)
    }, kind === "fav" ? "你收藏了 TA 的求助" : "你给 TA 的求助点了赞");
  }

  /* 帮忙留言被点赞：动画由 app.js / refine23 负责，这里只补云端记录 */
  function onHelpLike(e) {
    var b = e.target.closest && e.target.closest('[data-act="clike"]');
    if (!b) return;
    if (b.classList && b.classList.contains("on")) return;
    var list = b.closest("#cmList") || b.closest("#r23CmList");
    var item = b.closest(".cm-item");
    if (!list || !item) return;
    /* 审核（2026-10-30）：原用 .cm-item 在列表里的 DOM 下标当数据下标——渲染顺序与数据顺序
       一旦不一致（筛选/重排/局部刷新）就会给错人送花，去重键也会漂移。
       cmItemHTML 本来就在按钮上带 data-i（数据下标），优先用它，取不到再退回 DOM 下标 */
    var btn = (b.getAttribute && b.getAttribute("data-i") != null) ? b
      : item.querySelector('[data-act="clike"]');
    var iAttr = btn ? btn.getAttribute("data-i") : null;
    var idx = (iAttr != null && !isNaN(parseInt(iAttr, 10))) ? parseInt(iAttr, 10)
      : Array.prototype.indexOf.call(list.querySelectorAll(".cm-item"), item);
    if (isNaN(idx) || idx < 0) return;
    var s = ST();
    var p = findPost(s && s.curPost);
    if (!p || !p.comments || !p.comments[idx]) return;
    var c = p.comments[idx];
    if (p.mine && !c.owner) return;                          /* 自己求助下、无 owner 的演示留言 */
    give({
      id: c.owner || "",
      name: c.user || "帮忙的家长",
      postId: p.cloudId || null,
      key: "comment" + (p.cloudId || p.id) + "-" + idx
    }, "你给 TA 的帮忙点了赞", { animate: false });
  }

  document.addEventListener("click", function (e) {
    try { onLikeClick(e); } catch (err) {}
    try { onHelpLike(e); } catch (err) {}
  }, true);

  /* ---------------- 包装 openGift：所有"送/收玫瑰"场景都变大玫瑰 ----------------
     reward.js 的帮忙结算会自己插 .rw-roses（12~16 朵），此时不重复插；
     其它场景（点赞、送玫瑰、收到答谢）统一补满屏大玫瑰。 */
  var openGiftRaw = window.openGift;
  try {
    if (typeof openGiftRaw === "function") {
      window.openGift = function (title, sub) {
        var r = openGiftRaw.apply(this, arguments);
        var quiet = /积分|晋升/.test(String(sub || ""));   /* 帮忙结算自带玫瑰，不叠 */
        setTimeout(function () {
          try {
            var g = document.getElementById("gift");
            if (!g) return;
            if (g.querySelector(".rw-roses")) return;       /* reward 已铺满 */
            if (g.querySelector(".yr-roses")) return;
            if (quiet) return;
            plantRoses(g, 22);
          } catch (e) {}
        }, 80);
        return r;
      };
    }
  } catch (e) {}

  /* ---------------- 对外 ---------------- */
  window.YRB_ROSE = {
    give: give,
    show: show,
    out: function () { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch (e) { return []; } },
    _reset: function () { sent = {}; }
  };
})();
