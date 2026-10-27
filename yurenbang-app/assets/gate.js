/* ============================================================
   育人帮 · 访问门槛层（gate.js）
   ============================================================
   规则（2026-10-16 定稿，20:4x 调整）：
     · 求助内容完全免费 —— 不登录也能看首页、卡片、求助详情正文
     · 查看「帮忙留言」必须先登录 / 注册 —— 只露出条数，内容锁住
     · 发布求助（＋）必须先登录 / 注册
     · 帮忙回应（文字 / 语音 / 微视频）必须先登录 / 注册
     · 云端帖的图片 / 视频保留「🔒 登录后可查看」：这不是增长手段，
       而是云端存储本身有访问权限控制，未登录拿不到素材地址

   实现方式：事件委托（document 捕获阶段）+ 兄弟节点注入 + 容器 class。
   不改动 app.js / refine23.js / cloud.js 的既有结构与监听器。

   ⚠️ 注入位置很关键（踩坑记录）：
     本项目有多个 MutationObserver 盯着 #cmList，而且大多带 subtree:true ——
     其中 access.js 那个还带 260ms 防抖，触发后会重新渲染详情页。
     所以：
       ① 锁面板一律插到 #cmList / #r23CmList 的**兄弟位置**（parentNode 下），
          绝不在这两个容器内部增删节点；
       ② 锁状态用容器上的 **class** 表达（属性变更不会触发 childList 观察）。
     否则「注入 → 观察器 → 重渲染 → 再注入」会死循环。
   ============================================================ */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* cloud.js 在加载顺序上晚于本文件，且登录成功后可能重建对象，因此一律运行时取值 */
  function API() { return window.YRB_CLOUD || null; }

  /* 能否拦截：云服务已就绪才拦。SDK 没加载起来时保持离线演示态，不把用户挡在门外 */
  function canGate() {
    var C = API();
    if (!C || typeof C.ensureLogin !== "function") return false;
    if (typeof C.enabled === "function" && !C.enabled()) return false;
    return true;
  }

  function isIn() {
    var C = API();
    try { return !!(C && C.signedIn && C.signedIn()); } catch (e) { return false; }
  }

  function say(msg) { if (typeof window.toast === "function") window.toast(msg); }

  /* 拉起登录；已经登录则直接 resolve(true) */
  function askLogin() {
    var C = API();
    if (isIn()) return Promise.resolve(true);
    if (C && typeof C.openLogin === "function") { C.openLogin(); return Promise.resolve(false); }
    if (C && typeof C.ensureLogin === "function") return C.ensureLogin();
    return Promise.resolve(false);
  }

  function paintAll() { paintLocks(); syncGateBar(); }

  /* ---------- 统一闸门：未登录 → 先走登录 / 注册，成功后再执行原本的点击 ---------- */
  var replaying = false;

  /**
   * @param {string}   selector 触发元素选择器（多个用逗号）
   * @param {string}   msg      未登录时的提示文案
   * @param {function} [pre]    前置判断；返回 false 则交给原逻辑处理（如内容为空）
   */
  function gate(selector, msg, pre) {
    document.addEventListener("click", function (ev) {
      var el = ev.target.closest(selector);
      if (!el) return;
      if (replaying) return;            /* 是重放：放行给原有逻辑 */
      if (isIn()) return;               /* 已登录：放行 */
      if (pre && !pre(el)) return;      /* 交给原逻辑给出更贴切的提示 */
      if (!canGate()) return;           /* 云服务不可用：不拦 */
      ev.stopPropagation();
      ev.preventDefault();
      say(msg);
      API().ensureLogin().then(function (ok) {
        if (!ok) return;                /* 放弃登录：不执行原动作，用户已填内容原样保留 */
        paintAll();                     /* 不等 yrb-auth 事件，自己刷新一次（更稳） */
        replaying = true;
        try { el.click(); } finally { replaying = false; }
      });
    }, true);
  }

  /* 发布求助：唯一的入口是 ＋ 按钮 */
  gate("#fab", "发布求助需要先登录 / 注册，几秒钟就好～");

  /* 帮忙回应：输入框为空时不算"要发布"，交给原逻辑提示「写点什么再发送吧」 */
  gate("#cmSend", "帮忙回应需要先登录 / 注册，写好的内容会保留～", function () {
    var i = $("#cmInput");
    return !!(i && i.value.trim());
  });

  /* 帮忙的语音 / 微视频回复 */
  gate("#cmVoice, #cmVideo", "语音 / 视频帮忙需要先登录 / 注册～");

  /* 家教需求登记：登记要留下联系方式，需先登录（云端入库也只收登录用户） */
  gate("#jjSubmit", "提交家教登记需要先登录 / 注册，填好的内容会保留～");
  gate("#caseFab", "上传案例需要先登录 / 注册，几秒钟就好～");

  /* ============================================================
     帮忙留言：未登录只显示条数，内容锁住
     ============================================================ */
  var LISTS = [
    { list: "#cmList", id: "cmLock" },        /* 底部「帮忙」面板 */
    { list: "#r23CmList", id: "r23Lock" }     /* 求助详情页内嵌的帮忙列表 */
  ];

  function lockHTML(id, n) {
    return '<div class="cm-lock" id="' + id + '">' +
      '<div class="cm-lock-ic" aria-hidden="true">🔒</div>' +
      '<p class="cm-lock-t">登录后可查看 ' + n + ' 条帮忙留言</p>' +
      '<p class="cm-lock-s">求助内容始终免费浏览</p>' +
      '<button type="button" class="cm-lock-b">登录 / 注册</button>' +
      '</div>';
  }

  /**
   * 这条求助有多少条帮忙留言。
   * 优先用帖子上自带的 helps —— 它是同步就有的（云端帖的留言却是异步拉的），
   * 用它做判断才不会出现「先闪一下『还没有帮忙』、再变成锁」的错帧。
   * 取 max 兜底：本地种子帖 / 本地临时发的帮忙，helps 与 DOM 可能有一方还没跟上。
   */
  function countOf(list) {
    var inDom = list.querySelectorAll(".cm-item").length;
    var helps = 0;
    try {
      if (typeof S !== "undefined" && S && S.posts) {
        var p = S.posts.filter(function (x) { return x.id === S.curPost; })[0];
        if (p) helps = p.helps || 0;
      }
    } catch (e) { /* 读不到就当 0 */ }
    return Math.max(inDom, helps);
  }

  function paintLocks() {
    var guest = !isIn();
    LISTS.forEach(function (cfg) {
      var list = $(cfg.list);
      if (!list) return;
      var lock = document.getElementById(cfg.id);
      var n = countOf(list);

      /* 已登录，或本来就没有帮忙：不需要锁（保留原有的"还没有帮忙"空状态） */
      if (!guest || !n) {
        list.classList.remove("cm-locked");
        if (lock && lock.parentNode) lock.parentNode.removeChild(lock);
        return;
      }

      list.classList.add("cm-locked");
      syncDetailCount(n);                      /* 详情页标题的条数也要用权威计数，别显示 0 */
      if (lock) {                              /* 已在位：只刷新数字 */
        var t = lock.querySelector(".cm-lock-t");
        if (t) t.textContent = "登录后可查看 " + n + " 条帮忙留言";
        return;
      }
      /* 插成兄弟节点，不进 list 内部 —— 见文件头「注入位置很关键」 */
      list.insertAdjacentHTML("beforebegin", lockHTML(cfg.id, n));
    });
  }

  /**
   * 详情页「🤝 帮忙评论 N」的 N 原本来自 DOM 里的留言条数。
   * 真锁之后未登录拉不到留言 → 那里会显示 0，和旁边锁面板的条数自相矛盾。
   * 这里只改那一个数字节点的文本（不在被观察的 #r23CmList 内部，且带等值守卫）。
   */
  function syncDetailCount(n) {
    var el = document.querySelector("#r23Detail .r23-cmhead .n");
    if (el && el.textContent !== String(n)) el.textContent = String(n);
  }

  function anyLocked() {
    for (var i = 0; i < LISTS.length; i++) {
      var l = $(LISTS[i].list);
      if (l && l.classList.contains("cm-locked")) return true;
    }
    return false;
  }

  /* ---------- 帮忙面板里的明示提示条 ---------- */
  function syncGateBar() {
    if (!$("#commentSheet")) return;
    var bar = $("#cmGate");
    if (!bar) {
      var host = $("#cmTools");
      if (!host) return;
      host.insertAdjacentHTML(
        "beforebegin",
        '<div class="cm-gate" id="cmGate">' +
          '<span class="cm-gate-t">登录后即可帮忙回应（求助内容免费浏览）</span>' +
          '<button type="button" class="cm-gate-b" id="cmGateGo">登录 / 注册</button>' +
        "</div>"
      );
      bar = $("#cmGate");
      var go = $("#cmGateGo");
      if (go) go.addEventListener("click", function (ev) {
        ev.stopPropagation();
        askLogin().then(paintAll);
      });
    }
    /* 留言已经被锁住时，大锁面板自带登录按钮，这里就不重复摆了 */
    bar.classList.toggle("show", !isIn() && !anyLocked());
    var barRow = $(".cm-bar");
    if (barRow) barRow.classList.toggle("gate-on", !isIn());
  }

  /* ---------- 锁面板上的「登录 / 注册」 ---------- */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest(".cm-lock-b");
    if (!b) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (isIn()) { paintAll(); return; }
    askLogin().then(paintAll);
  }, true);

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    paintAll();

    /* 登录 / 退出 / 切换账号后自动重绘（cloud.js 会广播 yrb-auth） */
    window.addEventListener("yrb-auth", paintAll);

    /* 只观察直接子节点变化：注入的锁面板在父级 / 祖父级，不会把自己再触发一次。
       注意回调要用 paintAll（而不是只 paintLocks）——消息列表重绘后，
       提示条也要重新判定「是否该让位给大锁面板」。 */
    var cm = $("#cmList");
    if (cm) new MutationObserver(paintAll).observe(cm, { childList: true });

    var dt = $("#r23Detail");
    if (dt) new MutationObserver(paintAll).observe(dt, { childList: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.YRB_GATE = 1;   /* 自愈标记：弱网补载用 */
})();
