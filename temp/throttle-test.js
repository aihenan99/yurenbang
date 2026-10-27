/* throttle-test：额度节流四项（PPT/视频门槛、缩略图渲染、分页按钮、纯文字案例落云） */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
let pass = 0, fail = 0;
const ck = (n, c, d) => { if (c) { pass++; console.log("  ✅", n); } else { fail++; console.log("  ✗", n, d || ""); } };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?thr=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2400);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);

  /* T1 卡片图片用缩略图，data-full 保留原图 */
  const t1 = await p.evaluate(() => {
    S.posts = [{ id: 990101, __cloud: true, user: "测试", tag: "求助", title: "", text: "x", type: "img", urg: 1,
      media: [{ kind: "img", url: "https://ex.com/orig.jpg", thumbUrl: "https://ex.com/thumb.jpg", path: "p/a.jpg" }] }];
    renderFeed();
    const img = document.querySelector("#feed .real-img");
    return img ? { src: img.getAttribute("src"), full: img.getAttribute("data-full") } : null;
  });
  ck("卡片图片 load 缩略图", !!t1 && t1.src === "https://ex.com/thumb.jpg", JSON.stringify(t1));
  ck("卡片图片保留原图地址供点开", !!t1 && t1.full === "https://ex.com/orig.jpg", JSON.stringify(t1));

  /* T2 无缩略图时回退原图（老数据兼容） */
  const t2 = await p.evaluate(() => {
    S.posts = [{ id: 990102, __cloud: true, user: "测试", tag: "求助", title: "", text: "x", type: "img", urg: 1,
      media: [{ kind: "img", url: "https://ex.com/only.jpg", path: "p/b.jpg" }] }];
    renderFeed();
    const img = document.querySelector("#feed .real-img");
    return img ? img.getAttribute("src") : "";
  });
  ck("无缩略图回退原图", t2 === "https://ex.com/only.jpg", t2);

  /* T3 案例封面用缩略图 */
  const t3 = await p.evaluate(() => {
    S.cases = [{ id: 990201, t: "案例", by: "测试", ava: "animal", type: "img",
      media: [{ kind: "img", url: "https://ex.com/co.jpg", thumbUrl: "https://ex.com/ct.jpg" }] }];
    S.curCaseFilter = "all";
    renderCases();
    const im = document.querySelector("#caseGrid .c-photo");
    return im ? im.getAttribute("src") : "";
  });
  ck("案例封面用缩略图", t3 === "https://ex.com/ct.jpg", t3);

  /* T4 分页：postsMore=true 时出现「看更多」按钮，点击走 loadMorePosts */
  const t4 = await p.evaluate(async () => {
    S.posts = [{ id: 990103, __cloud: true, user: "测试", tag: "求助", title: "", text: "x", type: "img", urg: 1, media: [] }];
    const oMore = YRB_CLOUD.postsMore, oLoad = YRB_CLOUD.loadMorePosts;
    let called = 0;
    YRB_CLOUD.postsMore = () => true;
    YRB_CLOUD.loadMorePosts = () => { called++; return Promise.resolve({ ok: true }); };
    renderFeed();
    const btn = document.getElementById("feedMore");
    const has = !!btn;
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 120));
    YRB_CLOUD.postsMore = oMore; YRB_CLOUD.loadMorePosts = oLoad;
    return { has, called, label: btn ? btn.textContent : "" };
  });
  ck("有更多时显示「看更多求助」按钮", t4.has && t4.label.indexOf("看更多") >= 0, JSON.stringify(t4));
  ck("点按钮调用分页加载", t4.called === 1, String(t4.called));

  /* T5 PPT 门槛（2026-10-26 免费额度专项：8MB） */
  const t5 = await p.evaluate(async () => {
    S.cuType = "ppt"; cuFiles.length = 0;
    const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.pptx", { type: "application/vnd.ms-powerpoint" });
    await handleCuFiles([big]);
    const n21 = cuFiles.length;
    cuFiles.length = 0;
    const mid = new File([new Uint8Array(9 * 1024 * 1024)], "mid.pptx", { type: "application/vnd.ms-powerpoint" });
    await handleCuFiles([mid]);
    const n9 = cuFiles.length;
    cuFiles.length = 0;
    const ok = new File([new Uint8Array(3 * 1024 * 1024)], "ok.pptx", { type: "application/vnd.ms-powerpoint" });
    await handleCuFiles([ok]);
    return { n21, n9, n7: cuFiles.length };
  });
  ck("21MB 的 PPT 被拦下", t5.n21 === 0, JSON.stringify(t5));
  ck("9MB 的 PPT 也被拦下（8MB 门槛）", t5.n9 === 0, JSON.stringify(t5));
  ck("3MB 的 PPT 正常放行", t5.n7 === 1, JSON.stringify(t5));

  /* T6 视频门槛（2026-10-26：8MB / 20 秒） */
  const t6 = await p.evaluate(async () => {
    S.cuType = "video"; cuFiles.length = 0;
    const orig = window.videoDur;
    window.videoDur = () => Promise.resolve(5);
    const big = new File([new Uint8Array(16 * 1024 * 1024)], "big.mp4", { type: "video/mp4" });
    await handleCuFiles([big]);
    const nBig = cuFiles.length;

    cuFiles.length = 0;
    const okFile = new File([new Uint8Array(7 * 1024 * 1024)], "ok.mp4", { type: "video/mp4" });
    await handleCuFiles([okFile]);
    const nOk = cuFiles.length;

    cuFiles.length = 0;
    window.videoDur = () => Promise.resolve(25);
    await handleCuFiles([okFile]);
    const nLong = cuFiles.length;

    window.videoDur = orig;
    return { nBig, nOk, nLong };
  });
  ck("16MB 的视频被拦下", t6.nBig === 0, JSON.stringify(t6));
  ck("7MB/5 秒的视频正常放行", t6.nOk === 1, JSON.stringify(t6));
  ck("25 秒的视频被拦下（20 秒上限）", t6.nLong === 0, JSON.stringify(t6));

  /* T7 纯文字案例：走云端、不再塞本地占位假数据 */
  const t7 = await p.evaluate(async () => {
    S.cases = []; cuFiles.length = 0; S.cuType = "img";
    document.getElementById("cuTitle").value = "纯文字案例测试";
    const orig = window.YRB_CLOUD;
    let called = 0, arg = null;
    window.YRB_CLOUD = Object.assign({}, orig, {
      signedIn: () => true,
      publishCase: (payload, items) => { called++; arg = { payload, items }; return Promise.resolve({ ok: true, media: [], cloudId: 777 }); }
    });
    document.getElementById("cuGo").click();
    await new Promise(r => setTimeout(r, 300));
    const top = S.cases[0] || {};
    window.YRB_CLOUD = orig;
    return { called, cloudId: top.cloudId, isCloud: !!top.__cloud, hasSlide: !!top.slides, t: top.t, items: arg && arg.items && arg.items.length };
  });
  ck("纯文字案例真的调用云端发布", t7.called === 1, JSON.stringify(t7));
  ck("纯文字案例标记为云端数据", t7.isCloud === true && t7.cloudId === 777, JSON.stringify(t7));
  ck("不再塞「原型演示占位」假数据", t7.hasSlide !== true, JSON.stringify(t7));

  /* T8 缩略图生成：1200×800 原图 → ≤480 边长、体积大幅缩小 */
  const t8 = await p.evaluate(async () => {
    const cv = document.createElement("canvas");
    cv.width = 1200; cv.height = 800;
    const g = cv.getContext("2d");
    for (let i = 0; i < 200; i++) { g.fillStyle = "hsl(" + (i * 7) + ",70%,60%)"; g.fillRect(i * 6, i * 4, 40, 40); }
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.95));
    const th = await YRB_CLOUD.makeThumb(blob);
    if (!th) return { ok: false };
    const bmp = await createImageBitmap(th);
    return { ok: true, origSize: blob.size, size: th.size, w: bmp.width, h: bmp.height, type: th.type };
  });
  ck("能生成缩略图", t8.ok === true, JSON.stringify(t8));
  ck("缩略图最长边 ≤400", t8.ok && Math.max(t8.w, t8.h) <= 400, JSON.stringify(t8));
  ck("缩略图比原图小 80% 以上", t8.ok && t8.size < t8.origSize * 0.2, JSON.stringify(t8));

  ck("页面无脚本错误", errs.length === 0, errs.join(" | "));
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
