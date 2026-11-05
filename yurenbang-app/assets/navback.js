/* =========================================================
   育人帮 · 返回手势层（navback.js）—— 2026-11-04
   问题（用户反馈）：「智能手机左右滑动可以退出一级二级菜单，现在不能了」。
   真因：网页里所有浮层（抽屉 / 设置二级页 / 发布面板 / 弹窗 / 详情 / 查看器）
   都只是加了个 class，没有任何一条历史记录。手机侧滑或按返回键时，
   浏览器只会执行「WebView 后退」——历史栈里只有一条记录，退一格就离开了页面，
   看着像 APP 被关掉；浮层本身一点没动。

   做法（与 mediafull / casedit 的全屏垫片同一思路，本层管所有层）：
   1) 只要有一级/二级菜单开着，就往历史栈押一条占位记录（带 __yrbGuard 标记）。
      系统后退只能退到这条占位上，被 popstate 接住 → 关掉最上面那一级；
      还有下级就再押一条，所以「滑一次退一级」，页面本身不离开。
   2) 用户自己点 ✕ / ‹ 关掉浮层时，把那条占位记录一起消费掉（history.back()），
      否则下一次侧滑会「滑了没反应」。
   3) 额外补一个手动侧滑：在浮层上左右滑 > 70px 也退一级。因为
      ① 添加到主屏幕的独立窗口、部分微信 WebView 没有系统侧滑；
      ② 用户说的就是「左右滑动」，手指从屏幕中间滑也要有反应。
      贴左边 26px 内不接管，留给系统手势，避免同一次滑动被算两次。
   4) 2026-11-05 补「页面级」这一层（用户反馈：「左右滑动应该返回上一层，
      多次滑动时应该回到首页而不是退出」）。真因：底部/顶部切页只是换 .active 类，
      历史栈里没有记录，所以在「我的」「消息」「案例广场」上侧滑，浏览器直接
      退出整个页面（看着像 APP 被关掉）。现在只要当前不是首页，就押一条占位：
      系统侧滑 / 返回键 / 手指右滑 → 切回首页（信息流），页面本身不离开。
      详情 / 全屏（#r23Detail、.mf-fs、.vw-fs）仍归 mediafull / casedit，
      本层见到它们就让路，避免一次滑动退两级。

   边界：
   · 只读 DOM、只调既有 close 入口（⚙ 不新建浮层、不动 CSS、不占 z-index）
   · 浮层清单在 LAYERS 里，新增浮层只要在这里补一行（找不到就自己摘 open 兜底）
   · 全屏媒体（mediafull）与案例全屏（casedit）有自己的垫片：本层发现 popstate
     落在他们的占位记录上就立即让路，不抢他们的手势
   ========================================================= */
(function () {
  "use strict";
  if (window.YRB_NAVBACK) return;

  var GUARD = "__yrbGuard";     /* 占位记录的标记位（浮层 / 非首页 tab 各占一条） */
  var LAND = "__yrbLand";       /* 落地保护（栈底一条）：让「滑到首页」停住，而不是退出整个应用 */
  var stack = [];               /* 已打开的浮层，末尾 = 最上层 */
  var guard = 0;                /* 1 = 我们押了一条占位 */
  var guardId = 0;              /* 这条占位的编号（旧记录被消费时靠它分辨） */
  var gid = 0;                  /* 编号自增源 */
  var land = 0;                 /* 1 = 栈底有一条落地保护 */
  var landAt = 0;               /* 上次被「滑到底」的时刻：2 秒内再滑一次就放行退出 */
  var pend = 0;                 /* 自己 history.back() 引起、待忽略的 popstate 次数 */
  var raf = 0;
  var seq = 0;                  /* 打开戳自增序号 */

  function q(s, r) { return (r || document).querySelector(s); }
  function txt(el) { return el && el.textContent ? el.textContent : ""; }

  /* ---------- 页面级（tab）返回 ----------
     应用是单页：切 tab 只改 .page 的 .active，历史栈里什么也没留，
     于是在非首页侧滑 = 浏览器后退 = 整个页面走掉。这里把「当前 tab」也当成一级。 */
  function curTab() {
    var el = document.querySelector(".page.active");
    return el ? String(el.id || "").replace(/^page-/, "") : "";
  }
  /* 详情 / 全屏：它们的返回与手势归 mediafull / casedit，本层不接 */
  function detailLayer() {
    return !!(q("#r23Detail.open") || q("#r23Detail.mf-fs") || q("#viewer.open") ||
      q("#viewer.mf-fs") || q("#viewer.vw-fs"));
  }
  /* 回首页：走 app.js 的 switchTab（顺带渲染、关抽屉），拿不到就自己切类兜底 */
  function backToHome() {
    try { if (typeof window.switchTab === "function") { window.switchTab("home"); return true; } } catch (e) {}
    var i, ps = document.querySelectorAll(".page"), bs = document.querySelectorAll(".tb-item");
    for (i = 0; i < ps.length; i++) ps[i].classList.toggle("active", ps[i].id === "page-home");
    for (i = 0; i < bs.length; i++) bs[i].classList.toggle("active", bs[i].getAttribute("data-p") === "home");
    return false;
  }
  /* 这一刻需不需要在历史栈里押占位：有浮层，或者不在首页（且不在详情/全屏里） */
  function needGuard() {
    if (stack.length) return true;
    return curTab() !== "home" && !detailLayer();
  }

  /* ---------- 浮层清单 ----------
     sel  : 判定「开着」的选择器（.open / .show 由各层自己维护）
     close: 优先点它自己的关闭按钮（这样各层的内部状态、遮罩、复位都照原样跑），
            点不到才退回摘 class。
     顺序按视觉**由下往上**排：同一帧里开了两层（比如点抽屉里的设置项）时，
     越靠后的越算上层，返回就先关它。 */
  var LAYERS = [
    /* 求助详情（#r23Detail，refine23 建的）：**全屏时归 mediafull**（它有自己的垫片和手势，
       两条占位叠着会让历史栈对不上）；非全屏时它就是压在首页之上的一级，
       没有它，「点开帖子 → 退全屏 → 关详情 → 再滑」会一步跨到站外（2026-11-05 用户反馈）。 */
    { k: "r23Detail", sel: "#r23Detail.open",
      only: function () { return !q("#r23Detail.mf-fs") && !q("#r23Detail.vw-fs"); },
      close: function (el) {
        click(el, "#r23DBack");
        el.classList.remove("mf-fs");
        var ph = document.getElementById("phone"); if (ph) ph.classList.remove("mf-pill-low");
      } },
    { k: "dropdown",   sel: "#dropdown.open",   close: function () { if (typeof window.closeDropdown === "function") window.closeDropdown(); } },
    { k: "drawer",     sel: "#drawer.open",     close: function () { if (typeof window.closeDrawer === "function") window.closeDrawer(); } },
    { k: "subpage",    sel: "#subpage.open",    close: function (el) { click(el, "#spBack"); } },
    /** 详情层见 LAYERS 表头：全屏（.mf-fs）时让路给 mediafull，非全屏时归本层 */
    { k: "viewer",     sel: "#viewer.open",     close: function (el) { click(el, "#vwX"); } },
    { k: "sheet",      sel: ".sheet.open", all: true,
      close: function (el) {
        if (typeof window.closeSheet === "function" && el.id) { window.closeSheet(el.id); return; }
        el.classList.remove("open");
      } },
    { k: "longimg",    sel: ".lg-mask.open",    close: function (el) { el.classList.remove("open"); } },
    { k: "login",      sel: "#loginSheet.open", close: function (el) { click(el, "#lgX"); } },
    { k: "lgDoc",      sel: "#lgDoc.open",      close: function (el) { click(el, "#lgDocBack"); } },
    { k: "fdWlSheet",  sel: "#fdWlSheet.open",  close: function (el) { click(el, "#fdWlX"); } },
    { k: "fdInSheet",  sel: "#fdInSheet.open",  close: function (el) { click(el, "#fdInX"); } },
    { k: "fdSheet",    sel: "#fdSheet.open",    close: function (el) { click(el, "#fdX"); } },
    { k: "pfSheet",    sel: "#pfSheet.open",    close: function (el) { click(el, "#pfX"); } },
    { k: "pwdSheet",   sel: "#pwdSheet.open",   close: function (el) { click(el, "#pwCancel"); } },
    { k: "adLayer",    sel: "#adLayer.open",    close: function (el) { click(el, "#adBack"); } },
    { k: "shareLayer", sel: "#shareLayer.open", close: function (el) { click(el, "#slBack"); } },
    { k: "agLayer",    sel: "#agLayer.open",    close: function (el) { click(el, "#agCancel"); } },
    { k: "shGuide",    sel: "#shGuide.open",    close: function (el) { el.classList.remove("open"); } },
    { k: "r23Confirm", sel: "#r23Confirm.open", close: function (el) { click(el, "#r23CfClose"); } },
    { k: "licView",    sel: "#licView.open",    close: function (el) { click(el, "#lvClose"); } },
    { k: "r23Viewer",  sel: "#r23Viewer.open",  close: function (el) { click(el, "#r23Vx"); } },
    { k: "r23Report",  sel: "#r23Report.open",  close: function (el) { click(el, "#r23RpX"); } },
    { k: "modal",      sel: "#modal.open",      close: function () { if (typeof window.closeModal === "function") window.closeModal(); } },
    { k: "vpFull",     sel: "#vpFull",          close: function (el) { click(el, ".vf-x"); } }
  ];

  /* 点浮层自己的关闭按钮；按钮没注入 / 被禁用时退回摘 class */
  function click(el, sel) {
    var b = q(sel, el);
    if (b) { try { b.click(); if (!el.classList.contains("open")) return; } catch (e) {} }
    el.classList.remove("open");
  }

  /* ---------- 扫描当前开着的浮层 ---------- */
  function openNow() {
    var out = [], i, j, L, el, els;
    for (i = 0; i < LAYERS.length; i++) {
      L = LAYERS[i];
      if (L.only && !L.only()) continue;      /* 条件层（详情全屏时让路给 mediafull） */
      if (L.all) {
        els = document.querySelectorAll(L.sel);
        for (j = 0; j < els.length; j++) out.push({ k: L.k + "#" + (els[j].id || j), el: els[j], L: L });
      } else {
        el = q(L.sel);
        if (el) out.push({ k: L.k, el: el, L: L });
      }
    }
    return out;
  }

  function push() {
    guard = 1; guardId = ++gid;
    try { history.pushState({ __yrbGuard: guardId }, "", location.href); }
    catch (e) { guard = 0; guardId = 0; }
  }

  /* 落地保护：栈底押一条，让人滑到首页时**停住**。
     2026-11-05 用户原话「多次滑动时应该回到首页而不是退出」：没有这条时，
     浮层/二级页/详情全退完后再滑一格，浏览器就带着人离开站点了（长辈以为 APP 崩了）。
     想真退出：停住后 2 秒内再滑/再按一次返回即放行（等于安卓原生的「再按一次退出」）。 */
  function pushLand() {
    if (land) return;
    land = 1;
    try { history.pushState({ __yrbLand: 1 }, "", location.href); }
    catch (e) { land = 0; }
  }

  function alreadyHome() {
    try { if (typeof window.toast === "function") window.toast("已经在首页了，再滑一次退出"); } catch (e) {}
  }

  /* 别人家的全屏（mediafull 的 .mf-fs / casedit 的 .vw-fs）有自己的垫片和手势，
     那些手势归他们管；本层看到这些就把手势让出去，避免「一次滑退两级」 */
  function foreignFull() {
    return !!(q("#r23Detail.mf-fs") || q("#viewer.mf-fs") || q("#viewer.vw-fs"));
  }

  /* 把 DOM 现状和历史栈对齐：新开的入栈，关掉的出栈，
     有浮层没占位就押一条，没浮层却押着就消费掉 */
  function sync() {
    var cur = openNow(), byKey = {}, i;
    for (i = 0; i < cur.length; i++) byKey[cur[i].k] = cur[i];
    var next = stack.filter(function (x) { return byKey[x.k]; });
    var have = next.map(function (x) { return x.k; });
    for (i = 0; i < cur.length; i++) if (have.indexOf(cur[i].k) < 0) {
      cur[i].el.__nbStamp = ++seq;      /* 每「新开一次」打一枚戳：用来分辨「重新打开了」和「刚关还没关掉」 */
      next.push(cur[i]);
    }
    stack = next;

    if (stack.length || needGuard()) { if (!guard) push(); }
    else if (guard) {
      /* 详情/全屏接管（比如详情刚进全屏，mediafull 的垫片已经押在我们的上面）：
         这时候 back() 会退掉**别人的**垫片，把媒体的历史状态搞乱 ——
         只把自己的标记摘掉，记录留在栈里当普通记录（落上去时会被 st[GUARD] 忽略）。 */
      if (detailLayer() || foreignFull()) {
        guard = 0;
        try { if (history.state && history.state[GUARD]) history.replaceState(null, "", location.href); } catch (e) {}
        return;
      }
      guard = 0; pend++;
      /* 打一枚回声戳：这次 back() 是本层还占位，不是用户在按返回。
         mediafull 等也监听 popstate 的层靠它区分「navback 的回声」和「真的返回」，
         否则会把叠在详情上的面板一关，连详情也一起关掉（2026-11-04 举报面板实测） */
      try { window.__yrbNbEcho = Date.now(); } catch (e) {}
      try { history.back(); } catch (e) { pend--; guard = 1; }
      /* back() 若被随后的一次 pushState 打断，popstate 就不会来了：1.5 秒后自动归零，
         免得「下一次真实返回」被白白吞掉一下（用户会觉得滑了没反应） */
      setTimeout(function () { if (pend) pend = 0; }, 1500);
    }
    else if (!land) pushLand();          /* 什么都没开：压一条落地保护，滑到底停在首页 */
  }

  function schedule() {
    if (raf) return;
    raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      raf = 0; sync();
    });
  }

  /* 关掉最上面一级；返回是否真的关了一级 */
  function closeTop() {
    if (!stack.length) return false;
    var top = stack.pop();
    var stamp = top.el ? top.el.__nbStamp : 0;   /* 关的是「这一次打开」的实例 */
    try { top.L.close(top.el); } catch (e) {}
    /* 有的层关起来有动画 / 要等下一拍；60ms 后 DOM 还开着就直接摘，
       否则用户会觉得「滑了没反应」。
       注意：这 60ms 里用户可能已经把同一层又打开了（关抽屉→点设置）——
       那就不能摘它的 open，否则新的那层会被「补刀」关掉。靠打开戳区分。 */
    setTimeout(function () {
      try {
        if (top.el && top.el.__nbStamp === stamp && top.el.classList.contains("open")) top.el.classList.remove("open");
        sync();
      } catch (e) {}
    }, 60);
    return true;
  }

  /* ---------- 系统返回（侧滑 / 返回键） ---------- */
  window.addEventListener("popstate", function (e) {
    if (pend) { pend--; return; }                       /* 是我们自己 back() 的回声 */
    var st = e.state || {};
    /* 还落在「正在生效」的那条层占位上：被消费的是别人的垫片（mediafull / casedit 的），让它们处理 */
    if (guard && st.__yrbGuard && st.__yrbGuard === guardId) return;

    if (guard) {
      guard = 0; guardId = 0;                           /* 我们的占位被系统消费掉了 */
    /* 打回声戳：这一拍是本层在退自己的浮层（占位押在 mediafull 等层的垫片之上，
       消费后 e.state 会变成它们的垫片，但那条垫片并没有被消费 —— 后执行的层
       看到 400ms 内的回声就让路，垫片留到下一次返回自然轮到它） */
    try { window.__yrbNbEcho = Date.now(); } catch (e) {}
    /* 详情/案例全屏时手势原则上归 mediafull / casedit；
       但如果本层还有浮层开着（比如详情全屏上叠着举报面板，面板 z60 > 详情 z57），
       用户想退的是这层浮层 —— 先关它，全屏留着由 mediafull 继续管 */
    if (foreignFull() && !stack.length) return;         /* 让路：不关层、也不再补押 */
    if (!stack.length) {
      /* 页面级：不在首页 → 回首页（「多次滑动最后停在首页，而不是退出应用」） */
      if (detailLayer()) return;
      if (curTab() === "home") return;                  /* 已在首页：交给浏览器正常后退 */
      backToHome();
      sync();
      return;
    }
    closeTop();
    sync();                                             /* 还有下级 → 重新押一条 */
      return;
    }

    /* 没有层占位了：看栈底那条落地保护有没有被消费 */
    if (!land) return;
    if (st.__yrbGuard || st.__yrbLand) return;          /* 落在已放弃的记录 / 落地记录上：不打扰 */
    land = 0;
    var now = Date.now();
    if (landAt && now - landAt < 2000) {
      /* 2 秒内再滑一次：放行。此时刚退到「进入本站之前那条记录」上（很多浏览器里
         它还是同一个网址），所以再主动退一格，人才真的离开站点 */
      landAt = 0;
      try { history.back(); } catch (e) {}
      return;
    }
    landAt = now;
    alreadyHome();                                      /* 第一次滑到底：停在首页并告诉用户 */
    sync();                                             /* 重新押一条，继续拦着 */
  });

  /* ---------- 手动左右滑：任何一级浮层上滑一下都退一级；非首页页面上滑一下回首页 ---------- */
  var sx = 0, sy = 0, st0 = 0, live = false, liveMode = "";

  function canScrollX(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      try {
        var cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 8) return true;
      } catch (e) {}
      el = el.parentElement;
    }
    return false;
  }

  window.addEventListener("touchstart", function (e) {
    live = false; liveMode = "";
    if (!e.touches || e.touches.length !== 1) return;
    /* 2026-11-04 修正（用户截图：详情页上的举报面板滑不退）：
       ① 原来详情全屏（foreignFull）时整体让路 —— 但叠在全屏上的面板（z 更高）没人管；
       ② 原来要求滑动起点落在面板元素内 —— 贴底面板只占下半屏，
          用户从屏幕中部起滑（最自然的手势）起点在详情内容上，永远进不来。
       现在只要本层管着浮层（stack 非空），横滑就是「退一级」的意图：
       竖滑、输入区、视频、横向滚动区在下面逐条排除。
       2026-11-05：没有浮层但在「我的 / 消息 / 案例广场」这类页面上，横滑 = 回首页；
       详情 / 全屏仍归 mediafull、casedit 自己的手势。 */
    var t = e.touches[0], tgt = e.target, mode = "";
    if (stack.length) mode = "layer";
    else if (!detailLayer() && curTab() !== "home") mode = "home";
    if (!mode) return;
    if (t.clientX < 26) return;                          /* 贴左边缘留给系统手势 */
    if (tgt.closest && tgt.closest("video,audio,input,textarea,select,[data-noswipe]")) return;
    if (canScrollX(tgt)) return;                          /* 横向列表 / 轮播不抢 */
    sx = t.clientX; sy = t.clientY; st0 = Date.now(); live = true; liveMode = mode;
  }, { passive: true, capture: true });

  window.addEventListener("touchend", function (e) {
    if (!live) return;
    live = false;
    var mode = liveMode; liveMode = "";
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st0;
    if (dt > 800) return;                                 /* 慢慢拖不算滑 */
    if (Math.abs(dx) < 70) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;        /* 竖向滚动不抢 */
    if (mode === "home") { backToHome(); sync(); return; } /* 非首页：滑一下回首页 */
    closeTop();
    sync();
  }, { passive: true, capture: true });

  window.addEventListener("touchcancel", function () { live = false; liveMode = ""; }, { passive: true });

  /* ---------- 启动 ---------- */
  /* 上一次会话残留在历史记录里的占位先处理掉：
     · 层占位（浮层用的）→ 去掉标记，sync 会按当前 DOM 重押，免得一进来就多一条；
     · 落地保护 → 保留（bfcache 恢复时它正好还在，不必重押） */
  try {
    var s0 = history.state;
    if (s0 && s0[GUARD]) history.replaceState(null, "", location.href);
    else if (s0 && s0[LAND]) land = 1;
  } catch (e) {}

  try {
    new MutationObserver(schedule).observe(document.documentElement, {
      attributes: true, attributeFilter: ["class"], childList: true, subtree: true
    });
  } catch (e) {
    /* 没有 MutationObserver（极老内核）：退化为定时对齐，2 秒一次，开销可忽略 */
    setInterval(sync, 2000);
  }
  sync();

  window.YRB_NAVBACK = {
    ready: true,
    depth: function () { return stack.length; },
    list: function () { return stack.map(function (x) { return x.k; }); },
    guarded: function () { return !!guard; },
    landed: function () { return !!land; },
    tab: curTab,
    toHome: backToHome,
    closeTop: closeTop,
    sync: sync
  };
})();
