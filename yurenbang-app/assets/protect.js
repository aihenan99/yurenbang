/*!
 * protect.js — 内容保护层（2026-10-23）
 * ---------------------------------------------------------------------------
 * 目标：非管理员用户无法复制、下载、打印、另存本站内容，只能转发分享链接。
 * 原则：
 *   1. 绝不新增/移动任何 DOM 节点 —— 页面里有两个 MutationObserver（refine23 / access），
 *      注入节点会触发详情页重渲染，历史上已因此死循环过。本层只做事件拦截 + CSS。
 *   2. 管理员（后台人员）整体豁免：不加锁、不影响其复制与保存。
 *   3. 分享面板 / 后台 / 输入框是白名单 —— 「转发链接」这条路必须畅通无阻。
 *   4. 拦截时给一句温和提示，并指向「分享」，不弹窗、不报警、不吓到长辈用户。
 * 局限（诚实记录）：内容必须传到浏览器才能显示，懂技术的人仍可通过开发者工具、
 *   抓包或截图获取。本层防的是普通用户的长按保存 / 右键另存 / 复制粘贴 / 打印。
 */
(function () {
  "use strict";
  if (window.YRB_PROTECT) return;

  var ALLOW = "#shareLayer,#shGuide,#adLayer,input,textarea,select,[contenteditable],.yrb-sel";
  var MSG = "内容受保护：不能复制或另存。想给好友看，请用「分享」转发链接";
  var MSG_SHORT = "内容受保护，请用「分享」转发链接给好友";
  var TIP_GAP = 2000;
  var lastTip = 0;

  /* ---------- 管理员判定（后台人员豁免） ---------- */
  function isAdmin() {
    try { if (window.YRB_CONSOLE && YRB_CONSOLE.isAdmin && YRB_CONSOLE.isAdmin()) return true; } catch (e) {}
    try { if (window.YRB_ADMINGUARD && YRB_ADMINGUARD.unlocked && YRB_ADMINGUARD.unlocked()) return true; } catch (e) {}
    return false;
  }

  /* ---------- 白名单判定 ---------- */
  function allowNode(n) {
    var el = n;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!el || el.nodeType !== 1) el = document.activeElement;
    if (!el || el.nodeType !== 1) return false;
    try { return !!el.closest(ALLOW); } catch (e) { return false; }
  }

  /* ---------- 保护是否生效 ---------- */
  function on() {
    return document.documentElement.classList.contains("yrb-guard");
  }

  function refresh() {
    var pass = isAdmin();
    document.documentElement.classList.toggle("yrb-guard", !pass);
    document.documentElement.classList.toggle("yrb-pass", pass);
  }

  /* ---------- 温和提示（复用现有 toast，不创建节点） ---------- */
  function say(msg) {
    if (!on()) return;
    var t = Date.now();
    if (t - lastTip < TIP_GAP) return;
    lastTip = t;
    try {
      if (typeof window.toast === "function") { window.toast(msg); return; }
    } catch (e) {}
    try { if (typeof toast === "function") toast(msg); } catch (e) {}
  }

  /* 1) 右键 / 长按菜单（图片另存、复制链接都从这里来） */
  document.addEventListener("contextmenu", function (e) {
    if (!on() || allowNode(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    say(MSG);
  }, true);

  /* 2) 复制 / 剪切 */
  function blockCopy(e, msg) {
    if (!on() || allowNode(e.target) || allowNode(document.activeElement)) return;
    e.preventDefault();
    e.stopPropagation();
    say(msg);
  }
  document.addEventListener("copy", function (e) { blockCopy(e, MSG); }, true);
  document.addEventListener("cut", function (e) { blockCopy(e, MSG); }, true);

  /* 3) 拖拽（把图片/文字拖到桌面就是下载） */
  document.addEventListener("dragstart", function (e) {
    if (!on() || allowNode(e.target)) return;
    e.preventDefault();
  }, true);

  /* 4) 框选起点（桌面端防拖选） */
  document.addEventListener("selectstart", function (e) {
    if (!on() || allowNode(e.target)) return;
    e.preventDefault();
  }, true);

  /* 5) 快捷键：另存 / 打印 / 源码 / 开发者工具 / 全选复制 */
  document.addEventListener("keydown", function (e) {
    if (!on()) return;
    var k = String(e.key || "").toLowerCase();
    var mod = e.ctrlKey || e.metaKey;

    if (!mod) {
      if (k === "f12") { e.preventDefault(); say(MSG_SHORT); }
      return;
    }
    /* Ctrl/Cmd+Shift+I / J / C 打开开发者工具 */
    if (e.shiftKey && (k === "i" || k === "j" || k === "c")) {
      e.preventDefault(); say(MSG_SHORT); return;
    }
    /* 另存为 / 打印 / 查看源码 */
    if (k === "s" || k === "p" || k === "u") {
      e.preventDefault(); say(MSG_SHORT); return;
    }
    /* 全选 / 复制 / 剪切 */
    if (k === "a" || k === "c" || k === "x") {
      if (allowNode(e.target) || allowNode(document.activeElement)) return;
      e.preventDefault();
      say(MSG_SHORT);
    }
  }, true);

  /* 6) 打印守卫（菜单里的「打印」拦不住按键，但仍要提示） */
  try { window.addEventListener("beforeprint", function () { if (on()) say(MSG_SHORT); }); } catch (e) {}

  /* 7) 防第三方站点嵌套展示（本地调试与预览环境放行） */
  (function () {
    var h = "";
    try { h = String(location.hostname || ""); } catch (e) {}
    var dev = h === "" || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
    if (dev) return;
    var framed = false;
    try { framed = window.top !== window.self; } catch (e) { framed = true; }
    if (framed) document.documentElement.classList.add("yrb-framed");
  })();

  /* ---------- 状态维护：登录/退出/切标签/定时都重算一次 ---------- */
  refresh();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  }
  window.addEventListener("load", refresh);
  window.addEventListener("yrb-auth", refresh);
  window.addEventListener("yrb-cloud-ready", refresh);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  setInterval(function () { if (!document.hidden) refresh(); }, 5000);

  /* 详情页「分享」按钮：原有实现是演示 toast，这里补上真实分享面板 */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-db="share"]') : null;
    if (!b) return;
    try {
      if (window.YRB_CONSOLE && YRB_CONSOLE.openShare) {
        YRB_CONSOLE.openShare();
        if (e.stopPropagation) e.stopPropagation();
      }
    } catch (err) {}
  });

  /* ---------- 对外接口 ---------- */
  window.YRB_PROTECT = {
    refresh: refresh,
    isAdmin: isAdmin,
    enabled: on,
    state: function () { return { guard: on(), admin: isAdmin() }; }
  };
})();
