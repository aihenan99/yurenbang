/* PPT 全屏阅读回归测试（2026-10-23）
   覆盖：全屏按钮替换放大镜、全屏层渲染与翻页、退出恢复、横屏重渲染、放大镜入口确实已移除 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const BASE = "http://127.0.0.1:8793/deploy-cn/index.html";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  [" + extra + "]" : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({
    viewport: { width: 410, height: 880 },
    serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));

  await p.goto(BASE + "?pf=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => enterApp());
  await p.waitForTimeout(500);

  /* 准备一个 PPT 案例并打开查看器 */
  await p.evaluate(() => {
    S.cases.unshift({
      t: "全屏阅读测试", type: "ppt", kind: "study",
      media: [{ kind: "file", url: "/temp/ppt-test/sample_fixed.pptx", name: "fulltest.pptx" }],
      helps: 1, likes: 1, favs: 1
    });
    openViewer(S.cases[0]);
  });
  await p.waitForSelector(".vp-tools [data-a='full']", { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);

  /* T1 工具栏：全屏在、放大镜没了 */
  const t1 = await p.evaluate(() => ({
    full: !!document.querySelector(".vp-tools [data-a='full']"),
    zoom: !!document.querySelector(".vp-tools [data-a='zoom']"),
    rendered: !!document.querySelector(".vp-scroll .vp-fit"),
    label: (document.querySelector(".vp-tools [data-a='full']") || {}).textContent || ""
  }));
  ck("工具栏出现「⛶ 全屏阅读」", t1.full, JSON.stringify(t1));
  ck("放大镜按钮已移除", !t1.zoom);
  ck("PPT 卡片内正常渲染", t1.rendered, JSON.stringify(t1));

  /* T2 点击全屏 → #vpFull 出现并渲染 */
  await p.evaluate(() => { document.querySelector(".vp-tools [data-a='full']").click(); });
  await p.waitForTimeout(2500);
  const t2 = await p.evaluate(() => {
    const f = document.getElementById("vpFull");
    return {
      layer: !!f, inBody: f ? f.parentElement === document.body : false,
      fit: !!document.querySelector("#vpFull .vf-fit"),
      fitW: (document.querySelector("#vpFull .vf-fit") || {}).clientWidth || 0,
      num: (document.querySelector("#vpFull .vf-num") || {}).textContent || "",
      btns: document.querySelectorAll("#vpFull .vf-btn").length,
      x: !!document.querySelector("#vpFull .vf-x"),
      tip: (document.querySelector("#vpFull .vf-tip") || {}).textContent || ""
    };
  });
  ck("全屏层挂载到 body", t2.layer && t2.inBody, JSON.stringify(t2));
  ck("全屏层内 PPT 已重渲染", t2.fit, JSON.stringify(t2));
  ck("全屏宽度撑满屏宽（410）", t2.fitW >= 400, "宽=" + t2.fitW);
  ck("页码显示正确", /第 1 页/.test(t2.num), t2.num);
  ck("翻页大按钮齐全（上一页/下一页）", t2.btns === 2);
  ck("右上角有退出按钮", t2.x);
  ck("竖屏提示「横过来手机」", /横过来/.test(t2.tip), t2.tip);

  /* T3 全屏层翻页 */
  await p.evaluate(() => { document.querySelector("#vpFull [data-a='next']").click(); });
  await p.waitForTimeout(900);
  const t3 = await p.evaluate(() => (document.querySelector("#vpFull .vf-num") || {}).textContent || "");
  ck("全屏内下一页生效", /第 2 页/.test(t3), t3);
  await p.evaluate(() => { document.querySelector("#vpFull [data-a='prev']").click(); });
  await p.waitForTimeout(900);
  const t3b = await p.evaluate(() => (document.querySelector("#vpFull .vf-num") || {}).textContent || "");
  ck("全屏内上一页生效", /第 1 页/.test(t3b), t3b);

  /* T4 模拟转横屏 → 按新尺寸重渲染（viewport 换向） */
  await p.setViewportSize({ width: 880, height: 410 });
  await p.waitForTimeout(2200);
  const t4 = await p.evaluate(() => {
    const fit = document.querySelector("#vpFull .vf-fit");
    return { fitW: fit ? fit.clientWidth : 0, num: (document.querySelector("#vpFull .vf-num") || {}).textContent || "", stillOpen: !!document.getElementById("vpFull") };
  });
  ck("转横屏后全屏层仍在", t4.stillOpen, JSON.stringify(t4));
  ck("横屏按新宽度重渲染（≈屏高×16/9≈728）", t4.fitW >= 640, "宽=" + t4.fitW);
  ck("重渲染后停留在当前页", /第 1 页/.test(t4.num), t4.num);

  /* T5 退出全屏 → 层移除、卡片视图仍在 */
  await p.setViewportSize({ width: 410, height: 880 });
  await p.waitForTimeout(1800);
  await p.evaluate(() => { document.querySelector("#vpFull .vf-x").click(); });
  await p.waitForTimeout(600);
  const t5 = await p.evaluate(() => ({
    gone: !document.getElementById("vpFull"),
    card: !!document.querySelector(".vp-scroll .vp-fit"),
    tools: !!document.querySelector(".vp-tools [data-a='full']")
  }));
  ck("退出后全屏层移除", t5.gone, JSON.stringify(t5));
  ck("卡片视图仍在且可再开", t5.card && t5.tools);

  /* T6 再次进入全屏（关闭后再开不残留旧层） */
  await p.evaluate(() => { document.querySelector(".vp-tools [data-a='full']").click(); });
  await p.waitForTimeout(2500);
  const t6 = await p.evaluate(() => ({ open: !!document.getElementById("vpFull"), fit: !!document.querySelector("#vpFull .vf-fit") }));
  ck("退出后可再次进入全屏", t6.open && t6.fit, JSON.stringify(t6));

  ck("无脚本报错", errs.length === 0, errs.join(" | "));

  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常:", e.message); process.exit(2); });
