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
var VERSION = "1";

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

/* 云端 AI 真人语音（/yrbtts → 微软云扬，央视播音员音色），失败退回本机语音。
   ctx：朗读来源 detail|case|card —— 卡片朗读时详情/查看器都是关闭态，
   关闭即停的观察者只对 detail/case 生效，绝不能掐断卡片朗读 */
function speak(text, btn, compact, ctx) {
  if (speaking && btn === curBtn) { stopSpeak(); return; }
  stopSpeak();
  speakCtx = ctx || "card";
  var t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 3600);
  if (!t) { try { toast("这一页没有可朗读的文字"); } catch (e) {} return; }
  var g = ++gen;
  speaking = true; curBtn = btn; curCompact = !!compact; setBtn(true, compact);
  if (!cloudOk || !window.Audio) { speakLocal(t, btn, g, compact); return; }
  var slow = (function () { try { var s = getS(); return s && s.elder === "1"; } catch (e) { return false; } })();
  var chunks = splitChunks(t), i = 0, fetches = {};
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
  function done() { if (g !== gen) return; speaking = false; setBtn(false, compact); curBtn = null; }
  next();
}
/* 本机兜底：分段链式 speechSynthesis */
function speakLocal(t, btn, g, compact) {
  if (g !== gen) return;
  if (!("speechSynthesis" in window)) { try { toast("当前浏览器不支持语音朗读"); } catch (e) {} done2(g, compact); return; }
  var chunks = splitChunks(t), i = 0;
  var rate = 1;
  try { var s = getS(); rate = s && s.elder === "1" ? 0.85 : 1; } catch (e) {}
  function done2(gg, cp) { if (gg !== gen) return; speaking = false; setBtn(false, cp); curBtn = null; }
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
  }
}

/* ---------- 3. 案例图片点击放大（复用 r23Viewer 大图层） ---------- */
document.addEventListener("click", function (e) {
  var im = e.target.closest && e.target.closest(".vw-imgs img");
  if (!im) return;
  e.stopPropagation();
  var big = $("#r23Big"), vw = $("#r23Viewer");
  if (!big || !vw) return;
  /* 2026-10-29 审核 M6：src 值来自云端 media url，改 createElement 消除属性逃逸注入面 */
  var img = document.createElement("img");
  img.src = im.getAttribute("src");
  img.alt = "查看大图";
  img.style.cssText = "width:100%;display:block";
  big.innerHTML = "";
  big.appendChild(img);
  vw.classList.add("open");
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

window.YRB_MEDIAFULL = { speak: speak, stopSpeak: stopSpeak, fullVideo: fullVideo, version: VERSION };
console.log("[mediafull] ready v" + VERSION);
})();
