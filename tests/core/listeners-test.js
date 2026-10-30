/* listeners-test：监听器泄漏回归（源码直测）
   背景：审核记录过「重复监听器」疑点，但一直无可复现点。2026-10-30 用 CDP
   DOMDebugger.getEventListeners 实测：交互前后各节点监听器数量稳定，无重复绑定。
   本用例把结论固化：跑一轮典型交互（切 tab / 开关发布面板 / 点赞 / 开关案例页），
   关键节点的监听器数量不允许增长——以后谁在渲染路径里加了重复绑定，这里立刻红。
   运行前：python -m http.server 8796 --bind 127.0.0.1 --directory yurenbang-app */
const { chromium } = require("../helpers/pw.js").loadPlaywright();
const CHROME = require("../helpers/pw.js").chromePath();
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";
let pass = 0, fail = 0;
function T(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e && e.message || e)));
  await p.goto(BASE + "?lis=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1200);

  const cdp = await ctx.newCDPSession(p);
  async function counts() {
    const ids = ["feed", "caseGrid", "msgList", "tabbar", "modal"];
    const out = { doc: 0 };
    for (const id of ids) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: 'document.getElementById("' + id + '")', returnByValue: false
      });
      if (!r.result.objectId) { out[id] = null; continue; }
      const l = await cdp.send("DOMDebugger.getEventListeners", { objectId: r.result.objectId, depth: 0 });
      out[id] = l.listeners.length;
    }
    const d = await cdp.send("Runtime.evaluate", { expression: "document", returnByValue: false });
    const dl = await cdp.send("DOMDebugger.getEventListeners", { objectId: d.result.objectId, depth: 0 });
    out.doc = dl.listeners.length;
    return out;
  }

  const before = await counts();
  /* 一轮典型交互：切 tab ×3、开关发布面板、案例筛选、消息页进出的真实路径 */
  await p.evaluate(() => {
    const click = (s) => { const e = document.querySelector(s); if (e) e.click(); };
    click('#tabbar [data-p="cases"]'); click('#tabbar [data-p="msgs"]'); click('#tabbar [data-p="home"]');
    click("#pubBtn");
    const x = document.querySelector("#pubSheet .sh-x, #pubSheet [data-close]"); if (x) x.click();
    click('#caseTabs .ct[data-f="video"]'); click('#caseTabs .ct[data-f="all"]');
  });
  await p.waitForTimeout(900);
  const after = await counts();

  T("feed 监听器数量不随交互增长", after.feed === before.feed, { before: before.feed, after: after.feed });
  T("caseGrid 监听器数量不随交互增长", after.caseGrid === before.caseGrid, { before: before.caseGrid, after: after.caseGrid });
  T("tabbar 监听器数量不随交互增长", after.tabbar === before.tabbar, { before: before.tabbar, after: after.tabbar });
  T("modal 监听器数量不随交互增长", after.modal === before.modal, { before: before.modal, after: after.modal });
  /* document 是委托中枢（设计上就多），只锁「不增长」与绝对上限，防止失控 */
  T("document 监听器不随交互增长", after.doc <= before.doc, { before: before.doc, after: after.doc });
  T("document 监听器在合理区间（委托设计 <120）", before.doc < 120, before.doc);
  T("关键节点都有非零监听（委托真的在听）", before.feed > 0 && before.tabbar > 0 && before.caseGrid > 0, before);
  T("页面零脚本错误", errs.length === 0, errs.slice(0, 3));

  await b.close();
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS", e); process.exit(1); });
