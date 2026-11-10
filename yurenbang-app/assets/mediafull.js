/* =========================================================
   育人帮 · 媒体全屏与语音播读层（mediafull.js，2026-10-24）
   需求：求助/帮助/案例中的 PPT、视频、图片都能全屏；
        文字内容（求助正文 + 帮忙留言 / 案例标题与要点）可语音播读。
   策略：与其他增强层一致——只注入节点 + 事件委托，不改既有结构。
   PPT 全屏由 pptview.js 负责（2026-10-23 已交付），本层不重复。
   导出：window.YRB_MEDIAFULL = { speak, stopSpeak, fullVideo, version }
   ========================================================= */
(function () {
"use strict";
var VERSION = "5";

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

/* app.js 的 S 是顶层 const（词法全局），不是 window.S —— 必须裸读 + 守卫 */
function getS() { try { return (typeof S !== "undefined" && S) || null; } catch (e) { return null; } }

/* ---------- 1. 视频全屏（真实视频 <video controls>） ----------
   Android：requestFullscreen + 申请横屏锁定（横过来屏幕更宽，看得清）；
   iOS Safari：video.webkitEnterFullscreen（系统播放器全屏）；
   失败静默降级——原生控件里通常也有全屏按钮。 */
function fullVideo(v) {
  if (!v) return false;
  try { if (v.webkitEnterFullscreen) { v.webkitEnterFullscreen(); return true; } } catch (e) {}
  try {
    var req = v.requestFullscreen || v.webkitRequestFullscreen || v.webkitRequestFullScreen;
    if (req) {
      var p = req.call(v);
      if (p && p.then) p.then(function () {
        try {
          if (screen.orientation && screen.orientation.lock)
            screen.orientation.lock("landscape").catch(function () {});
        } catch (e) {}
      }).catch(function () {});
      return true;
    }
  } catch (e) {}
  return false;
}

/* 全屏按钮注入：MutationObserver 观察 #r23Detail 与 #viewer（子树），
   给每个 video[controls] 右下角挂一枚 ⛶。dataset.mf 防重入。 */
function injectVideoBtns(root) {
  $$("video[controls]", root).forEach(function (v) {
    if (v.dataset.mf) return;
    v.dataset.mf = "1";
    var host = v.parentNode;
    if (!host) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "mf-vbtn";
    b.setAttribute("aria-label", "全屏播放");
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    b.addEventListener("click", function (e) {
      e.stopPropagation();               /* 不要触发详情页 / 播放容器的其他点击逻辑 */
      fullVideo(v);
    });
    host.classList.add("mf-vhost");
    host.appendChild(b);
  });
}

/* ---------- 2. 语音播读（TTS） ----------
   朗读内容：
   · 求助详情 = 标题 + 正文 + 各条帮忙留言（留言被门槛锁住时不读，尊重访问规则）
   · 案例查看器 = 标题 + 幻灯片要点（老式 slides 案例）+ 真实 PPT 全文
     （pptview 层 pagesFor() 从 ppt/slides/*.xml 提取，逐页读出） */
var speaking = false, curBtn = null, gen = 0, speakCtx = "";   /* detail|case|card */

/* 自动跟读状态（详见第 6 节）：打开 App 自动朗读，滑动跟随换读 */
var autoOn = true, autoReading = false, autoCurId = null, autoSkip = {};
var autoArmed = false, autoTm = 0, autoPill = null;

function setBtn(on, compact) {
  if (curBtn) {
    curBtn.innerHTML = on ? (compact ? "⏹" : "⏹ 停止") : (compact ? "🔊" : "🔊 朗读");
    curBtn.classList.toggle("on", !!on);
  }
}
function stopSpeak() {
  gen++;                                           /* 作废所有进行中的分段链 */
  speakCtx = "";
  try { if (curAudio) { curAudio.pause(); curAudio = null; } } catch (e) {}
  try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) {}
  speaking = false; setBtn(false, curCompact); curBtn = null;
  autoReading = false; autoCurId = null;           /* 跟读状态一并清掉（是否记「跳过」由调用方决定） */
}
/* 长文按句读切分成 ≤180 字的小段：云端合成按段请求（可缓存、可流水线），
   本机兜底也用小段避免超长 utterance 在部分手机浏览器卡死 */
function splitChunks(t) {
  var out = [], cur = "", arr = String(t).split("");
  for (var i = 0; i < arr.length; i++) {
    cur += arr[i];
    if (cur.length >= 180 && /[。！？；!?;，,：:\s]/.test(arr[i])) { out.push(cur); cur = ""; }
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [t];
}
var curAudio = null, curCompact = false;
var cloudOk = true;                                /* 云端失败一次后本轮改走本机 */

/* ---------- 朗读预取（2026-11-03：案例广场「打开就立即有」） ----------
   手指按下案例卡片的一瞬（早于 click 上百毫秒）就开始合成第一段，
   真正打开朗读时直接取现成音频，省掉大半合成等待。
   一次只备一段：新预取作废旧预取；页面滚动即整包作废（滑动不是要打开）。 */
var preCache = {}, preCtl = null;
function prefetch(text, slow) {
  try {
    var t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 3600);
    if (!t || !cloudOk || !window.Audio) return;
    var key = t + "|" + (slow ? "s" : "n");
    if (preCache[key]) return;
    if (preCtl) { try { preCtl.abort(); } catch (e) {} }
    var ctl = window.AbortController ? new AbortController() : null;
    preCtl = ctl;
    var chunks = splitChunks(t);
    var tm = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 9000) : 0;
    var p = fetch("/yrbtts?t=" + encodeURIComponent(chunks[0]) + "&r=" + (slow ? "slow" : "norm"),
        ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error("tts " + r.status); return r.blob(); },
            function (err) { clearTimeout(tm); delete preCache[key]; throw err; });
    preCache[key] = p;
  } catch (e) {}
}
function prefetchCancel() {
  if (preCtl) { try { preCtl.abort(); } catch (e) {} preCtl = null; }
  preCache = {};
}
try { document.addEventListener("scroll", function () { prefetchCancel(); }, { passive: true, capture: true }); } catch (e) {}

/* 云端 AI 真人语音（/yrbtts → 微软云扬，央视播音员音色），失败退回本机语音。
   ctx：朗读来源 detail|case|card —— 卡片朗读时详情/查看器都是关闭态，
   关闭即停的观察者只对 detail/case 生效，绝不能掐断卡片朗读 */
function speak(text, btn, compact, ctx) {
  /* 再点同一来源 = 用户手动停：跟读模块记下这张卡，本会话不再自动重读 */
  if (speaking && btn === curBtn) {
    var sid = autoCurId;
    stopSpeak();
    if (sid != null) autoSkip[sid] = 1;
    return;
  }
  stopSpeak();
  speakCtx = ctx || "card";
  var t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 3600);
  if (!t) { try { toast("这一页没有可朗读的文字"); } catch (e) {} return; }
  var g = ++gen;
  speaking = true; curBtn = btn; curCompact = !!compact; setBtn(true, compact);
  if (speakCtx === "card") autoAdopt(btn);         /* 卡片朗读（手动或自动）都纳入跟读管辖 */
  if (!cloudOk || !window.Audio) { speakLocal(t, btn, g, compact); return; }
  var slow = (function () { try { var s = getS(); return s && s.elder === "1"; } catch (e) { return false; } })();
  var chunks = splitChunks(t), i = 0, fetches = {};
  var pk = t + "|" + (slow ? "s" : "n");            /* 预取命中：第一段已是现成音频，秒开 */
  if (preCache[pk]) { fetches[0] = preCache[pk]; delete preCache[pk]; }
  function getChunk(idx) {
    if (!fetches[idx]) {
      /* 审核 M7（2026-10-29）：无超时则边缘挂起时朗读链永久卡死——9s 取不到响应头就放弃，
         由调用方的 catch 走 fallbackFrom 降级本机朗读 */
      var ctl = window.AbortController ? new AbortController() : null;
      var tm = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 9000) : 0;
      fetches[idx] = fetch("/yrbtts?t=" + encodeURIComponent(chunks[idx]) + "&r=" + (slow ? "slow" : "norm"),
          ctl ? { signal: ctl.signal } : undefined)
        .then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error("tts " + r.status); return r.blob(); },
              function (err) { clearTimeout(tm); throw err; });
    }
    return fetches[idx];
  }
  function fallbackFrom(idx) {
    if (g !== gen) return;
    cloudOk = false;                                /* 本轮会话改走本机，避免反复等超时 */
    try { if (curAudio) { curAudio.pause(); curAudio = null; } } catch (e) {}   /* 先掐掉云端声，绝不能与本机朗读叠声 */
    speakLocal(chunks.slice(idx).join(""), btn, g, compact);
  }
  function next() {
    if (g !== gen) return;
    if (i >= chunks.length) { done(); return; }
    var idx = i++;
    getChunk(idx).then(function (blob) {
      if (g !== gen) return;
      if (idx + 1 < chunks.length) { try { getChunk(idx + 1).catch(function () {}); } catch (e) {} }  /* 播本段时预取下一段 */
      var a = new Audio(URL.createObjectURL(blob));
      curAudio = a;
      var settled = false;                          /* 单发终结守卫：ended/error/catch 只允许一个生效。
                                                       2026-10-25 修复：部分手机 WebView 一段音频失败时
                                                       onerror 与 play().catch 会同时触发，旧代码一个推进
                                                       一个转本机 → 云端与本机两个声音叠加（开头像读两遍） */
      function finishOk() {                         /* 本段正常放完 → 推进下一段 */
        if (settled) return; settled = true;
        try { URL.revokeObjectURL(a.src); } catch (e) {}
        if (g === gen) next();
      }
      function finishFail() {                       /* 本段播不出 → 整链转本机（从本段重读，不跳段） */
        if (settled) return; settled = true;
        try { a.pause(); } catch (e) {}
        fallbackFrom(idx);
      }
      a.onended = finishOk;
      a.onerror = finishFail;                       /* 旧代码这里走 next() 会把没播出的段直接跳过 */
      a.play().catch(finishFail);
    }).catch(function () { if (g === gen) fallbackFrom(idx); });
  }
  function done() { if (g !== gen) return; speaking = false; setBtn(false, compact); curBtn = null; if (speakCtx === "card") autoReading = false; }
  next();
}
/* 本机兜底：分段链式 speechSynthesis */
function speakLocal(t, btn, g, compact) {
  if (g !== gen) return;
  if (!("speechSynthesis" in window)) { try { toast("当前浏览器不支持语音朗读"); } catch (e) {} done2(g, compact); return; }
  var chunks = splitChunks(t), i = 0;
  var rate = 1;
  try { var s = getS(); rate = s && s.elder === "1" ? 0.85 : 1; } catch (e) {}
  function done2(gg, cp) { if (gg !== gen) return; speaking = false; setBtn(false, cp); curBtn = null; if (speakCtx === "card") autoReading = false; }
  function next() {
    if (g !== gen) return;
    if (i >= chunks.length) { done2(g, compact); return; }
    var u = new SpeechSynthesisUtterance(chunks[i++]);
    u.lang = "zh-CN"; u.rate = rate;
    u.onend = next;
    u.onerror = function () { done2(g, compact); };
    try { speechSynthesis.speak(u); } catch (e) { done2(g, compact); }
  }
  next();
}

/* 求助详情整篇文本：标题 + 正文 + 帮忙留言（锁住时不读）
   标题与正文重复时只读正文（2026-10-25 用户反馈：自动标题是正文首句截断，读两遍） */
function titleDupWith(t, x) {
  t = String(t || "").trim(); x = String(x || "").trim();
  if (!t || !x) return false;
  if (t === x) return true;
  var b = t.replace(/[…]+$/, "").replace(/\.{3}$/, "").trim();
  return !!b && x.replace(/\s+/g, " ").indexOf(b.replace(/\s+/g, " ")) === 0;
}
function detailText(p) {
  if (!p) return "";
  var parts = [];
  var t = String(p.title || "").trim(), x = String(p.text || "").trim();
  if (t && !titleDupWith(t, x)) parts.push(t + "。");
  if (x) parts.push(x);
  var locked = false;
  try { locked = $("#r23CmList") && $("#r23CmList").classList.contains("cm-locked"); } catch (e) {}
  if (!locked && p.comments && p.comments.length) {
    var cs = p.comments.filter(function (c) { return c && c.text; }).slice(0, 10);
    if (cs.length) {
      parts.push("共有 " + cs.length + " 条帮忙留言。");
      cs.forEach(function (c, i) {
        parts.push("第 " + (i + 1) + " 条，" + (c.user || "家长") + "说：" + c.text);
      });
    }
  }
  return parts.join(" ");
}

/* 案例文本：标题 + 幻灯片要点（老式 slides 案例）；真实 PPT 文件的
   全文由 pptview 层 pagesFor() 提取，在朗读按钮点击时再并入 */
function caseText() {
  var title = "", c = null;
  try { title = ($("#vwTitle") || {}).textContent || ""; } catch (e) {}
  try {
    var s = getS();
    c = (s && s.cases || []).filter(function (x) { return x.t === title; })[0];
  } catch (e) {}
  var parts = [title];
  if (c && c.slides && c.slides.length) {
    c.slides.forEach(function (s, i) {
      parts.push("第 " + (i + 1) + " 部分，" + s.h + "。");
      (s.lis || []).forEach(function (li) { parts.push(li); });
    });
  }
  return parts.join(" ");
}

/* 案例朗读：老式 slides 直接读；真实 PPT 文件案例先取标题打底，
   再向 pptview 层要全文（ppt/slides/*.xml 提取，打开过就是秒回），
   按「第 N 页」逐页并入。失败退回只读标题，绝不静默无反应 */
function speakCase(btn) {
  var base = caseText();
  var c = null;
  try {
    var s = getS();
    var title = ($("#vwTitle") || {}).textContent || "";
    c = (s && s.cases || []).filter(function (x) { return x.t === title; })[0] || null;
  } catch (e) {}
  var f = c && c.media && c.media[0];
  if (c && c.type === "ppt" && f && f.url && window.YRB_PPT && YRB_PPT.pagesFor) {
    YRB_PPT.pagesFor(f.url, f.path || "").then(function (pages) {
      var parts = [base];
      (pages || []).forEach(function (pg, i) {
        if (pg) parts.push("第 " + (i + 1) + " 页。" + pg);
      });
      speak(parts.join(" "), btn, false, "case");
    }).catch(function () { speak(base, btn, false, "case"); });
  } else {
    speak(base, btn, false, "case");
  }
}

function injectTts() {
  /* 求助详情头部（r23-dhead 内、时间前） */
  var dh = $(".r23-dhead");
  if (dh && !dh.querySelector(".mf-tts")) {
    var b1 = document.createElement("button");
    b1.type = "button"; b1.className = "mf-tts"; b1.innerHTML = "🔊 朗读";
    b1.setAttribute("aria-label", "语音朗读整篇求助与帮忙留言");
    b1.addEventListener("click", function (e) {
      e.stopPropagation();
      var s = getS();
      var id = (s && s.curPost) || null;
      var p = null;
      try { p = (s && s.posts || []).filter(function (x) { return x.id === id; })[0]; } catch (err) {}
      speak(detailText(p), b1, false, "detail");
    });
    dh.appendChild(b1);
    if (speaking && speakCtx === "detail") {       /* 读到一半按钮才注入：状态补上，别让用户找不到「停止」 */
      curBtn = b1; b1.classList.add("on"); b1.innerHTML = "⏹ 停止";
    }
  }
  /* 案例查看器头部（vw-head 内、关闭按钮前） */
  var vh = $(".vw-head");
  if (vh && $("#viewer").classList.contains("open") && !vh.querySelector(".mf-tts")) {
    var b2 = document.createElement("button");
    b2.type = "button"; b2.className = "mf-tts"; b2.innerHTML = "🔊 朗读";
    b2.setAttribute("aria-label", "语音朗读本案例内容");
    b2.addEventListener("click", function (e) {
      e.stopPropagation();
      speakCase(b2);
    });
    vh.insertBefore(b2, $("#vwX"));
    if (speaking && speakCtx === "case") {
      curBtn = b2; b2.classList.add("on"); b2.innerHTML = "⏹ 停止";
    }
  }
}

/* ---------- 3. 案例图片点击放大（复用 r23Viewer 大图层） ----------
   2026-11-10：改走统一的 ivOpen（见第 8 节），这样案例图也有全屏铺满、
   「再点一下返回」和打开时间戳守卫，不再是一份单独的实现。 */
document.addEventListener("click", function (e) {
  var im = e.target.closest && e.target.closest(".vw-imgs img");
  if (!im) return;
  e.stopPropagation();
  ivOpen(im);
}, true);

/* ---------- 3b. 信息流卡片视频：一点即全屏（抖音式，2026-10-25） ----------
   卡片里的视频不带原生控制条，单击画面 = 直接全屏播放（原生控制条在全屏里）。
   捕获阶段拦截，避免同时触发卡片进详情等其他逻辑。 */
document.addEventListener("click", function (e) {
  var v = e.target && e.target.closest && e.target.closest("#feed .m-realvideo video");
  if (!v) return;
  e.stopPropagation();
  e.preventDefault();
  try { v.pause(); } catch (x) {}
  /* 无封面老帖的 video 本体是透明的（.novid 占位层在显示），全屏前还原，
     否则全屏里只有声音没有画面 */
  try { v.style.opacity = "1"; } catch (x) {}
  var ok = false;
  try { ok = fullVideo(v); } catch (x) {}
  if (!ok) { try { v.play(); } catch (x) {} }   /* 极端环境不支持全屏时退回内联播放 */
}, true);

/* ---------- 4. 关闭 / 切页时停止朗读 ---------- */
document.addEventListener("click", function (e) {
  if (e.target.closest && e.target.closest(".r23-dback,.vw-x,.tb-item,#tabbar,.f-chip")) stopSpeak();
}, true);
/* 详情/查看器关闭（class 移除）也停——只在朗读确实来自这两个容器时生效。
   2026-10-24 修复：信息流卡片朗读时两者本来就是关闭态，
   旧条件会把卡片朗读在第一次 DOM 变动时立刻掐断 */
var moCls = new MutationObserver(function () {
  autoSyncPill();                                  /* 开关胶囊跟着页面/启动屏显隐 */
  if (autoReading && overlaysOpen()) { stopSpeak(); return; }   /* 详情/弹层打开 → 跟读让路（不记跳过） */
  if (!speaking) return;
  var d = $("#r23Detail"), v = $("#viewer");
  if (speakCtx === "detail" && d && !d.classList.contains("open")) stopSpeak();
  else if (speakCtx === "case" && v && !v.classList.contains("open")) stopSpeak();
});
try { moCls.observe(document.getElementById("phone") || document.body, { attributes: true, attributeFilter: ["class"], subtree: true }); } catch (e) {}

/* ---------- 5. 视频按钮注入观察者（含首次执行） ---------- */
function pass() {
  try { injectVideoBtns($("#r23Detail")); } catch (e) {}
  try { injectVideoBtns($("#viewer")); } catch (e) {}
  try { injectTts(); } catch (e) {}
  try { autoSyncPill(); } catch (e) {}
}
var rt = null;
function schedule() { clearTimeout(rt); rt = setTimeout(pass, 60); }
var mo = new MutationObserver(schedule);
try {
  mo.observe($("#r23Detail") || document.body, { childList: true, subtree: true });
  mo.observe($("#viewer") || document.body, { childList: true, subtree: true });
} catch (e) {}
pass();
try { window.addEventListener("yrb-auth", schedule); } catch (e) {}

/* ---------- 6. 自动跟读（2026-11-03）：打开 App 自动朗读，滑动跟随换读 ----------
   ① 手势解锁：浏览器禁止无用户手势出声（Cloud 音频 play() / speechSynthesis 同理）。
      启动屏点击、任意触摸/按键都算解锁（Chrome sticky activation——解锁一次，
      本会话内随时可出声）；解锁前静默等待，不报错不重试。
   ② 跟随：#page-home 滚动停稳（350ms 防抖）后，取视口内露出面积最大的卡片换读；
      卡片自带的 🔊 按钮同步点亮。纯图/视频卡没有文字则静默跳过。
   ③ 让路：详情 / 案例查看器 / 弹层 / 其他页签打开时自动暂停（不记跳过），
      回到首页滑动后继续。
   ④ 尊重手动：再点当前卡片的 🔊 = 手动停止，这张卡本会话不再自动重读，
      滑到别的卡才恢复；开关胶囊关闭 = 全部清空。
   ⑤ 开关：#phone 左下悬浮胶囊（z-index 42，浮层阶梯 40-59），
      记忆在 localStorage(yrb_autospeak)，默认开。 */
function overlaysOpen() {
  /* 2026-11-10：#r23Viewer（图片全屏大图）也算浮层——它 z95 会盖住跟读开关胶囊，
     开着大图还继续朗读的话，用户找不到「停」的地方 */
  var sels = ["#r23Detail", "#viewer", "#r23Viewer", "#modal", "#publishSheet", "#subpage", "#commentSheet"];
  for (var i = 0; i < sels.length; i++) {
    var el = document.querySelector(sels[i]);
    if (el && el.classList.contains("open")) return true;
  }
  return false;
}
function cardText(p) {
  if (!p) return "";
  var t = String(p.title || "").trim(), x = String(p.text || "").trim(), parts = [];
  if (t && !titleDupWith(t, x)) parts.push(t + "。");   /* 标题=正文首句截断时不重复读 */
  if (x) parts.push(x);
  return parts.join(" ").slice(0, 1200);                /* 与卡片手动朗读同口径 */
}
/* 视口内露出面积最大的卡片（露出 <60px 视为还没滑到位，不读） */
function pickCard() {
  try {
    var page = $("#page-home"); if (!page) return null;
    var pr = page.getBoundingClientRect();
    var cards = document.querySelectorAll("#feed .card");
    var best = null, bestArea = 0;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      var h = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
      if (h > bestArea) { bestArea = h; best = cards[i]; }
    }
    return bestArea > 60 ? best : null;
  } catch (e) { return null; }
}
function followNow() {
  if (!autoOn || !autoArmed || !autoAllowed()) return;
  if (overlaysOpen()) return;
  try {
    var app = $("#app");
    if (app && app.classList.contains("hidden")) return;      /* 启动屏还没进 App，不出声 */
    var home = $("#page-home");
    if (!home || !home.classList.contains("active")) return;
  } catch (e) { return; }
  var card = pickCard(); if (!card) return;
  var id = card.dataset.id;
  if (id == null || id === autoCurId) return;        /* 同一张卡（读完/在读）不重来 */
  if (autoSkip[id]) return;
  var p = null;
  try { var s = getS(); p = (s && s.posts || []).filter(function (x) { return String(x.id) === String(id); })[0]; } catch (e) {}
  var text = cardText(p);
  if (!text) return;
  var btn = null;
  try { btn = card.querySelector("[data-tts]"); } catch (e) {}
  speak(text, btn, true, "card");                    /* autoAdopt 在 speak 内接管 */
  /* 卡片暂时没有 🔊 按钮（decorateFeed 未跑完）时 adopt 拿不到卡，这里兜底记账，
     否则同一张卡会在每次滚动停稳后被反复重读 */
  autoReading = true; autoCurId = id;
}
function scheduleFollow(ms) { clearTimeout(autoTm); autoTm = setTimeout(followNow, ms || 350); }
/* 环境守卫：自动化测试（navigator.webdriver）与 ?noautospeak=1 调试参数下不出声，
   避免 tests/ 点页面时触发 /yrbtts 造成噪音与 9s 超时拖慢 */
function autoAllowed() {
  try {
    if (navigator.webdriver) return false;
    if (/[?&]noautospeak=1/.test(location.search)) return false;
  } catch (e) {}
  return true;
}
/* 手动/自动的卡片朗读都归属跟读管辖：卡片重建（点赞 renderFeed）后按钮元素会换，
   重新指向新按钮，保证「再点一下=停」和图标状态始终正确 */
function autoAdopt(btn) {
  try {
    var card = btn && btn.closest ? btn.closest(".card") : null;
    if (card && card.dataset.id != null) {
      autoReading = true; autoCurId = card.dataset.id;
      delete autoSkip[autoCurId];
      var b = card.querySelector("[data-tts]");
      if (b && b !== curBtn) { curBtn = b; setBtn(true, true); }
    }
  } catch (e) {}
}
function autoPaintPill() {
  if (!autoPill) return;
  autoPill.innerHTML = autoOn ? "🔊 跟读中" : "🔇 跟读关";
  autoPill.classList.toggle("off", !autoOn);
}
function autoSyncPill() {
  if (!autoPill) return;
  var show = false;
  try {
    var app = $("#app"), sp = $("#splash"), home = $("#page-home");
    show = !!(app && !app.classList.contains("hidden") &&
              (!sp || sp.classList.contains("hidden")) &&
              home && home.classList.contains("active"));
  } catch (e) {}
  autoPill.style.display = show ? "" : "none";
}
function buildAutoPill() {
  var phone = $("#phone");
  if (!phone || autoPill) return;
  autoPill = document.createElement("button");
  autoPill.type = "button"; autoPill.id = "mfAuto";
  autoPill.setAttribute("aria-label", "自动朗读开关：打开后自动朗读首屏内容，滑动时跟着换");
  autoPill.addEventListener("click", function (e) {
    e.stopPropagation();
    autoOn = !autoOn;
    try { localStorage.setItem("yrb_autospeak", autoOn ? "1" : "0"); } catch (err) {}
    autoPaintPill();
    if (autoOn) { autoSkip = {}; autoArmed = autoAllowed(); scheduleFollow(120); }
    else stopSpeak();
  });
  phone.appendChild(autoPill);
  autoPaintPill();
  autoSyncPill();
}
/* 初始化：开关胶囊、滚动跟随、信息流重建跟随、手势解锁 */
try { autoOn = localStorage.getItem("yrb_autospeak") !== "0"; } catch (e) {}
buildAutoPill();
try {
  var ph = $("#page-home");
  if (ph) ph.addEventListener("scroll", function () { scheduleFollow(350); }, { passive: true });
} catch (e) {}
try {
  new MutationObserver(function () {
    if (autoOn && !autoReading) scheduleFollow(600);          /* 首屏渲染 / 换内容后自动开读 */
    else if (autoReading && autoCurId != null) {              /* 朗读中卡片被重建 → 重新指按钮 */
      var c = document.querySelector('#feed .card[data-id="' + autoCurId + '"]');
      if (c) { var b = c.querySelector("[data-tts]"); if (b && b !== curBtn) { curBtn = b; curCompact = true; setBtn(true, true); } }
    }
  }).observe($("#feed") || document.body, { childList: true });
} catch (e) {}
(function autoArm() {
  function arm() { if (autoArmed || !autoAllowed()) return; autoArmed = true; scheduleFollow(150); }
  ["pointerdown", "touchend", "mousedown", "keydown"].forEach(function (ev) {
    try { document.addEventListener(ev, arm, true); } catch (e) {}
  });
})();

/* ---------- 7. 求助全屏阅读：点一下全屏，左右滑退出，上下滑换一条（2026-11-03） ----------
   需求：所有求助画面，点一下就转全屏；左右滑退出；上下滑换上一条/下一条。
   做法：「点」自己判（pointerdown→pointerup 位移 <12px、时长 <600ms，否则算滚动）；
   滑动手势走 touchstart/touchend，竖滑锚定滚动边缘防误触（见 pfSw 注释）。
   · 点卡片文字/空白（按钮、图片、播放器除外）→ 打开求助详情 + 全屏 + 从头朗读
   · 点详情正文/空白 → 进全屏 + 从头朗读；全屏中再点一下 → 退出全屏（朗读继续）
   · 全屏中左右滑 → 退出全屏；上滑（到底）→ 下一条，下滑（在顶）→ 上一条，自动接着读
   · 只加一个 .mf-fs 类，不改 refine23 的 .open 显隐逻辑 */
var pfFs = false, pfTm = 0, pfPostId = null, pfAt = 0, pfGuardUntil = 0;
var pfPress = null, pfSw = null;
var pfOptOut = null;                              /* 用户主动退出全屏的那一条：同一条不再自动进 */
var pfHist = 0;                                   /* 历史栈里是否押了一条「占位记录」（见 pfHistPush） */
var pfExitedAt = 0;                               /* 上次退出全屏的时刻：用来判断 popstate 是不是同一个滑动手势 */
var pfWant = 0;                                   /* 最近一次「从信息流点开详情」的时间 */

function pfDetailOpen() {
  var d = $("#r23Detail");
  return !!(d && d.classList.contains("open"));
}
function pfTip() {
  try {
    var d = $("#r23Detail");
    if (!d || $("#mfFsTip")) return;
    var el = document.createElement("div");
    el.id = "mfFsTip";
    el.textContent = "左右滑返回上一步 · 上下滑换一条";
    d.appendChild(el);
    setTimeout(function () { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }, 2600);
  } catch (e) {}
}
function pfEnter() {
  var d = $("#r23Detail");
  if (!d || !d.classList.contains("open")) return;
  /* 自愈：标记还在但类被别的层冲掉了（真机上出现过「进来还是卡片态」），补回来 */
  if (pfFs && !d.classList.contains("mf-fs")) {
    d.classList.add("mf-fs");
    return;
  }
  if (pfFs) return;
  pfFs = true; pfAt = Date.now();
  pfOptOut = null;
  pfHistPush();
  d.classList.add("mf-fs");
  try { var ph0 = $("#phone"); if (ph0) ph0.classList.add("mf-pill-low"); } catch (e) {}
  try {
    var b = $(".r23-dbody", d); if (b) b.scrollTop = 0;
    d.scrollTop = 0;
  } catch (e) {}
  /* 2026-11-03 晚：不再调原生 requestFullscreen。
     真机上它有两个副作用：微信/X5 会在几百毫秒后自己退出（用户看到「点了没全屏」），
     退出瞬间重算视口还会把详情层挤偏、左缘漏出底层画面（「左边两个画面」）。
     视觉全屏已由 .mf-fs（fixed 钉满整屏）完成，原生全屏这层壳只会帮倒忙。 */
  pfTip();
  /* 再补一次：有的 WebView 会在打开动画结束、页面重绘时把类刷掉 */
  setTimeout(function () {
    try {
      var v = $("#r23Detail");
      if (pfFs && v && v.classList.contains("open") && !v.classList.contains("mf-fs")) v.classList.add("mf-fs");
    } catch (e) {}
  }, 420);
}
function pfExit() {
  if (!pfFs) return;
  pfFs = false;
  pfExitedAt = Date.now();
  try { var s = getS(); pfOptOut = s && s.curPost != null ? String(s.curPost) : null; } catch (e) { pfOptOut = null; }
  try { var d = $("#r23Detail"); if (d) d.classList.remove("mf-fs"); } catch (e) {}
  try { var ph1 = $("#phone"); if (ph1) ph1.classList.remove("mf-pill-low"); } catch (e) {}
  try { var t = $("#mfFsTip"); if (t && t.parentNode) t.parentNode.removeChild(t); } catch (e) {}
}
function pfCloseDetail() {
  try {
    var d = $("#r23Detail");
    if (d) { d.classList.remove("mf-fs"); d.classList.remove("open"); }
    var ph = $("#phone"); if (ph) ph.classList.remove("mf-pill-low");
  } catch (e) {}
}
/* ---------- 系统返回（手机侧滑 / 返回键）接管：返回上一级，而不是退出应用 ----------
   2026-11-03 用户反馈「全屏里左右滑，整个 APP 退出了」。
   真因不在本层的手势判定，而在**系统手势**：安卓微信/X5、系统 WebView、iOS Safari 的边缘侧滑
   都是「WebView 后退」，比我们 touchend 里那步跑得更早；历史栈本来只有一条记录，
   退一格就直接出了页面（看着像 APP 被关掉）。
   做法：进全屏时往历史栈押一条占位记录。系统后退只能退到这条占位上，被 popstate 接住，
   于是「滑一下 / 按返回」= 退出全屏回到列表（返回上一级），页面本身不会离开。
   占位记录不主动清：全屏退出后它正好充当详情页的「返回垫片」，最后一并按上面的规则消耗掉。 */
function pfHistPush() {
  if (pfHist) return;
  try { history.pushState({ yrbFull: 1 }, ""); pfHist = 1; } catch (e) {}
}
try {
  window.addEventListener("popstate", function () {
    if (!pfHist) return;
    /* 2026-11-04：navback 的占位押在本层垫片之上（举报面板这类叠在全屏/详情上的浮层）。
       两种 popstate 本层都要让路：
       ① 它押着占位（guarded）——这次返回是在消费它的占位，由它关掉叠在上面的浮层并重押；
       ② 它刚主动 back() 还过占位（回声 400ms 内）——那是它自己触发的，更不关本层的事。
       不让路的后果实测：滑关详情上的举报面板时，详情被连带关掉。 */
    try {
      if (window.YRB_NAVBACK && (YRB_NAVBACK.guarded() ||
          (window.__yrbNbEcho && Date.now() - window.__yrbNbEcho < 400))) return;
    } catch (e) {}
    pfHist = 0;                                     /* 占位记录已经被系统消耗掉了 */
    if (pfFs) { pfExit(); return; }                 /* 全屏中返回 → 回到信息流（上一级） */
    if (pfDetailOpen()) { pfCloseDetail(); return; }/* 详情中返回 → 关闭详情（上一级） */
    /* 刚才是页面自己左右滑退出的，同一次手势触发的系统后退也到了：
       不能再 back()，否则会连退两格真的离开应用 */
    if (Date.now() - pfExitedAt < 900) return;
    try { history.back(); } catch (e) {}            /* 用户真的按返回：这层垫片不该挡路 */
  });
} catch (e) {}
/* 详情头部的 🔊 由 injectTts 注入，常比本层晚一拍：等它出现再读，
   否则用户在全屏里找不到「停」的地方 */
function pfSpeak(tries) {
  tries = tries || 0;
  var btn = $(".r23-dhead .mf-tts");
  if (!btn && tries < 6) { setTimeout(function () { pfSpeak(tries + 1); }, 110); return; }
  var p = null;
  try {
    var s = getS();
    p = (s && s.posts || []).filter(function (x) { return String(x.id) === String(pfPostId); })[0];
  } catch (e) {}
  if (!p) return;
  var txt = detailText(p);
  if (!txt) return;
  stopSpeak();                                    /* 全屏重读：先停旧链。不先停的话，同一按钮再 speak
                                                     会被当成「再点一次=停止」，全屏就不出声了 */
  speak(txt, btn, false, "detail");
}
/* 打开详情：走卡片上既有的「📄 查看完整求助」入口（refine23 在捕获阶段接管 openDetail），
   这样不用复制它内部的打开逻辑；按钮偶尔还没注入就重试几次 */
function pfOpen(id, tries) {
  tries = tries || 0;
  var card = document.querySelector('#feed .card[data-id="' + id + '"]');
  var link = card && card.querySelector("[data-r23detail]");
  if (!link) { if (tries < 8) clearTimeout(pfTm), pfTm = setTimeout(function () { pfOpen(id, tries + 1); }, 90); return; }
  pfPostId = id;
  var cur = null;
  try { var s = getS(); cur = s && s.curPost; } catch (e) {}
  if (!pfDetailOpen() || String(cur) !== String(id)) link.click();   /* 已打开同一条就不重复点 */
  pfEnter();
  pfSpeak(0);
}
function pfToggleInDetail() {
  if (pfFs) { pfExit(); return; }
  pfEnter(); pfSpeak(0);
}
/* 上下滑换一条：只换当前信息流里「卡片已渲染出来」的求助 */
function pfStep(dir) {
  var s = null; try { s = getS(); } catch (e) {}
  if (!s || !s.posts || !s.posts.length) return;
  var idx = -1, i;
  for (i = 0; i < s.posts.length; i++) { if (String(s.posts[i].id) === String(pfPostId)) { idx = i; break; } }
  if (idx < 0) return;
  for (i = idx + dir; i >= 0 && i < s.posts.length; i += dir) {
    var n = s.posts[i].id;
    if (document.querySelector('#feed .card[data-id="' + n + '"] [data-r23detail]')) { pfOpen(n, 0); return; }
  }
  try { toast(dir > 0 ? "已经是最后一条了" : "已经是第一条了"); } catch (e) {}
}
/* ---------- 2026-11-03 新交互：点一下 = 全屏，左右滑退出，上下滑换一条 ----------
   「点」用按下/抬起自己判断：手指动了（>12px）就是滚动，不算点；
   按住超 600ms（长按）也不算。双击手势废止——单击已经覆盖它的功能。 */
function pfDown(e) {
  if (e && e.button !== undefined && e.button !== 0) return;      /* 只认左键 / 单指 */
  var t = e && e.target;
  if (!t || !t.closest) return;
  var card = t.closest("#feed .card");
  if (card) {
    /* 2026-11-03 晚：图片/图片容器不再排除——用户点的往往正是照片本身，
       排除 img 就等于「点了没反应」（用户两次反馈「点红色画面不进全屏」）。
       仍然排除：按钮/链接（♥⭐🔊 分享 举报、查看完整求助）、播放器、语音条。
       头像与昵称不排除：点它们进全屏也是同一件事，不亏。
       2026-11-10：img 重新排除——现在点照片会由第 8 节开出「图片全屏大图」，
       用户要的是那张照片，不是这条求助的文字详情；不排除的话 pointerup 会先把文字详情拉起来。 */
    if (t.closest("button,a,input,textarea,select,video,audio,img,picture,.m-realvideo,.m-video,.m-voice")) { pfPress = null; return; }
    /* 2026-11-10：保护层让 img 不可命中，点照片时 target 是 .media —— 按坐标判断，
       点到的确实是照片就交给第 8 节开大图，不在这里进文字详情。
       假数据里的示意 SVG 不算照片，照旧进详情。 */
    var pk = ivPick(t, e.clientX, e.clientY);
    if (pk && ivOk(pk)) { pfPress = null; return; }
    pfPress = { x: e.clientX, y: e.clientY, t: Date.now(), kind: "card", id: card.dataset.id };
    return;
  }
  var d = t.closest("#r23Detail");
  if (d) {
    if (t.closest("button,a,input,textarea,select,video,audio,img,.di,.cm-item,.r23-dvimgs,.r23-dvideo,.r23-dvoice")) { pfPress = null; return; }
    pfPress = { x: e.clientX, y: e.clientY, t: Date.now(), kind: "detail" };
    return;
  }
  pfPress = null;
}
function pfMove(e) {
  if (!pfPress) return;
  var dx = e.clientX - pfPress.x, dy = e.clientY - pfPress.y;
  if (dx * dx + dy * dy > 144) pfPress = null;    /* 动了 = 在滚动/滑动，不是点 */
}
function pfUp(e) {
  if (!pfPress) return;
  var p = pfPress; pfPress = null;
  if (Date.now() - p.t > 600) return;             /* 长按不算点 */
  if (p.kind === "card") {
    if (!p.id) return;
    pfGuardUntil = Date.now() + 600;              /* 残余的 click 一并吃掉，防双重打开 */
    pfWant = Date.now();                          /* 记下「这是从信息流点开的」，供兜底观察者用 */
    pfOpen(p.id, 0);
  } else {
    pfToggleInDetail();
  }
}
try { document.addEventListener("pointerdown", pfDown, true); } catch (e) {}
try { document.addEventListener("pointermove", pfMove, true); } catch (e) {}
try { document.addEventListener("pointerup", pfUp, true); } catch (e) {}
/* 「📄 查看完整求助」按钮也要全屏：按钮被排除在「点一下全屏」之外（怕连点误触），
   但这恰好是长辈最常用的入口，不走这一步就只能看到普通详情页（2026-11-03 用户反馈） */
try {
  document.addEventListener("click", function (e) {
    var l = e.target && e.target.closest ? e.target.closest("#feed [data-r23detail]") : null;
    if (!l) return;
    if (Date.now() - pfAt < 500) return;              /* 卡片点击那条路已经进过全屏，别重复读 */
    var card = l.closest("#feed .card");
    var id = card && card.dataset.id;
    if (!id) return;
    pfWant = Date.now();
    setTimeout(function () {
      if (!pfDetailOpen() || Date.now() - pfAt < 500) return;
      pfPostId = id;
      pfEnter();
      pfSpeak(0);
    }, 140);
  }, true);
} catch (e) {}
/* 兜底 ①：卡片文字上的 click（有的 WebView 会吞掉 pointerup，手势判定失效） */
try {
  document.addEventListener("click", function (e) {
    var t = e.target;
    var card = t && t.closest ? t.closest("#feed .card") : null;
    if (!card) return;
    if (t.closest("button,a,input,textarea,select,video,audio,.m-realvideo,.m-video,.m-voice,.pa-btn")) return;
    /* 2026-11-10：点的是照片（保护层下 target 是 .media）→ 归第 8 节开大图，不进详情 */
    var pk2 = ivPick(t, e.clientX, e.clientY);
    if (pk2 && ivOk(pk2)) return;
    if (Date.now() - pfAt < 500) return;              /* 已经全屏了 */
    if (pfDetailOpen()) return;                        /* 详情已经开着：交给详情内的点击逻辑 */
    var id = card.dataset.id;
    if (!id) return;
    pfWant = Date.now();
    pfOpen(id, 0);
  }, true);
} catch (e) {}
/* 兜底 ②：详情一打开就补全屏——不依赖手势判定，只要它是「刚从信息流点开的」。
   用户主动退出（左右滑/再点一下/返回）会记住这一条，不会再被强行拉回全屏 */
try {
  var pfObs = $("#r23Detail"), pfFix = 0, pfWasOpen = false;
  if (pfObs) new MutationObserver(function () {
    var d = pfObs;
    var nowOpen = d.classList.contains("open");
    if (!nowOpen) {
      if (pfFs) pfExit();
      try { var ph2 = $("#phone"); if (ph2) ph2.classList.remove("mf-pill-low"); } catch (e) {}
      pfOptOut = null;                                 /* 关掉详情：退出记忆一起清掉 */
      pfFix = 0;
      /* 详情被用户正常关掉（点返回/点遮罩）：历史栈里那条占位记录要还回去，
         否则下一次按系统返回键会有一下「按了没反应」。popstate 自己触发的关闭不算（pfHist 已归零） */
      if (pfHist) { pfHist = 0; try { history.back(); } catch (e) {} }
      pfWasOpen = false;
      return;
    }
    /* 只在「由关到开」这一下押垫片：mf-fs 类变化、补类重绘也会进这个分支，
       无条件押会让历史栈越堆越长（每次进/退全屏都多一条） */
    if (!pfWasOpen) { pfWasOpen = true; pfHistPush(); }
    /* 全屏态被别的层刷掉（真机出现「进来还是卡片态」）：补回来，最多 6 次防死循环 */
    if (pfFs && !d.classList.contains("mf-fs")) {
      if (pfFix < 6) { pfFix++; d.classList.add("mf-fs"); }
      return;
    }
    if (pfFs) return;
    var cur = null;
    try { var s = getS(); cur = s && s.curPost; } catch (e) {}
    if (cur != null && pfOptOut != null && String(cur) === String(pfOptOut)) return;
    if (!pfWant || Date.now() - pfWant > 2500) return;  /* 不是从信息流点开的，不强行全屏 */
    pfPostId = cur;
    pfEnter();
    pfSpeak(0);
  }).observe(pfObs, { attributes: true, attributeFilter: ["class"] });
} catch (e) {}
/* ---------- 全屏里的滑动手势（触屏）：左右滑退出；上下滑换一条 ----------
   竖滑做了「锚定」：上滑换下一条只在正文已滚到底部时生效，下滑换上一条
   只在顶部时生效——长文中间的快速滚动绝不会误触换篇。 */
try {
  var pfD2 = $("#r23Detail");
  if (pfD2) {
    pfD2.addEventListener("touchstart", function (e) {
      if (!pfFs || e.touches.length !== 1) { pfSw = null; return; }
      var t = e.target;
      if (t.closest && t.closest("button,a,input,textarea,select,video,audio,img,.di,.r23-dvimgs,.r23-dvideo,.r23-dvoice")) { pfSw = null; return; }
      var T = e.touches[0];
      pfSw = { x: T.clientX, y: T.clientY, t: Date.now() };
    }, { passive: true });
    pfD2.addEventListener("touchend", function (e) {
      if (!pfFs || !pfSw) { pfSw = null; return; }
      var T = e.changedTouches[0];
      var dx = T.clientX - pfSw.x, dy = T.clientY - pfSw.y, dt = Date.now() - pfSw.t;
      pfSw = null;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx > 56 && adx > ady * 1.3 && dt < 600) { pfExit(); return; }   /* 左右滑退出 */
      if (dt > 500 || ady < 64 || ady < adx * 1.2) return;                 /* 不是干净的竖滑 */
      var body = $(".r23-dbody", pfD2);
      var st = body ? body.scrollTop : 0, sh = body ? body.scrollHeight : 0, ch = body ? body.clientHeight : 1;
      if (dy < 0) { if (sh - (st + ch) <= 10) pfStep(1); }                 /* 上滑到底 → 下一条 */
      else { if (st <= 10) pfStep(-1); }                                   /* 下滑在顶 → 上一条 */
    }, { passive: true });
  }
} catch (e) {}
/* 双击后 600ms 内的那次 click 若落在遮罩/空白上，可能被别的层当成「点外部关闭」，一并吃掉 */
try {
  document.addEventListener("click", function (e) {
    if (Date.now() > pfGuardUntil) return;
    var t = e.target;
    if (t && t.closest && t.closest("#feed .card")) { e.preventDefault(); e.stopPropagation(); }
  }, true);
} catch (e) {}
/* 返回/关闭详情 → 收掉全屏类，避免下次打开还是全屏。
   （浏览器的 fullscreenchange 已与本层无关：原生全屏调用已移除，视觉全屏只跟着 .mf-fs 走） */
try {
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("#r23DBack") : null;
    if (b) pfExit();
  }, true);
} catch (e) {}
try {
  var pfD = $("#r23Detail");
  if (pfD) new MutationObserver(function () {
    if (!pfD.classList.contains("open") && pfFs) pfExit();
  }).observe(pfD, { attributes: true, attributeFilter: ["class"] });
} catch (e) {}

/* ---------- 8. 任意图片：点一下（或双击）= 全屏大图；再点一下 / 左右滑 = 返回（2026-11-10） ----------
   起因：① 信息流里点照片，进的是「求助详情全屏」（文字）——用户要看的是那张照片本身；
        ② 详情全屏（.mf-fs，z90）里点图，大图层 z66 被自己这层整个盖住，看着像点了没反应。
   覆盖：信息流卡片图 / 求助详情图 / 帮忙留言图 / 案例图片墙 / 二维码等正文图片。
   排除：按钮与链接里的图标（点了是功能）、头像、渲染后小于 40px 的装饰图、[data-nofull]。
   手势分工：开与关都是「点」；左右滑返回交给 navback（#r23Viewer 已在它 LAYERS 表里）。
        本层不重复接管横滑——两边都接会让一次横滑退两级。 */
var ivAt = 0;                                  /* 本次打开的时刻：吃掉双击的第二下 */

function ivSrc(im) {
  /* data-full 是云端原图（缩略图走 thumbUrl），有就用原图 */
  return im.getAttribute("data-full") || im.currentSrc || im.getAttribute("src") || "";
}
/* 保护层（protect.css）给非管理员的 img 设了 pointer-events:none —— 点图时
   e.target 落在父容器（.media / .di / .cm-item）上，closest("img") 永远是空。
   所以按坐标反查：在最近的容器里找「矩形盖住这一点的 img」。这比依赖
   e.target 稳，也不受后台管理员（html.yrb-pass，图片可点）与长辈模式差异影响。 */
function ivPick(t, x, y) {
  if (!t || !t.closest) return null;
  if (t.tagName === "IMG") return t;
  var scope = t.closest("#feed .card, .r23-dcard, .cm-item, .r23-dimgs, #viewer, .vw-imgs, #shareLayer, #adLayer, #modal, #subpage");
  if (!scope) return null;
  var ims = scope.querySelectorAll("img"), i, r;
  for (i = 0; i < ims.length; i++) {
    r = ims[i].getBoundingClientRect();
    if (r.width >= 40 && r.height >= 40 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return ims[i];
  }
  return null;
}
function ivOk(im) {
  try {
    if (!im || im.dataset.nofull === "1") return false;
    if (im.closest("[data-nofull],button,a,label,select,.p-ava,.ava,.avatar,.logo,#splash")) return false;
    if (!ivSrc(im)) return false;
    var r = im.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return false;   /* 小图标 / 表情图：放大了反而糊 */
  } catch (e) { return false; }
  return true;
}
function ivTip() {
  try {
    var vw = $("#r23Viewer");
    if (!vw || $("#mfIvTip")) return;
    var el = document.createElement("div");
    el.id = "mfIvTip";
    el.textContent = "点一下或左右滑返回";
    vw.appendChild(el);
    setTimeout(function () { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }, 2600);
  } catch (e) {}
}
function ivOpen(im) {
  var big = $("#r23Big"), vw = $("#r23Viewer");
  if (!big || !vw) return false;
  /* 2026-10-29 审核 M6：src 来自云端 media url，用 createElement 赋值，消除属性逃逸注入面 */
  var el = document.createElement("img");
  el.src = ivSrc(im);
  el.alt = im.getAttribute("alt") || "查看大图";
  big.innerHTML = "";
  big.appendChild(el);
  vw.classList.add("open", "mf-imgv");
  ivAt = Date.now();
  ivTip();
  return true;
}
function ivClose() {
  var vw = $("#r23Viewer");
  try { var h = $("#mfIvTip"); if (h && h.parentNode) h.parentNode.removeChild(h); } catch (e) {}
  if (vw) vw.classList.remove("open", "mf-imgv");
  ivAt = 0;
}
/* 开：捕获阶段先于卡片「进详情」的判断（第 7 节的 pfDown 已按坐标让开） */
document.addEventListener("click", function (e) {
  var vw = $("#r23Viewer");
  if (vw && vw.classList.contains("open")) return;   /* 已经开着：这一下归「返回」处理 */
  var im = ivPick(e.target, e.clientX, e.clientY);
  if (!im || !ivOk(im)) return;
  e.preventDefault();
  e.stopPropagation();
  ivOpen(im);
}, true);
/* 返回：点查看器任意处（照片本身、黑底、✕ 以外）都关。
   刚打开 420ms 内那一下是双击的第二下，吃掉——否则双击会「开了立刻关」 */
document.addEventListener("click", function (e) {
  var vw = $("#r23Viewer");
  if (!vw || !vw.classList.contains("open")) return;
  var t = e.target;
  if (!t || !t.closest || !t.closest("#r23Viewer")) return;
  if (t.closest("#r23Vx")) return;                   /* ✕ 自己会关，交给它 */
  e.preventDefault();
  e.stopPropagation();
  if (Date.now() - ivAt < 420) return;
  ivClose();
}, true);
/* 被别处关掉（navback 横滑、✕、refine23 点黑底）时收拾残局：
   mf-imgv 留在已关闭的查看器上会让下一次「看案例大图」继承全屏样式 */
try {
  var ivV = $("#r23Viewer");
  if (ivV) new MutationObserver(function () {
    if (!ivV.classList.contains("open") && ivV.classList.contains("mf-imgv")) ivV.classList.remove("mf-imgv");
  }).observe(ivV, { attributes: true, attributeFilter: ["class"] });
} catch (e) {}

window.YRB_MEDIAFULL = { speak: speak, stopSpeak: stopSpeak, fullVideo: fullVideo, prefetch: prefetch, prefetchCancel: prefetchCancel, autoFollow: { enabled: function () { return autoOn; }, state: function () { return { on: autoOn, reading: autoReading, id: autoCurId }; } }, postFull: { on: function () { return pfFs; } }, image: { open: ivOpen, close: ivClose, isOpen: function () { var v = $("#r23Viewer"); return !!(v && v.classList.contains("open") && v.classList.contains("mf-imgv")); } }, version: VERSION };
console.log("[mediafull] ready v" + VERSION);
})();
