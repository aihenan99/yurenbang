/* cover-test.js — 案例封面层回归（2026-10-24）
   用真实 sample_fixed.pptx 验证：第一页渲染为封面 / localStorage 缓存 /
   失败降级为 📄 占位 / 视频首帧处理。
   页面从 8793（项目根）加载 /deploy-cn/，PPT 用同源 /temp/ppt-test/sample_fixed.pptx。 */
const { chromium } = require("../helpers/pw.js").loadPlaywright();
const URL = "http://127.0.0.1:8793/deploy-cn/?cv=" + Date.now();
const PPT = "http://127.0.0.1:8793/temp/ppt-test/sample_fixed.pptx";

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + "  [" + (extra || "") + "]"); }
}

(async () => {
  const b = await chromium.launch({ executablePath: require("../helpers/pw.js").chromePath() });
  const p = await b.newPage({ viewport: { width: 412, height: 900 } });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2400);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(700);

  /* T1 层就绪 + 健康层收录 */
  const t1 = await p.evaluate(() => ({
    flag: !!window.YRB_COVER,
    pptThumb: !!(window.YRB_PPT && typeof YRB_PPT.thumb === "function"),
    inHealth: window.YRB_HEALTH ? YRB_HEALTH.layers().indexOf("cover") >= 0 : false
  }));
  ck("cover 层就绪", t1.flag);
  ck("pptview 暴露 thumb API", t1.pptThumb);
  ck("免疫系统已收录 cover", t1.inHealth);

  /* T2 PPT 案例 → 第一页渲染为封面 */
  await p.evaluate((pptUrl) => {
    try { localStorage.removeItem("yrb_pptcover_v1"); } catch (e) {}
    S.cases.unshift({
      t: "封面测试PPT", by: "测试家长", ava: "panda", type: "ppt", helps: 1, likes: 2, favs: 3,
      media: [{ kind: "file", url: pptUrl, name: "sample_fixed.pptx" }]
    });
    renderCases();
  }, PPT);
  await p.waitForTimeout(9000);          /* 下载 + 解析 + 渲染第一页 */
  const t2 = await p.evaluate(() => {
    const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
    const img = card && card.querySelector("img.c-cover");
    const label = card && card.querySelector(".c-type");
    return {
      hasImg: !!img, isData: !!(img && /^data:image\/jpeg/.test(img.src)),
      w: img ? img.naturalWidth : 0,
      label: label ? label.textContent : ""
    };
  });
  ck("PPT 第一页渲染为封面 <img>", t2.hasImg && t2.isData, JSON.stringify(t2));
  ck("封面是有内容的真实渲染", t2.w >= 200, t2.w + "px");
  ck("角标更新为 PPT", /PPT/.test(t2.label), t2.label);

  /* T3 封面已入缓存 */
  const t3 = await p.evaluate(() => {
    const o = JSON.parse(localStorage.getItem("yrb_pptcover_v1") || "{}");
    const k = Object.keys(o)[0];
    return { n: Object.keys(o).length, key: k, dataLen: k ? (o[k].d || "").length : 0 };
  });
  ck("封面已写入 localStorage 缓存", t3.n === 1 && t3.dataLen > 800, JSON.stringify({ n: t3.n, len: t3.dataLen }));

  /* T4 重绘后缓存命中：同步上封面（不等下载） */
  const t4 = await p.evaluate(() => { renderCases(); });
  await p.waitForTimeout(300);
  const t4b = await p.evaluate(() => {
    const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
    return { img: !!(card && card.querySelector("img.c-cover")) };
  });
  ck("重绘后缓存命中，秒上封面", t4b.img);

  /* T5 失败降级：坏地址保持 📄 占位，不报错 */
  await p.evaluate(() => {
    S.cases.unshift({
      t: "坏文件PPT", by: "测试家长", ava: "panda", type: "ppt", helps: 0, likes: 0, favs: 0,
      media: [{ kind: "file", url: "/temp/ppt-test/not-exist-" + Date.now() + ".pptx", name: "bad.pptx" }]
    });
    renderCases();
  });
  await p.waitForTimeout(4000);
  const t5 = await p.evaluate(() => {
    const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
    return { doc: !!(card && card.querySelector(".c-doc")), noImg: !(card && card.querySelector("img.c-cover")) };
  });
  ck("下载失败保持 📄 占位（优雅降级）", t5.doc && t5.noImg, JSON.stringify(t5));

  /* T6 视频案例封面元素仍在（caseThumb 原生路径 + 首帧 seek 注入） */
  await p.evaluate(() => {
    S.cases.unshift({
      t: "视频封面案例", by: "测试家长", ava: "rabbit", type: "video", dur: "0:30", helps: 0, likes: 0, favs: 0,
      media: [{ kind: "video", url: "/deploy-cn/assets/icon-192.png" }]
    });
    renderCases();
  });
  /* 首帧标记由 MutationObserver → 80ms 防抖 → pass() 异步打上；
     批量跑（9 组测试连轴转）时机器有负载，固定 500ms 会偶发抢跑。
     改成轮询最多 3s：既不失严格性（最终必须为 "1"），也不再靠猜时间。 */
  const t6 = await (async () => {
    const deadline = Date.now() + 3000;
    let r = null;
    while (Date.now() < deadline) {
      r = await p.evaluate(() => {
        const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
        const v = card && card.querySelector("video.c-photo");
        return { hasV: !!v, preload: v ? v.preload : "", mark: v ? v.dataset.cv : "" };
      });
      if (r.hasV && r.mark === "1") return r;
      await p.waitForTimeout(100);
    }
    return r;
  })();
  ck("视频案例封面 <video> 在位（首帧处理已标记）", t6.hasV && t6.mark === "1", JSON.stringify(t6));

  /* 汇总 */
  console.log("\n[pageerrors] " + (errs.length ? errs.join(" | ") : "无"));
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
