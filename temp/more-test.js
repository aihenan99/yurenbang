/* more-test：卡片 ⋯ 菜单（转发/举报，替换原型演示 toast） */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    args: ["--use-fake-ui-for-media-stream"] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", permissions: [] });
  await ctx.grantPermissions([], []);   /* 不授权剪贴板 → 走 fallbackCopy 路径 */
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?more=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(900);

  /* 注入一张媒体卡（带 .m-more，与 cardHTML 注入结构一致） */
  await p.evaluate(() => {
    S.posts.unshift({ id: 9701, user: "测试家长", flag: "🇨🇳", ava: "rabbit", type: "img",
      kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试", title: "菜单测试求助",
      text: "测试求助内容", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [],
      media: [{ kind: "img", url: "data:image/png;base64,iVBORw0KGgo=" }] });
    const feed = document.getElementById("feed");
    feed.insertAdjacentHTML("afterbegin", `
      <div class="card has-media" data-id="9701">
        <div class="media m-imgs n1"><img class="real-img" src="data:image/png;base64,iVBORw0KGgo=" alt=""></div>
        <button class="m-more" data-act="more" aria-label="更多操作">⋯</button>
      </div>`);
  });
  await p.waitForTimeout(250);

  /* T1 点 ⋯ → 弹菜单（modal 打开，含转发/举报） */
  await p.evaluate(() => document.querySelector("#feed .card[data-id='9701'] .m-more").click());
  await p.waitForTimeout(500);
  const t1 = await p.evaluate(() => ({
    open: document.getElementById("modal").classList.contains("open"),
    share: !!document.getElementById("cmShare"),
    report: !!document.getElementById("cmReport")
  }));
  ck("⋯ 弹出菜单", t1.open && t1.share && t1.report, JSON.stringify(t1));

  /* T2 点举报 → 复用详情页举报浮层 → 选理由提交 */
  await p.evaluate(() => document.getElementById("cmReport").click());
  await p.waitForTimeout(400);
  const t2 = await p.evaluate(() => {
    const ov = document.getElementById("r23Report");
    const modalClosed = !document.getElementById("modal").classList.contains("open");
    return { rpOpen: ov && ov.classList.contains("open"), modalClosed, reasons: document.querySelectorAll("#r23RpGrid button").length };
  });
  ck("举报浮层打开且菜单关闭", t2.rpOpen && t2.modalClosed && t2.reasons > 0, JSON.stringify(t2));
  await p.evaluate(() => { document.querySelector("#r23RpGrid button").click(); });
  await p.evaluate(() => document.getElementById("r23RpGo").click());
  await p.waitForTimeout(300);
  const t3 = await p.evaluate(() => ({
    rpClosed: !document.getElementById("r23Report").classList.contains("open"),
    toast: (document.getElementById("toast") || {}).textContent || ""
  }));
  ck("举报提交成功提示", t3.rpClosed && t3.toast.includes("举报已提交"), t3.toast);

  /* T4 再开菜单点转发 → toast 复制成功（走 fallback） */
  await p.evaluate(() => document.querySelector("#feed .card[data-id='9701'] .m-more").click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById("cmShare").click());
  await p.waitForTimeout(600);
  const t4 = await p.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
  ck("转发提示复制成功", t4.includes("链接已复制") || t4.includes("地址栏"), t4);

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
