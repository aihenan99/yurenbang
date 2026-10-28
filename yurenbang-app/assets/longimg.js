/* ============================================================================
 * longimg.js —— 分享长图层（2026-10-28，工程总纲 M3）
 *
 * 产品决策（用户已拍板）：站内永远纯文字（TTS / SEO / 省流量），
 * 仅微信分享场景用 canvas **现生成**长图——不落库、不占存储、不进云端。
 * 用途：把一条求助变成一张可转发到家长群的图片（"文字做在图片上传播"）。
 *
 * 设计约束（与铁律对齐）：
 *  - 增强层：只注入 + 委托，不改 app.js / refine23 / access 的结构；
 *  - 只读 S.posts，不写任何 S 字段（状态边界契约零新增）；
 *  - 浮层 z-index 90（#modal 的 96 之下）；显隐走 .open；
 *  - 帖子文本只进 canvas fillText（无 innerHTML 注入面）；
 *  - 云隔离期可独立工作：内容全部来自当前内存里的帖子对象。
 * ========================================================================== */
(function () {
  "use strict";

  var W = 750;            /* 逻辑宽度 */
  var SCALE = 2;          /* 输出倍率（清晰度），输出 1500px 宽 */
  var MAX_H = 6800;       /* 逻辑高度上限（*scale 后仍在安全区） */
  var PAD = 30;

  /* ---------- 卡片侧栏注入（幂等 + 观察 rebuild） ---------- */
  function decorate() {
    var feed = document.getElementById("feed");
    if (!feed) return;
    var cards = feed.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var side = cards[i].querySelector(".p-side");
      if (!side || side.querySelector("[data-lg]")) continue;
      var b = document.createElement("button");
      b.className = "pa-btn";
      b.dataset.lg = "1";
      b.type = "button";
      b.setAttribute("aria-label", "生成这张求助的分享长图");
      b.textContent = "🖼";
      side.appendChild(b);
    }
  }
  var decoTimer = null;
  function schedule() {
    if (decoTimer) return;
    decoTimer = setTimeout(function () { decoTimer = null; decorate(); }, 120);
  }
  function startObserve() {
    var feed = document.getElementById("feed");
    if (!feed || feed.dataset.lgObs === "1") return;
    feed.dataset.lgObs = "1";
    new MutationObserver(schedule).observe(feed, { childList: true, subtree: true });
  }

  /* ---------- 文本换行（canvas 无自动换行，中文逐字测量 + 避头点） ---------- */
  var NO_HEAD = "，。！？；：、）」』】》%…!?)]”;:'”";  /* 这些标点不许出现在行首 */
  function wrap(ctx, text, maxW) {
    var lines = [];
    var paras = String(text || "").split(/\n/);
    for (var i = 0; i < paras.length; i++) {
      var cur = "";
      var p = paras[i];
      if (!p) { lines.push(""); continue; }
      for (var j = 0; j < p.length; j++) {
        var next = cur + p[j];
        if (ctx.measureText(next).width > maxW && cur) {
          /* 避头点：若新行以标点开头，把上一行末字带下来 */
          if (NO_HEAD.indexOf(p[j]) >= 0 && cur.length > 1) {
            lines.push(cur.slice(0, -1));
            cur = cur.slice(-1) + p[j];
          } else { lines.push(cur); cur = p[j]; }
        }
        else cur = next;
      }
      lines.push(cur);
    }
    return lines;
  }
  function rr(ctx, x, y, w, h, r) {  /* 圆角矩形路径 */
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 画长图 ---------- */
  function draw(p) {
    var c = document.createElement("canvas");
    c.width = W * SCALE; c.height = MAX_H * SCALE;
    var ctx = c.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "alphabetic";

    /* 纸面 */
    ctx.fillStyle = "#FFF9F3";
    ctx.fillRect(0, 0, W, MAX_H);

    /* 头部：品牌 */
    var y = 44;
    ctx.fillStyle = "#F0543C";
    rr(ctx, PAD, y, 64, 64, 16); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "800 38px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.fillText("育", PAD + 32, y + 46); ctx.textAlign = "left";
    ctx.fillStyle = "#3B2E26";
    ctx.font = "800 30px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("育人帮 · 家长互助社区", PAD + 84, y + 30);
    ctx.fillStyle = "#8C8078";
    ctx.font = "400 21px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("关心下一代，呵护成长 —— 有困惑，发一条", PAD + 84, y + 58);
    y += 64 + 26;

    /* 卡片：作者 + 正文 */
    var cx = PAD, cw = W - PAD * 2;
    var bodyLines = null;
    var LINE_H = 50, BODY_FS = 32, BODY_TOP = y + 96, MAX_LINES = 26;
    var headH = 62, footH = 64, noteH = 0, trunc = false;

    /* 先在临时 ctx 测量（同字体参数） */
    ctx.font = "400 " + BODY_FS + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    var full = String(p.text || "").trim();
    var allLines = wrap(ctx, full, cw - 48);
    if (allLines.length > MAX_LINES) { allLines = allLines.slice(0, MAX_LINES); trunc = true; noteH = 44; }
    bodyLines = allLines;
    var bodyH = bodyLines.length * LINE_H;
    var cardH = headH + 14 + bodyH + (trunc ? noteH : 0) + footH + 10;

    /* 卡片底 */
    ctx.fillStyle = "#FFFFFF";
    rr(ctx, cx, y, cw, cardH, 22); ctx.fill();
    ctx.strokeStyle = "#F3E7DC"; ctx.lineWidth = 1.5; ctx.stroke();

    /* 作者行 */
    var ay = y + 40;
    ctx.fillStyle = "#FFE1D2";
    ctx.beginPath(); ctx.arc(cx + 34, ay + 8, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#B4691F";
    ctx.font = "800 26px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(p.user || "家长").slice(0, 1), cx + 34, ay + 17);
    ctx.textAlign = "left";
    ctx.fillStyle = "#3B2E26";
    ctx.font = "800 28px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(String(p.user || "家长"), cx + 74, ay + 6);
    ctx.fillStyle = "#8C8078";
    ctx.font = "400 20px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(String(p.time || "") + (p.loc ? " · " + p.loc : ""), cx + 74, ay + 36);
    /* 类型标签 */
    var tagTxt = String(p.tag || "求助");
    ctx.font = "800 20px 'PingFang SC','Microsoft YaHei',sans-serif";
    var tw = ctx.measureText(tagTxt).width + 28;
    ctx.fillStyle = "#FFF1DC";
    rr(ctx, cx + cw - tw - 22, ay - 8, tw, 36, 18); ctx.fill();
    ctx.fillStyle = "#B4691F";
    ctx.textAlign = "center";
    ctx.fillText(tagTxt, cx + cw - tw / 2 - 22, ay + 15);
    ctx.textAlign = "left";

    /* 正文 */
    var ty = BODY_TOP;
    ctx.fillStyle = "#3B2E26";
    ctx.font = "400 " + BODY_FS + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    for (var i = 0; i < bodyLines.length; i++) {
      ctx.fillText(bodyLines[i], cx + 24, ty + BODY_FS);
      ty += LINE_H;
    }
    if (trunc) {
      ctx.fillStyle = "#C89A7B";
      ctx.font = "400 22px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText("…内容较长，打开育人帮看全文", cx + 24, ty + 30);
      ty += noteH;
    }

    /* 卡内统计行 */
    var sy = y + cardH - 34;
    ctx.fillStyle = "#8C8078";
    ctx.font = "400 22px 'PingFang SC','Microsoft YaHei',sans-serif";
    var stats = "♥ " + (p.likes || 0) + "    ⭐ " + (p.favs || 0) + "    🤝 " + (p.helps || 0) + " 位家长帮忙";
    ctx.fillText(stats, cx + 24, sy);

    y += cardH + 26;

    /* 底部：引导 + 二维码 */
    var qrH = 0;
    /* 二维码：异步已预载（loadQR），没图就用文字兜底 */
    if (QR_OK && QRImg) {
      qrH = 200;
      ctx.drawImage(QRImg, (W - 170) / 2, y, 170, 170);
      ctx.fillStyle = "#3B2E26";
      ctx.font = "800 24px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("微信扫一扫 · 免费进入家长互助社区", W / 2, y + 204);
      ctx.textAlign = "left";
      y += qrH;
    } else {
      ctx.fillStyle = "#3B2E26";
      ctx.font = "800 26px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("搜索「育人帮」或访问 xn--gmqq09al6z.cn", W / 2, y + 34);
      ctx.textAlign = "left";
      y += 60;
    }

    /* 页脚水印 */
    ctx.fillStyle = "#C9BDB2";
    ctx.font = "400 18px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("社区互助不能代替专业救助 · 紧急情况请拨 110 / 120 · 青少年服务热线 12355", W / 2, MAX_H - 30);
    ctx.textAlign = "left";

    /* 裁剪到实际高度再输出 */
    var outH = Math.min(Math.ceil(y + 60), MAX_H);
    var out = document.createElement("canvas");
    out.width = W * SCALE; out.height = outH * SCALE;
    var octx = out.getContext("2d");
    octx.fillStyle = "#FFF9F3"; octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(c, 0, 0);
    return out.toDataURL("image/jpeg", 0.92);
  }

  /* ---------- 二维码预载（同源资源，不会污染画布） ---------- */
  var QRImg = null, QR_OK = false;
  (function loadQR() {
    var im = new Image();
    im.onload = function () { QRImg = im; QR_OK = true; };
    im.onerror = function () { QR_OK = false; };
    im.src = "assets/qr-share.png";
  })();

  /* ---------- 浮层 ---------- */
  var overlay = null;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "lg-mask";
    overlay.innerHTML =
      '<div class="lg-box" role="dialog" aria-label="分享长图预览">' +
      '  <div class="lg-bar"><span class="t">🖼 分享长图</span>' +
      '    <button type="button" class="lg-x" data-lgx="close" aria-label="关闭">✕</button></div>' +
      '  <div class="lg-scroll"><div class="lg-busy">正在生成图片…</div></div>' +
      '  <div class="lg-tip">微信里长按图片 →「保存图片」，再转发到家长群</div>' +
      '  <div class="lg-acts">' +
      '    <button type="button" class="lg-save" data-lgx="save">⬇️ 保存图片</button>' +
      '    <button type="button" class="lg-close" data-lgx="close">关闭</button>' +
      '  </div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lgx]");
      if (!b) { if (e.target === overlay) close(); return; }
      var a = b.dataset.lgx;
      if (a === "close") close();
      if (a === "save") save();
    });
    return overlay;
  }
  function close() { if (overlay) overlay.classList.remove("open"); }
  var lastURL = null, lastFile = null;
  function save() {
    if (!lastURL) return;
    /* 优先系统分享（安卓 Chrome / iOS Safari 可直接发微信）；不行就触发下载 */
    if (navigator.canShare && lastFile && navigator.canShare({ files: [lastFile] })) {
      navigator.share({ files: [lastFile], title: "育人帮 · 家长互助" }).catch(function () {});
      return;
    }
    try {
      var a = document.createElement("a");
      a.href = lastURL; a.download = "yurenbang-" + Date.now() + ".jpg";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* 微信内置浏览器：靠长按保存，静默即可 */ }
  }

  function open(card) {
    var id = +card.dataset.id;
    var p = null;
    try { p = S.posts.find(function (x) { return x.id === id; }); } catch (e) {}
    if (!p) return;
    var el = ensureOverlay();
    el.classList.add("open");
    /* 让浮层先画出来，再异步出图（大帖不卡 UI） */
    setTimeout(function () {
      try {
        lastURL = draw(p);
        lastFile = null;
        try {
          var arr = atob(lastURL.split(",")[1]);
          var buf = new Uint8Array(arr.length);
          for (var i = 0; i < arr.length; i++) buf[i] = arr.charCodeAt(i);
          lastFile = new File([buf], "yurenbang.jpg", { type: "image/jpeg" });
        } catch (e) {}
        var sc = el.querySelector(".lg-scroll");
        sc.innerHTML = '<img alt="求助内容长图" src="' + lastURL + '">';
      } catch (e) {
        close();
        if (window.YRB_APP && typeof window.toast === "function") try { window.toast("生成失败，请重试"); } catch (e2) {}
      }
    }, 60);
  }

  /* ---------- 事件委托 ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-lg]");
    if (!b) return;
    var card = b.closest(".card");
    if (card) open(card);
  });

  /* ---------- 启动 ---------- */
  function boot() { startObserve(); schedule(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("yrb-cloud-ready", schedule);

  window.YRB_LONGIMG = { open: open, close: close, ready: function () { return true; } };
})();
