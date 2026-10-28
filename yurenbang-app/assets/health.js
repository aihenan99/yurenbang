/* 育人帮 · 免疫系统（health.js）  2026-10-23
   ------------------------------------------------------------------
   为什么需要它：此前每次故障都是同一个病根——某一层脚本没跑起来（弱网失败、
   缓存 MIME 错配、SW 顶包），功能就"静默消失"，用户看到的是"修这丢那"。

   这一层做四件事，且不改动任何业务层的内部结构：
     1) 功能级探针：不只看 window.YRB_* 标记，还验证关键 DOM/函数真的可用
     2) 分级补载：按依赖顺序重新拉取失败层（async=false 保证顺序），
        退避重试 4 轮（2.5s / 7s / 18s / 40s），带 ?heal=ts 绕开坏缓存
     3) 运行时自愈：资源加载失败即刻补载；页面回到前台时巡检；骨架 DOM
        被别的层重渲染清空时，原地重建（不重载脚本，不刷新页面）
     4) 透明降级：真补不回来就明确告知"哪些功能在修复"，并提供手动重试，
        绝不让功能无声消失

   对外：window.YRB_HEALTH = { status, sweep, heal, log, summary }
   ------------------------------------------------------------------ */
(function () {
  if (window.YRB_HEALTH) { return; }

  var LOG_KEY = "yrb_health_log_v1";
  var MUTE_KEY = "yrb_health_mute_v1";
  var MAX_LOG = 80;
  var RETRY = [2500, 7000, 18000, 40000];   /* 四轮退避，累计约 1 分钟 */
  var HEARTBEAT = 90000;                     /* 心跳巡检间隔 */

  /* ---------------- 层登记表 ----------------
     severity: core=骨架/登录（坏了必须告诉用户）  major=可见入口  minor=增强项 */
  var LAYERS = [
    { id: "app", file: "assets/app.js", flag: "YRB_APP", severity: "core",
      probe: function () {
        return typeof window.renderFuncRow === "function" &&
               typeof window.renderFeed === "function" &&
               !!document.getElementById("feed");
      } },
    { id: "capture", file: "assets/capture.js", flag: "YRB_CAPTURE", severity: "minor",
      probe: function () { return !!window.YRB_CAPTURE; } },
    { id: "refine23", file: "assets/refine23.js", flag: "YRB_R23", severity: "major",
      probe: function () { return !!window.YRB_R23; } },
    { id: "access", file: "assets/access.js", flag: "YRB_MYLIST", severity: "major",
      probe: function () { return !!window.YRB_MYLIST; } },
    { id: "cloud", file: "assets/cloud.js", flag: "YRB_CLOUD", severity: "core",
      probe: function () {
        return !!(window.YRB_CLOUD && typeof window.YRB_CLOUD.ensureLogin === "function");
      } },
    { id: "reward", file: "assets/reward.js", flag: "YRB_REWARD", severity: "minor",
      probe: function () { return !!window.YRB_REWARD; } },
    { id: "jiaojiao", file: "assets/jiaojiao.js", flag: "YRB_JJ", severity: "major",
      probe: function () { return !!window.YRB_JJ; } },
    { id: "pptview", file: "assets/pptview.js", flag: "YRB_PPT", severity: "minor",
      probe: function () { return !!window.YRB_PPT; } },
    { id: "admin", file: "assets/admin.js", flag: "YRB_CONSOLE", severity: "minor",
      probe: function () { return !!window.YRB_CONSOLE; } },
    { id: "adminguard", file: "assets/adminguard.js", flag: "YRB_ADMINGUARD", severity: "minor",
      probe: function () { return !!window.YRB_ADMINGUARD; } },
    { id: "gate", file: "assets/gate.js", flag: "YRB_GATE", severity: "major",
      probe: function () { return !!window.YRB_GATE; } },
    { id: "license", file: "assets/license.js", flag: "YRB_LICENSE", severity: "minor",
      probe: function () { return !!window.YRB_LICENSE; } },
    { id: "profile", file: "assets/profile.js", flag: "YRB_PROFILE", severity: "minor",
      probe: function () { return !!window.YRB_PROFILE; } },
    { id: "food", file: "assets/food.js", flag: "YRB_FOOD", severity: "major",
      probe: function () { return !!window.YRB_FOOD; } },
    { id: "chips", file: "assets/chips.js", flag: "YRB_CHIPS", severity: "major",
      probe: function () { return !!window.YRB_CHIPS; } },
    { id: "rose", file: "assets/rose.js", flag: "YRB_ROSE", severity: "major",
      probe: function () { return !!(window.YRB_ROSE && typeof window.YRB_ROSE.give === "function"); } },
    { id: "account", file: "assets/account.js", flag: "YRB_ACCOUNT", severity: "major",
      probe: function () { return !!window.YRB_ACCOUNT; } },
    { id: "protect", file: "assets/protect.js", flag: "YRB_PROTECT", severity: "major",
      probe: function () { return !!(window.YRB_PROTECT && typeof window.YRB_PROTECT.enabled === "function"); } },
    { id: "mediafull", file: "assets/mediafull.js", flag: "YRB_MEDIAFULL", severity: "minor",
      probe: function () { return !!window.YRB_MEDIAFULL; } },
    { id: "cover", file: "assets/cover.js", flag: "YRB_COVER", severity: "minor",
      probe: function () { return !!window.YRB_COVER; } },
    { id: "casedit", file: "assets/casedit.js", flag: "YRB_CASED", severity: "minor",
      probe: function () { return !!(window.YRB_CASED && typeof window.YRB_CASED.ready === "function"); } },
    { id: "longimg", file: "assets/longimg.js", flag: "YRB_LONGIMG", severity: "minor",
      probe: function () { return !!(window.YRB_LONGIMG && typeof window.YRB_LONGIMG.ready === "function"); } },
    { id: "guard", file: "assets/guard.js", flag: "YRB_GUARD", severity: "minor",
      probe: function () { return !!(window.YRB_GUARD && typeof window.YRB_GUARD.push === "function"); } },
    /* 状态边界层：只有 API 存在即可判活。守卫本身是开发期工具，
       生产环境不装拦截属正常状态，所以**不能**用 enabled 判活。 */
    { id: "state", file: "assets/state.js", flag: "YRB_STATE", severity: "minor",
      probe: function () { return !!(window.YRB_STATE && typeof window.YRB_STATE.report === "function"); } }
  ];

  var ST = {};        /* id -> {state:'ok'|'healing'|'fail', tries, at, why} */
  var busy = {};      /* 正在补载中的层，防止并发重复插入 */
  var muted = 0;
  try { muted = parseInt(localStorage.getItem(MUTE_KEY) || "0", 10) || 0; } catch (e) {}

  /* ---------------- 日志（本地环形缓冲，后台可读） ---------------- */
  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") || []; } catch (e) { return []; }
  }
  function log(evt, layer, msg) {
    var arr = readLog();
    arr.push({ t: Date.now(), evt: evt, layer: layer || "", msg: String(msg || "").slice(0, 160) });
    if (arr.length > MAX_LOG) { arr = arr.slice(arr.length - MAX_LOG); }
    try { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); } catch (e) {}
    if (window.console && console.warn) { console.warn("[免疫]" + evt + " " + (layer || "") + " " + (msg || "")); }
  }

  /* ---------------- 探针 ----------------
     distinguish：
       ok       功能可用
       degraded 脚本已执行（标记在），但功能没就绪 —— 多半是 DOM 被别的层
                重渲染覆盖了。**这种情况绝不能重拉脚本**（会二次初始化、重复绑事件），
                只能走原地重建 + 明确提示
       missing  脚本压根没跑起来（弱网/缓存 MIME 错配/整包失败）—— 才需要补载 */
  function probeOne(L) {
    var ok = false;
    try { ok = !!L.probe(); } catch (e) { ok = false; }
    return ok;
  }
  function diagnose(L) {
    if (probeOne(L)) { return "ok"; }
    var hasFlag = L.flag ? !!window[L.flag] : true;
    return hasFlag ? "degraded" : "missing";
  }
  function stateOf(L) { return (ST[L.id] && ST[L.id].state) || "ok"; }
  function setState(L, s, why) {
    var prev = stateOf(L);
    ST[L.id] = { state: s, at: Date.now(), why: why || "", tries: (ST[L.id] && ST[L.id].tries) || 0 };
    if (prev !== s) { log("state", L.id, prev + " → " + s + (why ? "（" + why + "）" : "")); }
  }

  /* ---------------- 补载（同层串行、层间按依赖顺序） ---------------- */
  function loadLayer(L, cb) {
    if (busy[L.id]) { if (cb) { cb(true); } return; }
    busy[L.id] = true;
    var s = document.createElement("script");
    var done = false;
    s.src = L.file + "?heal=" + Date.now();
    s.async = false;                     /* 动态脚本默认 async，必须关掉才能保序 */
    s.dataset.heal = L.id;
    function finish(ok) {
      if (done) { return; }
      done = true;
      busy[L.id] = false;
      if (cb) { cb(ok); }
    }
    s.onload = function () {
      /* 脚本 onload 到全局可用之间可能有微任务差，给一帧再验 */
      setTimeout(function () { finish(probeOne(L)); }, 120);
    };
    s.onerror = function () { finish(false); };
    /* 兜底：极端情况下 onload/onerror 都不触发（被扩展拦截等） */
    setTimeout(function () { if (!done) { finish(probeOne(L)); } }, 12000);
    document.head.appendChild(s);
  }

  function heal(L, round) {
    round = round || 0;
    /* 脚本已在：功能异常属于"运行时被覆盖"，重拉脚本只会二次初始化 → 不做 */
    if (L.flag && window[L.flag] && !probeOne(L)) {
      setState(L, "degraded", "脚本已加载但功能未就绪（不重载，走原地重建）");
      rebuildSkeleton();
      return;
    }
    if (probeOne(L)) { setState(L, "ok"); return; }
    if (round >= RETRY.length) {
      setState(L, "fail", "重试 " + RETRY.length + " 轮仍失败");
      log("giveup", L.id, "已放弃自动补载，保持降级");
      return;
    }
    setState(L, "healing", "第 " + (round + 1) + " 轮补载");
    ST[L.id].tries = round + 1;
    log("heal", L.id, "补载第 " + (round + 1) + " 轮");
    loadLayer(L, function (ok) {
      if (ok) { setState(L, "ok"); log("recovered", L.id, "已恢复"); }
      else { setTimeout(function () { heal(L, round + 1); }, RETRY[round]); }
    });
  }

  /* ---------------- 全量巡检 ---------------- */
  var lastDegradedLog = 0;
  function sweep(reason) {
    var missing = [], degraded = [];
    LAYERS.forEach(function (L) {
      var d = diagnose(L);
      if (d === "ok") {
        if (stateOf(L) !== "ok") { setState(L, "ok"); log("recovered", L.id, "巡检确认正常"); }
      } else if (d === "missing") {
        missing.push(L);
      } else {
        degraded.push(L);
        if (stateOf(L) !== "degraded") { setState(L, "degraded", "功能未就绪"); }
      }
    });

    /* 按依赖顺序串行补载：app 必须最先回来，否则后面层跑起来也用不了 */
    var i = 0;
    function next() {
      if (i >= missing.length) { banner(); return; }
      var L = missing[i++];
      if (busy[L.id]) { next(); return; }
      if (stateOf(L) === "healing" && (ST[L.id].tries || 0) >= RETRY.length) { next(); return; }
      heal(L, ST[L.id] && ST[L.id].tries ? ST[L.id].tries : 0);
      setTimeout(next, 60);   /* 让出一拍，脚本插入顺序稳定 */
    }

    if (missing.length) {
      log("sweep", "", (reason || "巡检") + "：缺 " + missing.length + " 层 → " +
          missing.map(function (x) { return x.id; }).join(","));
    }
    if (degraded.length && Date.now() - lastDegradedLog > 30000) {
      lastDegradedLog = Date.now();
      log("degraded", "", "功能未就绪（脚本在，节点被覆盖）：" +
          degraded.map(function (x) { return x.id; }).join(",") + " → 尝试原地重建");
    }
    next();

    rebuildSkeleton();
    return { missing: missing.map(function (x) { return x.id; }),
             degraded: degraded.map(function (x) { return x.id; }) };
  }

  /* ---------------- 运行时自愈：骨架 DOM 被别的层重渲染清空时原地重建 ----------------
     这是"入口突然消失"最常见的原因（renderMe / 详情页重渲染覆盖了别的层注入的节点） */
  var lastRebuild = 0;
  function rebuildSkeleton() {
    if (Date.now() - lastRebuild < 8000) { return; }
    var fixed = [];
    try {
      var row = document.getElementById("funcrow");
      if (row && row.children.length === 0 && typeof window.renderFuncRow === "function") {
        window.renderFuncRow(); fixed.push("funcrow");
      }
      var feed = document.getElementById("feed");
      if (feed && feed.children.length === 0 && typeof window.renderFeed === "function") {
        window.renderFeed(); fixed.push("feed");
      }
    } catch (e) { log("error", "skeleton", e && e.message); }
    if (fixed.length) { lastRebuild = Date.now(); log("rebuild", "", "重建骨架：" + fixed.join(",")); }
  }

  /* ---------------- 降级横幅（真修不好时，明确告知而不是静默） ---------------- */
  function ensureStyle() {
    if (document.getElementById("yrbHealthCss")) { return; }
    var css = document.createElement("style");
    css.id = "yrbHealthCss";
    css.textContent =
      "#yrbHealthBar{position:fixed;left:10px;right:10px;top:8px;z-index:99998;display:none;" +
      "align-items:center;gap:9px;padding:10px 12px;border-radius:14px;background:#FFF6E5;" +
      "border:1px solid #F6D9A8;color:#7A4E12;font-size:13px;line-height:1.5;" +
      "box-shadow:0 6px 22px rgba(120,80,20,.16);font-weight:700}" +
      "#yrbHealthBar.show{display:flex}" +
      "#yrbHealthBar .hb-ic{flex:none;font-size:16px}" +
      "#yrbHealthBar .hb-tx{flex:1;min-width:0}" +
      "#yrbHealthBar button{flex:none;border:none;border-radius:99px;padding:7px 13px;font-size:12.5px;" +
      "font-weight:800;background:#F0543C;color:#fff;font-family:inherit}" +
      "#yrbHealthBar button.ghost{background:#fff;color:#7A4E12;border:1px solid #F0D6B4}" +
      "#phone[data-elder=\"1\"] #yrbHealthBar{font-size:15px;padding:12px 14px}" +
      "#phone[data-elder=\"1\"] #yrbHealthBar button{font-size:14px}";
    document.head.appendChild(css);
  }

  function banner() {
    if (Date.now() < muted) { return; }
    /* 只报"确实修不好"或"持续未就绪"的层，避免首屏渲染瞬间误报 */
    function isBad(L) {
      var d = diagnose(L);
      if (d === "ok") { return false; }
      if (d === "missing") { return stateOf(L) === "fail"; }
      return Date.now() - ((ST[L.id] && ST[L.id].at) || 0) > 12000;
    }
    var coreBad = [], majorBad = [];
    LAYERS.forEach(function (L) {
      if (!isBad(L)) { return; }
      if (L.severity === "core") { coreBad.push(L); }
      else if (L.severity === "major") { majorBad.push(L); }
    });
    if (!coreBad.length && majorBad.length < 2) {
      var el0 = document.getElementById("yrbHealthBar");
      if (el0) { el0.classList.remove("show"); }
      return;
    }
    ensureStyle();
    var el = document.getElementById("yrbHealthBar");
    if (!el) {
      el = document.createElement("div");
      el.id = "yrbHealthBar";
      el.innerHTML = '<span class="hb-ic">🛠️</span><span class="hb-tx"></span>' +
                     '<button class="ghost" data-hb="mute">先不管</button>' +
                     '<button data-hb="retry">重试</button>';
      el.addEventListener("click", function (e) {
        var b = e.target.closest("[data-hb]"); if (!b) { return; }
        if (b.dataset.hb === "mute") {
          muted = Date.now() + 30 * 60 * 1000;
          try { localStorage.setItem(MUTE_KEY, String(muted)); } catch (er) {}
          el.classList.remove("show");
          log("mute", "", "用户选择稍后再修（30 分钟不再打扰）");
        } else {
          LAYERS.forEach(function (L) { if (stateOf(L) === "fail") { ST[L.id].tries = 0; } });
          el.classList.remove("show");
          log("manual", "", "用户手动触发重新修复");
          sweep("用户手动重试");
        }
      });
      document.body.appendChild(el);
    }
    el.querySelector(".hb-tx").textContent = coreBad.length
      ? "网络有些波动，正在自动修复…"
      : "部分功能正在修复中（" + majorBad.length + " 项）";
    el.classList.add("show");
    /* 修好了自动收起 */
    if (!banner._timer) {
      banner._timer = setInterval(function () {
        var still = LAYERS.filter(function (L) {
          var d = diagnose(L);
          if (d === "ok") { return false; }
          if (d === "missing") { return stateOf(L) === "fail"; }
          return Date.now() - ((ST[L.id] && ST[L.id].at) || 0) > 12000;
        });
        if (!still.length) {
          var e2 = document.getElementById("yrbHealthBar");
          if (e2) { e2.classList.remove("show"); }
          clearInterval(banner._timer); banner._timer = null;
        }
      }, 3000);
    }
  }

  /* ---------------- 实时捕获 ----------------
     1) 资源级错误：capture 阶段能拿到具体 element，最能定位是哪个文件挂了
     2) 运行时错误：记日志；若连续出现，触发一次巡检（可能是某层半初始化） */
  var rtErrors = 0, lastSweepByErr = 0;
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === "SCRIPT" && t.src) {
        var src = t.src.split("?")[0];
        var L = null;
        for (var i = 0; i < LAYERS.length; i++) {
          if (src.indexOf(LAYERS[i].file) >= 0) { L = LAYERS[i]; break; }
        }
        log("res-error", L ? L.id : "", "脚本加载失败 " + src.split("/").pop());
        if (L && stateOf(L) !== "healing") {
          ST[L.id] = ST[L.id] || {}; ST[L.id].tries = 0;
          heal(L, 0);
        } else if (!L && /bundle\.js/.test(src)) {
          /* bundle 整体失败：退回逐文件补载，等于降级到"多请求但可用" */
          log("res-error", "bundle", "合并包加载失败 → 逐文件补载");
          LAYERS.forEach(function (X) { X.__force = true; });
          sweep("bundle 失败");
        }
      }
      return;
    }
    rtErrors++;
    var msg = (e && e.message) || "";
    log("js-error", "", msg + (e && e.filename ? " @" + String(e.filename).split("/").pop() + ":" + e.lineno : ""));
    if (rtErrors >= 3 && Date.now() - lastSweepByErr > 20000) {
      lastSweepByErr = Date.now();
      setTimeout(function () { sweep("运行时错误累计"); }, 400);
    }
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    log("promise", "", (r && (r.message || r.msg || r)) || "未处理的 Promise 拒绝");
  });

  /* ---------------- 巡检时机 ---------------- */
  function boot() {
    /* 首检：等所有同步脚本执行完（含 bundle），再留一点余量 */
    setTimeout(function () { sweep("启动首检"); }, 1500);
    /* 二次确认：弱网下脚本可能晚到 */
    setTimeout(function () {
      var bad = LAYERS.filter(function (L) { return !probeOne(L); });
      if (bad.length) { sweep("启动复查"); }
    }, 6000);
    /* 回到前台 / 切页回来：手机浏览器常在后台杀脚本上下文，回到前台要确认还活着 */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { setTimeout(function () { sweep("回到前台"); }, 500); }
    });
    window.addEventListener("focus", function () { rebuildSkeleton(); });
    setInterval(function () {
      if (document.visibilityState !== "visible") { return; }
      var bad = LAYERS.filter(function (L) { return !probeOne(L); });
      if (bad.length) { sweep("心跳巡检"); } else { rebuildSkeleton(); banner(); }
    }, HEARTBEAT);
    log("boot", "", "免疫系统就绪，监控 " + LAYERS.length + " 层");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* ---------------- 对外接口 ---------------- */
  window.YRB_HEALTH = {
    version: "1.0",
    layers: function () { return LAYERS.map(function (L) { return L.id; }); },
    status: function () {
      var out = { at: Date.now(), ok: 0, bad: [], degraded: [], detail: {} };
      LAYERS.forEach(function (L) {
        var d = diagnose(L);
        if (d === "ok") { out.ok++; } else { out.bad.push(L.id); }
        if (d === "degraded") { out.degraded.push(L.id); }
        out.detail[L.id] = {
          state: d,
          severity: L.severity,
          tries: (ST[L.id] && ST[L.id].tries) || 0
        };
      });
      out.total = LAYERS.length;
      out.healthy = out.bad.length === 0;
      return out;
    },
    sweep: function (why) { return sweep(why || "手动"); },
    log: readLog,
    clearLog: function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} },
    summary: function () {
      var s = this.status(), l = readLog(), recent = l.slice(-1)[0];
      return { healthy: s.healthy, ok: s.ok + "/" + s.total, bad: s.bad, events: l.length,
               last: recent ? (new Date(recent.t).toLocaleString() + " " + recent.evt + " " + recent.layer + " " + recent.msg) : "无" };
    }
  };
})();
