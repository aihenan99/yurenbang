/* =========================================================
   育人帮 · 案例封面层（cover.js，2026-10-24）
   需求：每个案例都有封面——已上传的 PPT 打开就能直接看到第一页。
   实现：
   · PPT 文件案例 → 调 YRB_PPT.thumb() 离屏渲染第一页（localStorage 缓存）
   · 视频案例 → 确保停在第一帧（loadeddata 后 seek 0.001）
   · 图片案例 → caseThumb 本来就用真实首图，不处理
   渲染排队串行（一次只下载一个 PPT），失败保持 📄 占位（优雅降级）。
   导出：window.YRB_COVER = { refresh, version }
   ========================================================= */
(function () {
"use strict";
var VERSION = "1";
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function $(s, r) { return (r || document).querySelector(s); }

var KEY = "yrb_pptcover_v1";
function getCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; }
}
/* 找案例里的真实 PPT 文件媒体 */
function fileMedia(c) {
  try {
    return ((c && c.media) || []).filter(function (x) {
      return x && x.kind === "file" && (x.url || x.path);
    })[0] || null;
  } catch (e) { return null; }
}

/* 串行队列：避免一次打开首页并发下载多个 PPT 把弱网挤爆 */
var queue = [], running = false;
function enqueue(job) { queue.push(job); pump(); }
function pump() {
  if (running || !queue.length) return;
  running = true;
  var job = queue.shift();
  job().catch(function () {}).then(function () { running = false; setTimeout(pump, 80); });
}

function applyCover(card, dataURL) {
  var doc = $(".c-doc", card);
  if (!doc) return;
  var img = document.createElement("img");
  img.className = "c-photo c-cover";
  img.src = dataURL;
  img.alt = "封面";
  doc.replaceWith(img);
  var label = $(".c-type", card);
  if (label && /文件/.test(label.textContent || "")) label.textContent = "📊 PPT";
}

function paintCard(card, c) {
  if (!card || card.dataset.cover) return;
  var doc = $(".c-doc", card);
  if (!doc) return;                       /* 已经是真图/视频封面 */
  var m = fileMedia(c);
  if (!m) return;                         /* 演示型 slides 案例无文件，保持原占位 */
  var key = m.path || m.url || "";
  var e = getCache()[key];
  if (e && e.d) {                         /* 缓存命中：同步上封面 */
    card.dataset.cover = "1";
    applyCover(card, e.d);
    return;
  }
  card.dataset.cover = "pend";            /* 排队渲染（防重复入队） */
  var idx = card.dataset.i;
  enqueue(function () {
    return new Promise(function (res) {
      if (!window.YRB_PPT || !YRB_PPT.thumb) return res();
      YRB_PPT.thumb(m).then(function (d) {
        requestAnimationFrame(function () {
          var card2 = document.querySelector('.case-card[data-i="' + idx + '"]');
          if (card2) applyCover(card2, d);
        });
      }).catch(function () { /* 保持 📄 占位 */ }).then(res);
    });
  });
}

function pass() {
  var s = null;
  try { s = (typeof S !== "undefined" && S) || null; } catch (e) {}
  if (!s || !s.cases) return;
  $$("#caseGrid .case-card").forEach(function (card) {
    var c = s.cases[+card.dataset.i];
    if (c) paintCard(card, c);
  });
  /* 视频封面：有些浏览器 preload=metadata 不出首帧，补一次 seek */
  $$("#caseGrid video.c-photo").forEach(function (v) {
    if (v.dataset.cv) return;
    v.dataset.cv = "1";
    v.addEventListener("loadeddata", function () { try { v.currentTime = 0.001; } catch (e) {} });
  });
}

var rt = null;
function schedule() { clearTimeout(rt); rt = setTimeout(pass, 80); }
try {
  new MutationObserver(schedule).observe($("#caseGrid") || document.body, { childList: true, subtree: true });
} catch (e) {}
try { window.addEventListener("yrb-auth", schedule); } catch (e) {}
pass();

window.YRB_COVER = { refresh: pass, version: VERSION };
console.log("[cover] ready v" + VERSION);
})();
