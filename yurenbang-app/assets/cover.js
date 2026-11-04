/* =========================================================
   育人帮 · 案例封面层（cover.js，2026-10-24 / v2 2026-11-03）
   需求：每个案例都有封面——已上传的 PPT 打开就能直接看到第一页。
   实现：
   · PPT 文件案例 → 调 YRB_PPT.thumb() 离屏渲染第一页（localStorage 缓存）
   · 视频案例 → 确保停在第一帧（loadeddata 后 seek 0.001）
   · 图片案例 → caseThumb 本来就用真实首图，不处理
   · 图文案例（casedit 正文，无素材）→ v2 新增：缩略图直接渲染「文档首页」
     （有图→正文首图当封面；无图→白纸+首行标题+正文前几行真实文字），
     浏览者在案例广场就能看到主要内容，不再只是通用插画
   渲染排队串行（一次只下载一个 PPT），失败保持 📄 占位（优雅降级）。
   导出：window.YRB_COVER = { refresh, version }
   ========================================================= */
(function () {
"use strict";
var VERSION = "2";
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

/* ---------- 图文案例：缩略图渲染「文档首页」（2026-11-03） ----------
   背景：案例广场里 casedit 图文案例（无图片素材）原来只显示通用插画，
   浏览者从卡片上看不出这篇写了什么，必须先点开才知道值不值得看。
   现在把正文首页直接画到缩略图上：
   · 正文第一张图能取到地址 → 用图当封面（画面首页）
   · 否则 → 白纸底 + 首行标题 + 正文前几段（文字文档首页）
   做法：DOMParser 只读解析，节点用 createElement/textContent 拼，
   绝不把云端字符串拼进 innerHTML（正文是用户内容）。 */
function firstBlockText(root) {
  var blocks = root.querySelectorAll ? root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote") : [];
  var out = [], seen = {};
  for (var i = 0; i < blocks.length && out.length < 4; i++) {
    var t = String(blocks[i].textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length < 2) continue;
    if (seen[t]) continue;
    seen[t] = 1;
    out.push(t);
  }
  return out;
}
function docFirst(c) {
  var raw = String((c && c.content_html) || "").slice(0, 20000);   /* 首页只需前 2 万字，防大字段卡主线程 */
  if (!raw.trim()) return null;
  var root = null;
  try {
    var doc = new DOMParser().parseFromString("<div>" + raw + "</div>", "text/html");
    root = doc.body.firstChild || doc.body;
  } catch (e) { return null; }
  if (!root) return null;
  var lines = firstBlockText(root);
  /* 正文首图：data-yrb-media 序号 → 云素材缩略图/地址；只接受 http(s)/data 地址 */
  var img = null, el = null;
  try { el = root.querySelector ? root.querySelector("img[data-yrb-media],img[src]") : null; } catch (e) {}
  if (el) {
    var k = +el.getAttribute("data-yrb-media");
    var m = (!isNaN(k) && (c.media || [])[k]) || null;
    img = (m && (m.thumbUrl || m.url)) || "";
    if (!img) {
      var src = String(el.getAttribute("src") || "");
      if (/^(https?:|data:image\/)/i.test(src)) img = src;
    }
    if (!img) img = null;
  }
  if (!lines.length && !img) return null;
  /* 首行与卡片标题重复时不再画标题（下方 c-title 已经显示），直接从正文起
     —— 既省一行版面，又不出现「同一句话上下各一遍」 */
  var norm = function (t) { return String(t || "").replace(/[\s，。,.、：:；;！!？?…—\-]/g, ""); };
  var dup = lines.length && norm(lines[0]) === norm(c && c.t);
  var head = dup ? "" : (lines[0] || "");
  var rest = dup ? lines.slice(1, 5) : lines.slice(1, 4);   /* 省掉的那行标题不补进正文 */
  if (!head && !rest.length) return null;
  return { img: img, head: head, rest: rest };
}
function paintDocCard(card, c) {
  if (!card || card.dataset.doccover) return;
  var thumb = $(".c-thumb", card);
  if (!thumb) return;
  /* 已经有真封面（图/视频）、或文件占位 → 不动。
     注意不能只按 media.length 判：素材在但取不到签名地址时（未登录），
     caseThumb 只会画通用插画，这时更该退回文档首页 */
  if ($(".c-photo", thumb) || thumb.querySelector("video") || $(".c-doc", thumb)) return;
  var info = docFirst(c);
  if (!info) return;
  card.dataset.doccover = "1";
  /* 去掉通用插画（.c-type 角标保留，它在原位覆盖在纸上） */
  var svg = thumb.querySelector("svg");
  if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
  if (info.img) {
    var im = document.createElement("img");
    im.className = "c-photo";
    im.alt = "";
    im.loading = "lazy";
    im.src = info.img;
    thumb.insertBefore(im, thumb.firstChild);
    return;
  }
  var paper = document.createElement("div");
  paper.className = "c-paper";
  if (info.head) {
    var h = document.createElement("div");
    h.className = "c-paper-h";
    h.textContent = info.head;
    paper.appendChild(h);
  } else {
    paper.className = "c-paper c-paper-noh";
  }
  info.rest.forEach(function (t) {
    var p = document.createElement("div");
    p.className = "c-paper-t";
    p.textContent = t;
    paper.appendChild(p);
  });
  thumb.insertBefore(paper, thumb.firstChild);
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
    if (!c) return;
    paintCard(card, c);
    try { paintDocCard(card, c); } catch (e) {}
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
