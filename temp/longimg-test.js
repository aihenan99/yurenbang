/* longimg-test：分享长图层（本地源码直测，不走 bundle、不碰生产）
   覆盖：侧栏按钮注入（幂等）/ 浮层开合 / canvas 出图与尺寸 / 超长截断 /
         保存按钮存在 / 关闭 / 页面零报错 / health 探针可见
   运行前：python -m http.server 8796 --bind 127.0.0.1 --directory yurenbang-app */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";
let pass = 0, fail = 0;
function T(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}

async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await p.goto(BASE + "?lg=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(1200);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.click("#splash"); await p.waitForTimeout(600); }
  return { p, errs };
}
const STUB = {
  id: 990002, user: "长图测试家长", time: "刚刚", tag: "求助",
  text: "孩子写作业拖拉，每天写到十一点，试过番茄钟、试过陪读都没用，急求过来人支招。\n先谢谢大家了！",
  likes: 12, favs: 3, helps: 2, ava: "animal"
};
async function stubWith(p, override) {
  const post = Object.assign({}, STUB, override || {});
  return p.evaluate((post) => {
    S.posts.unshift(post);
    if (typeof renderFeed === "function") renderFeed();
    return post.id;
  }, post);
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });

  /* ================= A. 层就位 ================= */
  const { p, errs } = await openPage(b);
  T("层对象已挂载 YRB_LONGIMG", await p.evaluate(() => !!(window.YRB_LONGIMG && typeof window.YRB_LONGIMG.ready === "function")));
  T("health 探针可读", await p.evaluate(() => { try { return !!window.YRB_LONGIMG.ready(); } catch (e) { return false; } }));

  /* ================= B. 注入与出图 ================= */
  await stubWith(p);
  await p.waitForTimeout(400);
  T("卡片侧栏出现长图按钮", await p.evaluate(() => {
    const c = document.querySelector('.card[data-id="990002"]');
    return !!(c && c.querySelector(".p-side [data-lg]"));
  }));
  T("注入幂等（每卡恰一个按钮）", await p.evaluate(() => {
    const cards = document.querySelectorAll("#feed .card");
    if (!cards.length) return false;
    let bad = 0;
    cards.forEach(c => { if (c.querySelectorAll("[data-lg]").length !== 1) bad++; });
    return bad === 0;
  }));

  await p.click('.card[data-id="990002"] .p-side [data-lg]');
  await p.waitForTimeout(150);
  T("浮层已打开", await p.evaluate(() => {
    const m = document.querySelector(".lg-mask");
    return !!(m && m.classList.contains("open"));
  }));
  await p.waitForTimeout(900);
  const img = await p.evaluate(() => {
    const im = document.querySelector(".lg-scroll img");
    return im ? { ok: /^data:image\/(jpeg|png)/.test(im.src), w: im.naturalWidth, h: im.naturalHeight } : null;
  });
  T("长图已生成（canvas → img）", !!(img && img.ok), img);
  T("输出倍率正确（宽=1500）", !!(img && img.w === 1500), img);
  T("高度在安全区（<13600px）", !!(img && img.h > 0 && img.h <= 13600), img);

  T("保存按钮存在", await p.evaluate(() => !!document.querySelector(".lg-acts .lg-save")));
  await p.click(".lg-acts .lg-close");
  await p.waitForTimeout(120);
  T("关闭后浮层收起", await p.evaluate(() => !document.querySelector(".lg-mask").classList.contains("open")));

  /* ================= C. 超长文本截断 ================= */
  const longText = Array.from({ length: 60 }, (_, i) => "第" + (i + 1) + "行：孩子的情况是一段比较长的描述内容用来测试换行与截断。").join("\n");
  await stubWith(p, { id: 990003, text: longText });
  await p.waitForTimeout(400);
  await p.click('.card[data-id="990003"] .p-side [data-lg]');
  await p.waitForTimeout(1000);
  const img2 = await p.evaluate(() => {
    const im = document.querySelector(".lg-scroll img");
    return im ? { ok: /^data:image\//.test(im.src), h: im.naturalHeight, w: im.naturalWidth } : null;
  });
  T("超长帖仍能出图", !!(img2 && img2.ok), img2);
  T("超长帖被截断在高度上限内", !!(img2 && img2.h <= 13600), img2);
  await p.evaluate(() => window.YRB_LONGIMG.close());

  /* ================= D. 无报错 ================= */
  T("页面零脚本错误", errs.length === 0, errs.slice(0, 3));

  await b.close();
  console.log("\n通过 / 失败：" + pass + " / " + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS", e); process.exit(1); });
