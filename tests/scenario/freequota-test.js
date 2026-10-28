/* freequota-test：免费额度专项（预加载拦截、视频封面、图片压缩档位、分页档位）
   背景：用户明确选择免费方案（3000 资源点/月，流量 210 点/GB、存储 1200 点/GB）。
   核心思路不是"少用功能"，而是"不看就不下载、传的就够看"。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass = 0, fail = 0;
const ck = (n, c, d) => { if (c) { pass++; console.log("  ✅", n); } else { fail++; console.log("  ✗", n, d || ""); } };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?fq=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2400);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);

  /* T1 信息流视频卡：preload=none + 用缩略图当 poster（不点就不下载视频） */
  const t1 = await p.evaluate(() => {
    S.posts = [{ id: 991001, __cloud: true, user: "测试", tag: "求助", title: "", text: "视频帖", type: "video", urg: 1, dur: "0:12",
      media: [{ kind: "video", url: "https://ex.com/v.mp4", thumbUrl: "https://ex.com/v.jpg", path: "p/v.mp4", thumb: "p/t-v.jpg" }] }];
    renderFeed();
    const v = document.querySelector("#feed .m-realvideo video");
    if (!v) return null;
    return { preload: v.getAttribute("preload"), poster: v.getAttribute("poster"), src: v.getAttribute("src") };
  });
  ck("信息流视频 preload=none（不看不下载）", !!t1 && t1.preload === "none", JSON.stringify(t1));
  ck("信息流视频用缩略图当封面", !!t1 && t1.poster === "https://ex.com/v.jpg", JSON.stringify(t1));
  ck("视频源地址仍保留（点开可播）", !!t1 && t1.src === "https://ex.com/v.mp4", JSON.stringify(t1));

  /* T2 案例广场视频封面：同样不预加载 */
  const t2 = await p.evaluate(() => {
    S.cases = [{ id: 991002, __cloud: true, t: "案例", by: "老师", kind: "heart", type: "video", dur: "0:10",
      media: [{ kind: "video", url: "https://ex.com/cv.mp4", thumbUrl: "https://ex.com/cv.jpg", path: "c/cv.mp4" }],
      likes: 0, favs: 0, helps: 0 }];
    renderCases();
    const v = document.querySelector("#caseGrid .c-photo");
    return v && v.tagName === "VIDEO" ? { preload: v.getAttribute("preload"), poster: v.getAttribute("poster") } : { tag: v && v.tagName };
  });
  ck("案例广场视频 preload=none", t2.preload === "none", JSON.stringify(t2));
  ck("案例广场视频有封面图", t2.poster === "https://ex.com/cv.jpg", JSON.stringify(t2));

  /* T3 帮忙留言里的视频：也不预加载（cmItemHTML 是全局渲染函数，直接看输出） */
  const t3 = await p.evaluate(() => {
    const html = cmItemHTML({ user: "家长", text: "", kind: "video", dur: "0:08",
      media: [{ kind: "video", url: "https://ex.com/cm.mp4", thumbUrl: "https://ex.com/cm.jpg", path: "cm/x.mp4" }] }, 0);
    const box = document.createElement("div");
    box.innerHTML = html;
    const v = box.querySelector("video");
    return v ? { preload: v.getAttribute("preload"), poster: v.getAttribute("poster") } : { html: html.slice(0, 120) };
  });
  ck("帮忙留言视频 preload=none", t3.preload === "none", JSON.stringify(t3));
  ck("帮忙留言视频有封面", t3.poster === "https://ex.com/cm.jpg", JSON.stringify(t3));

  /* T4 视频封面生成能力：非视频输入必须安全返回 null（不抛错、不卡死） */
  const t4 = await p.evaluate(async () => {
    const out = { hasFn: typeof YRB_CLOUD.makeVideoPoster === "function" };
    if (out.hasFn) {
      const img = new Blob([new Uint8Array(1024)], { type: "image/png" });
      const r = await YRB_CLOUD.makeVideoPoster(img);
      out.imgNull = r === null;
    }
    return out;
  });
  ck("提供视频封面生成函数", t4.hasFn === true, JSON.stringify(t4));
  ck("非视频输入安全返回 null", t4.imgNull === true, JSON.stringify(t4));

  /* T5 图片压缩档位：1280 长边、0.78 质量（原 1600/0.82） */
  const t5 = await p.evaluate(async () => {
    const cv = document.createElement("canvas");
    cv.width = 2400; cv.height = 1600;
    const g = cv.getContext("2d");
    /* 画点内容，避免纯色压缩后过小看不出差异 */
    for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7},70%,50%)`; g.fillRect((i * 37) % 2400, (i * 53) % 1600, 60, 60); }
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.95));
    const file = new File([blob], "big.jpg", { type: "image/jpeg" });
    const out = await YRB_CAPTURE.compress(file);
    const bmp = await createImageBitmap(out);
    const res = { w: bmp.width, h: bmp.height, size: out.size, orig: file.size };
    bmp.close && bmp.close();
    return res;
  });
  ck("压缩后最长边 ≤1280", Math.max(t5.w, t5.h) <= 1280, JSON.stringify(t5));
  ck("原图被明显压缩", t5.size < t5.orig, JSON.stringify(t5));

  /* T6 缩略图档位：400px 长边 */
  const t6 = await p.evaluate(async () => {
    const cv = document.createElement("canvas");
    cv.width = 1600; cv.height = 1200;
    const g = cv.getContext("2d");
    for (let i = 0; i < 200; i++) { g.fillStyle = `hsl(${i * 11},70%,45%)`; g.fillRect((i * 41) % 1600, (i * 29) % 1200, 50, 50); }
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.9));
    const th = await YRB_CLOUD.makeThumb(blob);
    if (!th) return { ok: false };
    const bmp = await createImageBitmap(th);
    const res = { ok: true, w: bmp.width, h: bmp.height, size: th.size };
    bmp.close && bmp.close();
    return res;
  });
  ck("缩略图最长边 ≤400", t6.ok && Math.max(t6.w, t6.h) <= 400, JSON.stringify(t6));
  ck("缩略图体积 <35KB", t6.ok && t6.size < 35 * 1024, JSON.stringify(t6));

  /* T7 首屏分页档位：15 条（减少每次进首页的读取与流量） */
  const t7 = await p.evaluate(async () => {
    const js = await (await fetch("assets/bundle.js?v=" + Date.now())).text();
    const m = js.match(/POST_PAGE=(\d+)/);
    return { page: m ? Number(m[1]) : null };
  });
  ck("首屏只拉 15 条", t7.page === 15, JSON.stringify(t7));

  /* T8 录制档位：854×480 / 0.8Mbps（20 秒约 2MB） */
  const t8 = await p.evaluate(async () => {
    const js = await (await fetch("assets/bundle.js?v=" + Date.now())).text();
    return {
      res: js.indexOf("ideal:854") >= 0,
      bps: js.indexOf("videoBitsPerSecond:800000") >= 0,
      maxVid: /MAX_VID=(\d+)/.test(js) ? Number(js.match(/MAX_VID=(\d+)/)[1]) : null
    };
  });
  ck("录像分辨率降到 854×480", t8.res === true, JSON.stringify(t8));
  ck("录像码率降到 0.8Mbps", t8.bps === true, JSON.stringify(t8));
  ck("录像时长上限 20 秒", t8.maxVid === 20, JSON.stringify(t8));

  ck("页面无脚本错误", errs.length === 0, errs.join(" | ").slice(0, 160));

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
