/* 育人帮 · 错误监控与守护层（guard.js）  2026-10-25
   ------------------------------------------------------------------
   背景：免疫系统（health.js）解决"层没加载起来"的自愈；但它只把错误记在
   本机 localStorage 里，后台看不到。用户手机上崩了、读不出什么错，
   运营者无从知晓——本层把这条链路补上：

     1) 全局捕获：JS 运行时错误 / 未处理的 Promise 拒绝 / 脚本资源加载失败
     2) 本地环形缓冲（最多 40 条，随刷随存）
     3) 云端限频上报 → yb_errlog（匿名可写、无直读权限，只能管理员经 RPC 看）
     4) 后台「🩺 系统健康」页签深度体检时读取，形成"用户侧真实错误"闭环

   设计铁律：
   - 只观察不拦截：绝不 e.preventDefault() 吞错误，不改变任何业务行为
   - 上报限频：单会话最多 12 条；同指纹（kind+msg+src）90 秒内去重；
     云未就绪先攒队列，绝不因监控本身拖慢页面
   - SDK 铁律：client.database.from(...)；client 可能晚到 → 监听
     yrb-cloud-ready + 定时补发，绝不 if(!client) return 一走了之
   ------------------------------------------------------------------ */
(function () {
  if (window.YRB_GUARD) { return; }

  var BUF_KEY = "yrb_guard_v1";      /* 本地环形缓冲（含已上报标记） */
  var Q_KEY = "yrb_guard_q_v1";      /* 待上报队列 */
  var UID_KEY = "yrb_guard_uid_v1";
  var MAX_BUF = 40, MAX_Q = 60;
  var MAX_SEND = 12;                 /* 单会话上报上限 */
  var DEDUP_MS = 90000;              /* 同指纹去重窗口 */
  var sent = 0;
  var seen = {};                     /* 指纹 -> 上次时间 */
  var sending = false;

  function build() {
    try { return document.documentElement.dataset.yrbBuild || ""; } catch (e) { return ""; }
  }
  function uid() {
    try {
      var u = localStorage.getItem(UID_KEY);
      if (!u) {
        u = "u" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(UID_KEY, u);
      }
      return u;
    } catch (e) { return "anon"; }
  }
  function ua() {
    try { return (navigator.userAgent || "").slice(0, 160); } catch (e) { return ""; }
  }
  function read(key, cap) {
    try { return JSON.parse(localStorage.getItem(key) || "[]").slice(-cap); } catch (e) { return []; }
  }
  function save(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr.slice(-cap(key)))); } catch (e) {}
  }
  function cap(key) { return key === Q_KEY ? MAX_Q : MAX_BUF; }

  /* 记录一条（kind: js-error | promise | res-error | manual） */
  function record(kind, msg, src, keepBuf) {
    var it = { t: Date.now(), kind: kind, msg: String(msg || "").slice(0, 300),
               src: String(src || "").slice(0, 160), build: build() };
    var fp = kind + "|" + it.msg + "|" + it.src;
    if (seen[fp] && Date.now() - seen[fp] < DEDUP_MS) { return null; }
    seen[fp] = Date.now();
    if (keepBuf !== false) {
      var buf = read(BUF_KEY, MAX_BUF); buf.push(it); save(BUF_KEY, buf);
    }
    return it;
  }

  /* ---------------- 云端上报 ---------------- */
  function client() {
    try {
      var C = window.YRB_CLOUD;
      return (C && C.enabled && C.enabled() && C.client && C.client.database) ? C : null;
    } catch (e) { return null; }
  }
  function flush(reason) {
    if (sending || sent >= MAX_SEND) { return; }
    var C = client(); if (!C) { return; }
    var q = read(Q_KEY, MAX_Q);
    if (!q.length) { return; }
    var batch = q.slice(0, 5).map(function (x) {
      return { uid: uid(), build: x.build || build(), kind: x.kind, msg: x.msg, src: x.src, ua: ua() };
    });
    sending = true;
    try {
      C.client.database.from("yb_errlog").insert(batch).then(function (r) {
        sending = false;
        if (r && r.error) { /* 上报失败：队列原样保留，等下一轮补发 */ }
        else { q.splice(0, batch.length); save(Q_KEY, q); sent += batch.length; }
      }).catch(function () { sending = false; });
    } catch (e) { sending = false; }
  }
  function enqueue(it) {
    if (!it || sent >= MAX_SEND) { return; }
    var q = read(Q_KEY, MAX_Q); q.push(it); save(Q_KEY, q);
  }

  /* ---------------- 全局捕获（只观察，不拦截） ---------------- */
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t !== window && t.tagName) {
      /* 资源加载失败：health.js 负责补载，这里只记一笔（每种源一次） */
      if (t.tagName === "SCRIPT" && t.src) {
        record("res-error", "脚本加载失败 " + String(t.src).split("/").pop(), t.src);
      }
      return;
    }
    record("js-error", (e && e.message) || "未知脚本错误",
      (e && e.filename ? String(e.filename).split("/").pop() + ":" + e.lineno : ""));
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    record("promise", (r && (r.message || r.msg || r)) || "未处理的 Promise 拒绝", "");
  });

  /* ---------------- 上报时机 ---------------- */
  document.addEventListener("yrb-cloud-ready", function () { setTimeout(function () { flush("cloud-ready"); }, 2500); });
  setInterval(function () {
    if (document.visibilityState !== "visible") { return; }
    flush("timer");
  }, 45000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { setTimeout(function () { flush("visible"); }, 4000); }
  });

  /* ---------------- 对外接口 ---------------- */
  window.YRB_GUARD = {
    version: "1.0",
    /* 注入一条测试/人工记录（后台演练用） */
    push: function (kind, msg, src) { var it = record(kind || "manual", msg, src); if (it) { enqueue(it); setTimeout(flush, 300); } return !!it; },
    recent: function () { return read(BUF_KEY, MAX_BUF).slice(-15).reverse(); },
    status: function () {
      return { sent: sent, max: MAX_SEND, pending: read(Q_KEY, MAX_Q).length,
               uid: uid(), build: build(),
               cloud: !!client() };
    },
    flush: flush
  };
})();
