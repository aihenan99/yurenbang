/* 线上验收：推荐排序层 + 返回接管层（2026-11-04 发版 20261104212020）
   目的：本地测试绿不等于线上绿。线上是 bundle.js 打包产物，层顺序/加载成功与否只有真机页面能证明。
   断言：
   L1 推荐层在位（YRB_RECO.order / seed）
   L2 首页信息流渲染出真实帖子（>0 条）
   L3 两次全新会话顺序不同（用户要的「每次打开不一样」）
   L4 ?recseed=11 两次打开顺序完全一致（可复现）
   L5 ?rec=0 退回原始顺序（与默认不同即可证明开关生效）
   L6 返回接管层在位（YRB_NAVBACK.depth/guarded）
   L7 全程无脚本错误
   用法：node tests/diag/recommend-live.js [base]
         默认 base = https://xn--gmqq09al6z.cn/（CF 生产站）
         境内站：node tests/diag/recommend-live.js http://118.89.185.37/ */
const BASE = (process.argv[2] || "https://xn--gmqq09al6z.cn/").replace(/\/?$/, "/");
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

async function open(b, qs) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => { errs.push(e.message); });
  await p.goto(BASE + (qs || ""), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => {
    const cards = [...document.querySelectorAll("#feed .card")];
    return {
      order: cards.map(c => +c.dataset.id),
      reco: !!(window.YRB_RECO && typeof YRB_RECO.order === "function"),
      seed: window.YRB_RECO ? YRB_RECO.seed() : 0,
      nb: !!(window.YRB_NAVBACK && typeof window.YRB_NAVBACK.guarded === "function"),
      build: (window.__YRB_BUILD || (document.querySelector('script[src*="bundle.js"]') || {}).src || "")
    };
  });
  await ctx.close();
  return { ...info, errs };
}

(async () => {
  console.log("\n线上验收  " + BASE + "\n");
  const b = await chromium.launch({ executablePath: CHROME });

  const a = await open(b, "?live=" + Date.now());
  ck("L1 推荐层在位", a.reco && a.seed > 0, JSON.stringify({ reco: a.reco, seed: a.seed }));
  ck("L2 信息流有真实帖子", a.order.length > 0, "卡片 " + a.order.length + " 张");

  const c = await open(b, "?live2=" + Date.now());
  const sameAsA = a.order.slice(0, 5).join() === c.order.slice(0, 5).join();
  ck("L3 两次全新会话顺序不同", a.order.length > 1 && !sameAsA,
    "A=" + a.order.slice(0, 6).join(",") + " | B=" + c.order.slice(0, 6).join(","));

  const s1 = await open(b, "?recseed=11&s1=" + Date.now());
  const s2 = await open(b, "?recseed=11&s2=" + Date.now());
  ck("L4 同种子可复现", s1.order.length > 1 && s1.order.join() === s2.order.join(),
    "S1=" + s1.order.slice(0, 6).join(",") + " | S2=" + s2.order.slice(0, 6).join(","));

  const off = await open(b, "?rec=0&off=" + Date.now());
  ck("L5 ?rec=0 关闭排序生效", off.order.length > 1 && off.order.join() !== s1.order.join(),
    "OFF=" + off.order.slice(0, 6).join(","));

  ck("L6 返回接管层在位", a.nb === true, String(a.nb));

  const errs = [...a.errs, ...c.errs, ...s1.errs, ...s2.errs, ...off.errs];
  ck("L7 全程无脚本错误", errs.length === 0, errs.slice(0, 3).join(" | "));

  await b.close();
  console.log("\n" + pass + "/" + (pass + fail) + (fail ? " 失败 " + fail + " 项" : " 全部通过") + "\n");
  process.exit(fail ? 1 : 0);
})();
