function shrinkToBudget(file, maxPx, budgetKB, preferPng) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("读取文件失败"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("不是有效图片"));
      img.onload = () => {
        try {
          let w = img.width, h = img.height;
          const r0 = Math.min(1, maxPx / Math.max(w, h));
          w = Math.max(1, Math.round(w * r0)); h = Math.max(1, Math.round(h * r0));
          let q = 0.85;
          const paint = (ww, hh, type, qq) => {
            const cv = document.createElement("canvas");
            cv.width = ww; cv.height = hh;
            cv.getContext("2d").drawImage(img, 0, 0, ww, hh);
            return cv.toDataURL(type, qq);
          };
          /* 二维码：先试无损 PNG（干净二维码本来就小），超预算再转 JPEG */
          if (preferPng) {
            const png = paint(w, h, "image/png");
            if (png.length <= budgetKB * 1365) return resolve(png);   /* base64 膨胀 4/3，再留余量 */
          }
          for (let round = 0; round < 7; round++) {
            const out = paint(w, h, "image/jpeg", q);
            if (out.length <= budgetKB * 1365) return resolve(out);
            if (q > 0.5) q -= 0.12;                                    /* 先降质量 */
            else { w = Math.round(w * 0.78); h = Math.round(h * 0.78); } /* 再缩边 */
            if (w < 200 || h < 200) return resolve(out);               /* 到底了，用最好的一版 */
          }
          resolve(paint(w, h, "image/jpeg", 0.5));
        } catch (e) { reject(e); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}