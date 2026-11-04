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

   边界：
   · 只读 DOM、只调既有 close 入口（⚙ 不新建浮层、不动 CSS、不占 z-index）
   · 浮层清单在 LAYERS 里，新增浮层只要在这里补一行（找不到就自己摘 open 兜底）
   · 全屏媒体（mediafull）与案例全屏（casedit）有自己的垫片：本层发现 popstate
     落在他们的占位记录上就立即让路，不抢他们的手势
   ========================================================= */
(function () {
  "use strict";
  if (window.YRB_NAVBACK) return;

  var GUARD = "__yrbGuard";     /* 占位记录的标记位 */
  var stack = [];               /* 已打开的浮层，末尾 = 最上层 */
  var guard = 0;                /* 1 = 我们押了一条占位记录 */
  var pend = 0;                 /* 自己 history.back() 引起、待忽略的 popstate 次数 */
  var raf = 0;
  var seq = 0;                  /* 打开戳自增序号 */

  function q(s, r) { return (r || document).querySelector(s); }
  function txt(el) { return el && el.textContent ? el.textContent : ""; }

  /* ---------- 浮层清单 ----------
     sel  : 判定「开着」的选择器（.open / .show 由各层自己维护）
     close: 优先点它自己的关闭按钮（这样各层的内部状态、遮罩、复位都照原样跑），
            点不到才退回摘 class。
     顺序按视觉**由下往上**排：同一帧里开了两层（比如点抽屉里的设置项）时，
     越靠后的越算上层，返回就先关它。 */
  var LAYERS = [
    { k: "dropdown",   sel: "#dropdown.open",   close: function () { if (typeof window.closeDropdown === "function") window.closeDropdown(); } },
    { k: "drawer",     sel: "#drawer.open",     close: function () { if (typeof window.closeDrawer === "function") window.closeDrawer(); } },
    { k: "subpage",    sel: "#subpage.open",    close: function (el) { click(el, "#spBack"); } },
    /* 求助详情（#r23Detail）不归本层管：mediafull 打开详情就会进全屏并押自己的垫片，
       那一张垫片退出全屏后还继续当详情的「返回垫片」，两层都押会让历史栈对不上。
       全屏/详情的返回手势一律交给 mediafull（见它的 pfHistPush）。 */
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
    guard = 1;
    try { history.pushState({ __yrbGuard: 1 }, "", location.href); }
    catch (e) { guard = 0; }
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

    if (stack.length) { if (!guard) push(); }
    else if (guard) {
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
    var st = e.state;
    if (st && st[GUARD]) return;                        /* 落在我们的占位上：上面被吃掉的是别的层的垫片 */
    if (!guard) return;                                 /* 没押占位：不归本层管 */
    guard = 0;                                          /* 占位已被系统消费掉 */
    /* 打回声戳：这一拍是本层在退自己的浮层（占位押在 mediafull 等层的垫片之上，
       消费后 e.state 会变成它们的垫片，但那条垫片并没有被消费 —— 后执行的层
       看到 400ms 内的回声就让路，垫片留到下一次返回自然轮到它） */
    try { window.__yrbNbEcho = Date.now(); } catch (e) {}
    /* 详情/案例全屏时手势原则上归 mediafull / casedit；
       但如果本层还有浮层开着（比如详情全屏上叠着举报面板，面板 z60 > 详情 z57），
       用户想退的是这层浮层 —— 先关它，全屏留着由 mediafull 继续管 */
    if (foreignFull() && !stack.length) { sync(); return; }
    closeTop();
    sync();                                             /* 还有下级 → 重新押一条 */
  });

  /* ---------- 手动左右滑：任何一级浮层上滑一下都退一级 ---------- */
  var sx = 0, sy = 0, st0 = 0, live = false;

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
    live = false;
    if (!stack.length || !e.touches || e.touches.length !== 1) return;
    /* 2026-11-04 修正（用户截图：详情页上的举报面板滑不退）：
       ① 原来详情全屏（foreignFull）时整体让路 —— 但叠在全屏上的面板（z 更高）没人管；
       ② 原来要求滑动起点落在面板元素内 —— 贴底面板只占下半屏，
          用户从屏幕中部起滑（最自然的手势）起点在详情内容上，永远进不来。
       现在只要本层管着浮层（stack 非空），横滑就是「退一级」的意图：
       竖滑、输入区、视频、横向滚动区在下面逐条排除。 */
    var t = e.touches[0], tgt = e.target;
    if (t.clientX < 26) return;                          /* 贴左边缘留给系统手势 */
    if (tgt.closest && tgt.closest("video,audio,input,textarea,select,[data-noswipe]")) return;
    if (canScrollX(tgt)) return;                          /* 横向列表 / 轮播不抢 */
    sx = t.clientX; sy = t.clientY; st0 = Date.now(); live = true;
  }, { passive: true, capture: true });

  window.addEventListener("touchend", function (e) {
    if (!live) return;
    live = false;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st0;
    if (dt > 800) return;                                 /* 慢慢拖不算滑 */
    if (Math.abs(dx) < 70) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;        /* 竖向滚动不抢 */
    closeTop();
    sync();
  }, { passive: true, capture: true });

  window.addEventListener("touchcancel", function () { live = false; }, { passive: true });

  /* ---------- 启动 ---------- */
  /* 上一次会话残留在历史记录里的占位（bfcache 恢复）先清掉，免得一进来就多一条 */
  try { if (history.state && history.state[GUARD]) history.replaceState(null, "", location.href); } catch (e) {}

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
    closeTop: closeTop,
    sync: sync
  };
})();
