/* =========================================================
   育人帮 · 图片压缩 Worker（img-worker.js）
   目的：把「选完照片后压缩」从主线程搬走。
   背景（2026-10-19）：用户在发布面板一次选多张手机原图，旧实现逐张
   createImageBitmap + canvas.toBlob 全在主线程串行执行，9 张要卡 3~10 秒，
   界面完全没有反馈（老人会以为死机而反复点）。放到 Worker + OffscreenCanvas
   后，主线程只负责插入缩略图。
   约定：只接收 File/Blob，只回传 Blob；任何异常都回 ok:false，由主线程回退。
   ========================================================= */
"use strict";

self.onmessage = async function (e) {
  var d = e.data || {};
  var id = d.id;
  try {
    var out = await compress(d.file, d.maxSide || 1280, d.quality || 0.78);
    self.postMessage({ id: id, ok: true, blob: out.blob, name: out.name, passthrough: !!out.passthrough });
  } catch (err) {
    self.postMessage({ id: id, ok: false, message: String((err && err.message) || err) });
  }
};

async function compress(file, maxSide, quality) {
  var name = file.name || "photo.jpg";
  /* 非位图（gif/svg/heic 等浏览器解不了的）原样放行，交给上传环节 */
  if (!/^image\//.test(file.type || "") || /gif|svg/.test(file.type)) {
    return { blob: file, name: name, passthrough: true };
  }
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return { blob: file, name: name, passthrough: true };
  }

  var bmp = await createImageBitmap(file);
  try {
    var w = bmp.width, h = bmp.height;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    /* 已经够小：不重新编码，避免二次损失画质 */
    if (scale >= 1 && file.size < 900 * 1024) {
      return { blob: file, name: name, passthrough: true };
    }
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(h * scale));
    var cv = new OffscreenCanvas(tw, th);
    var ctx = cv.getContext("2d");
    ctx.drawImage(bmp, 0, 0, tw, th);
    var blob = await cv.convertToBlob({ type: "image/jpeg", quality: quality });
    if (!blob) return { blob: file, name: name, passthrough: true };
    return {
      blob: blob,
      name: name.replace(/\.[^.]+$/, "") + ".jpg"
    };
  } finally {
    try { bmp.close && bmp.close(); } catch (e) {}
  }
}
