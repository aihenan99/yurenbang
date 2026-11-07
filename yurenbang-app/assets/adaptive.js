/* ============================================================
   adaptive.js — 使用习惯自适应（2026-11-07）
   ------------------------------------------------------------
   目标：让用户不必自己去设置里调。系统按他实际怎么点、怎么滑，
        自动把「触控容错 / 滑动灵敏度 / 连点保护」调到他顺手的档位。

   ⚠️ 三条底线（改这个文件之前先读）：
   1) 只调「容错」，绝不调「语义」。单击还是单击，不会因为自适应用变成双击；
      也不会把「左滑返回」改成别的动作。手势语义一变，用户会以为手机坏了。
   2) 数据只留在本机。只存聚合计数（今天点空几次、滑短几次），
      不存坐标、不存点击了哪条内容、不发任何网络请求。
      对应 docs/隐私与数据安全评估.md 的「最小必要 + 本地优先」。
   3) 每次只升一档，同一项 7 天冷静期；升级后必须告知，且能一键还原。
      自动调整最怕「悄悄变」——用户不知道变了，只会觉得「这网站今天怪怪的」。

   为什么不用大模型：这套判断的输入是「点空率 / 短滑次数 / 连点次数」三个数，
   规则就够且可解释；接模型反而带来 1) 每次要联网，延迟几百毫秒（正是我们在治的病）
   2) 行为数据必须上传，隐私评估要重做 3) 结果不可解释，用户问「为什么变」答不上来。
   ============================================================ */
(function () {
  "use strict";

  var KEY = "yrb_adapt_v1";
  var DAY = 864e5;
  var COOL = 7 * DAY;        /* 同一项调整的冷静期 */
  var KEEP = 30 * DAY;       /* 计数只留 30 天，不让这个键无限长大 */
  var EVAL_GAP = 20000;      /* 两次评估至少隔 20 秒，避免边点边改 */

  /* 门槛：样本不够就绝不动设置（宁可不调，也不误调） */
  var MIN_TAP = 14, MISS_RATE = 0.18;
  var MIN_SWIPE = 6, SWIPE_RATE = 0.30;
  var MIN_DBL = 5;
  var MIN_VOICE = 6;         /* 一天里点 6 次语音转文字，就算「他习惯说、不习惯打」 */

  var CLICKABLE = "button,a,label,[data-act],[data-ad],[data-ceact],[data-figact],[data-cap-in]," +
                  "[role=button],input,textarea,select,.card,.seg-btn,.switch,.f-chip,.f-add";
  var DEBOUNCE_SEL = ".pa-btn.like,.pa-btn.fav,[data-deb]";
  var SMALL = 120;           /* 只把「小目标」当作可点偏的对象，遮蔽层/大卡片不算 */

  var A = null;
  var saveT = null, evalT = null;
  /* 只有「本次会话真的产生过新计数」才允许回写。
     否则会出现这个真实故障：页面 A 打开着（内存里是空数据），
     用户在别处更新了存储，A 一关就用自己的空快照盖掉 —— 计数白记。
     多标签同时开也会互相覆盖。 */
  var dirty = false;

  function now() { return Date.now(); }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function blank() { return { v: 1, d: {}, tune: {}, last: {}, off: false }; }

  function prune() {
    if (!A) return;
    var cut = now() - KEEP, dead = [], k;
    for (k in A.d) {
      var t = Date.parse(k + "T00:00:00");
      if (isNaN(t) || t < cut) dead.push(k);
    }
    for (var i = 0; i < dead.length; i++) delete A.d[dead[i]];
  }

  function load() {
    if (A) return A;
    A = blank();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var j = JSON.parse(raw);
        if (j && typeof j === "object" && j.v === 1) {
          A.d = j.d || {}; A.tune = j.tune || {}; A.last = j.last || {}; A.off = !!j.off;
        }
      }
    } catch (e) { /* 存储被禁用：退化成「不记录」，功能照常 */ }
    prune();
    return A;
  }
  function save(force) {
    if (!A) return;
    if (!force && !dirty) return;   /* 没产生新数据就不写，避免用陈旧快照覆盖别人 */
    try {
      prune();
      localStorage.setItem(KEY, JSON.stringify(A));
      dirty = false;
    } catch (e) {}
  }
  function day() {
    load();
    var k = today();
    if (!A.d[k]) A.d[k] = { tap: 0, miss: 0, dbl: 0, swOk: 0, swShort: 0, dev: 0, pick: 0, speak: 0, voice: 0 };
    return A.d[k];
  }
  function bump(field, n) {
    if (load().off) return;
    var d = day();
    d[field] = (d[field] || 0) + (n || 1);
    dirty = true;
    /* 落盘节流：连点时不要每次都写 localStorage（写操作本身会卡一下） */
    if (!saveT) saveT = setTimeout(function () { saveT = null; save(); }, 1500);
    /* 评估节流：攒够 20 秒再算一次，避免「点两下就改设置」 */
    if (!evalT) evalT = setTimeout(function () { evalT = null; evaluate(); }, EVAL_GAP);
  }

  /* ---------- 采集 1：点准了没有 ---------- */
  /* 只缓存视口内的可点元素矩形，2.5 秒失效重算。列表很长时也不至于卡。 */
  var rects = [], smallRects = [], rectAt = 0;
  function rebuild() {
    rectAt = now(); rects = []; smallRects = [];
    var list;
    try { list = document.querySelectorAll(CLICKABLE); } catch (e) { return; }
    var vh = window.innerHeight || 800;
    for (var i = 0; i < list.length && i < 600; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      if (r.bottom < -40 || r.top > vh + 40) continue;
      rects.push(r);
      if (r.width <= SMALL && r.height <= SMALL) smallRects.push(r);
    }
  }
  function nearSmall(x, y, pad) {
    if (now() - rectAt > 2500) rebuild();
    for (var i = 0; i < smallRects.length; i++) {
      var r = smallRects[i];
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
    }
    return false;
  }

  var lastEl = null, lastT = 0;
  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var hit = t.closest(CLICKABLE);
    if (hit) {
      bump("tap");
      var tn = now();
      if (lastEl === hit && tn - lastT < 500) bump("dbl");
      lastEl = hit; lastT = tn;
    } else if (nearSmall(e.clientX, e.clientY, 26)) {
      /* 点空了，但 26px 内就有一个小按钮 —— 这就是「点不准」的信号。
         注意用 click 而不是 pointerdown：滚动也会先 pointerdown，那样会把滑动误算成点空。 */
      bump("miss");
    }
  }

  /* ---------- 采集 2：滑动够不够长 ---------- */
  var sx = 0, sy = 0, st = 0;
  function onTS(e) {
    if (!e.touches || e.touches.length !== 1) { st = 0; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = now();
  }
  function onTE(e) {
    if (!st) return;
    var t0 = st; st = 0;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    if (now() - t0 > 800) return;                 /* 慢慢拖不是「想滑」 */
    var dx = t.clientX - sx, dy = t.clientY - sy;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < ady * 1.5) return;                  /* 竖向滚动不算 */
    if (adx >= swipeThreshold()) bump("swOk");
    else if (adx >= 40) bump("swShort");           /* 方向对、力度差一口气 */
  }

  /* ---------- 采集 3：用设备拍/录，还是从相册选 ---------- */
  function onChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute("data-cap-in")) return;
    if (t.hasAttribute("capture")) bump("dev"); else bump("pick");
  }

  /* ---------- 采集 4：朗读 / 语音转文字用得多不多 ---------- */
  function onClickTts(e) {
    var b = e.target.closest && e.target.closest("[data-tts],.pa-btn.speak");
    if (b) { bump("speak"); return; }
    var m = e.target.closest && e.target.closest("#a11yMicP,#a11yMicC");
    if (m) bump("voice");
  }

  /* ---------- 当前生效档位 ---------- */
  function swipeThreshold() {
    load();
    if (A.off) return 70;
    return A.tune.swipe ? 52 : 70;
  }

  /* ---------- 推断 ---------- */
  function evaluate() {
    load();
    if (A.off) return;
    var d = day(), t = now(), changed = "";

    var tap = d.tap || 0, miss = d.miss || 0;
    if (!A.tune.touch && tap + miss >= MIN_TAP && miss / (tap + miss) >= MISS_RATE) {
      A.tune.touch = t; changed = "touch";
    }
    var swOk = d.swOk || 0, swShort = d.swShort || 0;
    if (!A.tune.swipe && swShort >= MIN_SWIPE && swShort / (swShort + swOk + 0.001) >= SWIPE_RATE) {
      A.tune.swipe = t; changed = changed || "swipe";
    }
    if (!A.tune.debounce && (d.dbl || 0) >= MIN_DBL) {
      A.tune.debounce = t; changed = changed || "debounce";
    }
    /* 常用语音转文字 → 把那个入口放大、加一圈提示色。
       注意**不**自动打开麦克风：自动开麦既会吓到人，也会撞权限被拒，
       反而制造出我们一直在治的那种「点了没反应」。 */
    if (!A.tune.voice && (d.voice || 0) >= MIN_VOICE) {
      A.tune.voice = t; changed = changed || "voice";
    }
    if (!changed) return;
    save(true);
    apply();
    announce(changed);
  }

  function apply() {
    load();
    var on = [];
    if (!A.off) {
      if (A.tune.touch) on.push("touch");
      if (A.tune.swipe) on.push("swipe");
      if (A.tune.debounce) on.push("debounce");
      if (A.tune.voice) on.push("voice");
    }
    var el = document.documentElement;
    if (on.length) el.setAttribute("data-adapt", on.join(" "));
    else el.removeAttribute("data-adapt");
  }

  function announce(kind) {
    load();
    var t = now();
    if (A.last.nudge && t - A.last.nudge < DAY) return;   /* 一天最多打扰一次 */
    A.last.nudge = t; save(true);
    var msg = kind === "touch"
      ? "已帮你把按钮调大了一点，点起来更容易。不习惯可在「我的 → 适老设置」改回。"
      : kind === "swipe"
        ? "发现你习惯轻轻一滑，已把返回手势调灵敏了。"
        : kind === "voice"
          ? "发现你常用语音，已经把麦克风按钮放大了。"
          : "已开启防手抖：连点同一个按钮不会再误操作。";
    setTimeout(function () { try { if (window.toast) window.toast(msg); } catch (e) {} }, 1200);
  }

  /* ---------- 连点保护 ---------- */
  /* 只作用于「切换类」（点赞 / 收藏）：连点两下等于「赞了又取消」，
     老人手抖时经常这样，看起来像「点了没反应」。其它按钮一律不拦。 */
  var lastDeb = null, lastDebT = 0;
  function onDebounce(e) {
    load();
    if (A.off || !A.tune.debounce) return;
    var b = e.target.closest && e.target.closest(DEBOUNCE_SEL);
    if (!b) return;
    var t = now();
    if (lastDeb === b && t - lastDebT < 650) {
      e.stopPropagation();
      e.preventDefault();
      try { if (window.toast) window.toast("刚刚已经点过了，已忽略重复点击"); } catch (e2) {}
      return;
    }
    lastDeb = b; lastDebT = t;
  }

  /* ---------- 对外 ---------- */
  function changesText() {
    load();
    var out = [];
    if (A.off) return "自适应已关闭，一切按标准设置";
    if (!A.tune.touch && !A.tune.swipe && !A.tune.debounce && !A.tune.voice) return "还在观察你的使用习惯（数据只存在这台手机上）";
    if (A.tune.touch) out.push("按钮点按范围已放大");
    if (A.tune.swipe) out.push("左滑返回已调灵敏");
    if (A.tune.debounce) out.push("点赞/收藏已防连点");
    if (A.tune.voice) out.push("语音输入入口已放大");
    return out.join(" · ");
  }

  window.YRB_ADAPT = {
    ready: true,
    swipeThreshold: swipeThreshold,
    on: function (k) { load(); return !A.off && !!A.tune[k]; },
    off: function () { load(); A.off = true; save(true); apply(); try { window.toast && window.toast("已关闭自动调整，按钮和手势回到标准设置"); } catch (e) {} },
    enable: function () { load(); A.off = false; save(true); apply(); try { window.toast && window.toast("已开启自动调整：会按你的使用习惯微调按钮和手势"); } catch (e) {} },
    isOff: function () { load(); return !!A.off; },
    changesText: changesText,
    snapshot: function () {
      load();
      var d = day();
      return {
        tune: { touch: !!A.tune.touch, swipe: !!A.tune.swipe, debounce: !!A.tune.debounce, voice: !!A.tune.voice },
        off: !!A.off,
        today: {
          tap: d.tap || 0, miss: d.miss || 0, dbl: d.dbl || 0,
          swOk: d.swOk || 0, swShort: d.swShort || 0,
          dev: d.dev || 0, pick: d.pick || 0, speak: d.speak || 0, voice: d.voice || 0
        },
        text: changesText()
      };
    },
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      A = null; dirty = false; load(); apply();
      try { window.toast && window.toast("已恢复默认：按钮大小和滑动灵敏度回到标准"); } catch (e) {}
    }
  };

  /* ---------- 启动 ---------- */
  function boot() {
    load();
    apply();
    document.addEventListener("click", onClick, true);
    document.addEventListener("touchstart", onTS, { passive: true, capture: true });
    document.addEventListener("touchend", onTE, { passive: true, capture: true });
    document.addEventListener("change", onChange, true);
    document.addEventListener("click", onClickTts, true);
    document.addEventListener("click", onDebounce, true);
    /* 页面被切走时立刻落盘：攒着的计数不能因为用户直接划掉就丢 */
    window.addEventListener("pagehide", function () { if (saveT) { clearTimeout(saveT); saveT = null; } save(); });
    /* 进来先评估一次：昨天攒够的数据今天生效，不用等用户再点 14 下 */
    setTimeout(evaluate, 3000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
