/* report-test：举报链路（本地源码直测，不走 bundle、不碰生产）
   背景：2026-10-28 前 submitReport() 只弹 toast 不落库，属假功能。
   覆盖：浮层可达 / 必填校验 / 云端可用真入库 / 后端报错如实失败（不假装成功）/
         未登录拦下 / 断网入队 / 登录后自动补发并补归属 / 字段完整性
   运行前：python -m http.server 8796 --bind 127.0.0.1 --directory yurenbang-app */
const { chromium } = require("../helpers/pw.js").loadPlaywright();
const CHROME = require("../helpers/pw.js").chromePath();
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";
const QKEY = "yrb_report_queue_v1";
let pass = 0, fail = 0;
function T(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}

async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const errs = [];
  p.on("pageerror", e => errs.push(String((e && (e.stack || e.message)) || e).slice(0, 400)));
  await p.goto(BASE + "?rp=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(1200);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.click("#splash"); await p.waitForTimeout(600); }
  /* 劫持 toast 收集文案；同时清空队列，保证用例互不干扰 */
  await p.evaluate((qk) => {
    window.__toasts = [];
    const orig = window.toast;
    window.toast = function (m) { window.__toasts.push(String(m)); try { orig && orig(m); } catch (e) {} };
    try { localStorage.removeItem(qk); } catch (e) {}
  }, QKEY);
  return { p, errs };
}

/* 注入一个 [data-r23detail] 触发元素 → 走 refine23 的真实委托打开详情 */
async function openReportUI(p, id) {
  await p.evaluate((id) => {
    let el = document.getElementById("__t_open");
    if (!el) { el = document.createElement("button"); el.id = "__t_open"; document.body.appendChild(el); }
    el.setAttribute("data-r23detail", String(id));
    el.click();
  }, id);
  await p.waitForTimeout(400);
  const ok = await p.evaluate(() => !!document.querySelector("#r23Detail.open"));
  if (!ok) return false;
  await p.evaluate(() => { const b = document.querySelector('#r23Detail [data-db="report"]'); if (b) b.click(); });
  await p.waitForTimeout(250);
  return p.evaluate(() => !!document.querySelector("#r23Report.open"));
}
async function submit(p, reason) {
  /* 举报浮层是底部抽屉，按钮常在视口外；用 JS 派发点击（等价用户点，且不受可视区限制） */
  await p.evaluate(() => { window.__toasts = []; });   /* 每轮清空，避免上一条用例的 toast 污染断言 */
  await p.evaluate((r) => {
    if (r) { const b = document.querySelector(`#r23RpGrid button[data-r="${r}"]`); if (b) b.click(); }
    const go = document.getElementById("r23RpGo"); if (go) go.click();
  }, reason || "");
  await p.waitForTimeout(700);
  return p.evaluate(() => window.__toasts.slice(-3));
}
const queue = (p) => p.evaluate((qk) => { try { return JSON.parse(localStorage.getItem(qk) || "[]"); } catch (e) { return []; } }, QKEY);

const STUB = {
  id: 9101, cloudId: 777, user: "举报测试家长", time: "刚刚", tag: "求助",
  text: "这是一条用于测试举报链路的求助内容，请勿当真。",
  likes: 1, favs: 0, helps: 0, ava: "animal",
  comments: [], roses: []   /* openDetail 直接读 p.comments.length，真实帖子必带，桩也要带 */
};

/* 云端替身：mode=ok 真插入 / mode=db 报错 / mode=null 无 client */
async function stubCloud(p, mode, signed) {
  return p.evaluate(({ mode, signed }) => {
    const orig = window.YRB_CLOUD || {};
    const fake = Object.assign({}, orig);
    window.__ins = [];
    fake.signedIn = () => !!signed;
    fake.who = () => (signed ? { id: "test-uid-1", name: "测试家长", phone: "" } : null);
    if (mode === "ok") {
      fake.client = { database: { from() { return { insert(row) { window.__ins.push(row); return Promise.resolve({ data: [row], error: null }); } }; } } };
    } else if (mode === "db") {
      fake.client = { database: { from() { return { insert() { return Promise.resolve({ data: null, error: { message: 'relation "yb_reports" does not exist' } }); } }; } } };
    } else {
      fake.client = null;
    }
    window.YRB_CLOUD = fake;
    return true;
  }, { mode, signed });
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });

  const { p, errs } = await openPage(b);
  await p.evaluate((post) => { S.posts.unshift(post); if (typeof renderFeed === "function") renderFeed(); }, STUB);
  await p.waitForTimeout(300);

  /* ================= A. 入口可达 ================= */
  T("详情页举报浮层能打开", await openReportUI(p, STUB.id));

  /* ================= B. 必填校验 ================= */
  let t = await submit(p, null);
  T("未选理由被拦下", t.some((x) => x.includes("请选择举报理由")), t);
  T("未选理由不入队", (await queue(p)).length === 0, await queue(p));

  /* ================= C. 未登录 ================= */
  await stubCloud(p, "ok", false);
  await openReportUI(p, STUB.id);
  t = await submit(p, "违法违规内容");
  T("未登录时提示先登录", t.some((x) => x.includes("需要先登录")), t);
  T("未登录不入队（避免空归属补发被 RLS 拒）", (await queue(p)).length === 0, await queue(p));

  /* ================= D. 云端可用 → 真入库 ================= */
  await stubCloud(p, "ok", true);
  await openReportUI(p, STUB.id);
  t = await submit(p, "违法违规内容");
  T("提交成功给明确回执", t.some((x) => x.includes("举报已提交")), t);
  T("成功不留队列", (await queue(p)).length === 0, await queue(p));
  const ins = await p.evaluate(() => window.__ins.slice());
  T("真的调了 insert", ins.length === 1, ins.length);
  const row = ins[0] || {};
  T("字段完整：目标类型/ID", row.target_type === "post" && String(row.target_id) === "777", row);
  T("字段完整：理由与快照", row.reason === "违法违规内容" && String(row.snapshot).includes("测试举报链路"), { r: row.reason, s: (row.snapshot || "").slice(0, 30) });
  T("字段完整：举报人归属", row.reporter_id === "test-uid-1" && row.reporter_name === "测试家长", { id: row.reporter_id, n: row.reporter_name });

  /* ================= E. 后端报错 → 如实失败，不假装成功 ================= */
  await p.evaluate((qk) => localStorage.removeItem(qk), QKEY);
  await stubCloud(p, "db", true);
  await openReportUI(p, STUB.id);
  t = await submit(p, "垃圾营销信息");
  T("后端报错不谎报成功", !t.some((x) => x.includes("已提交")), t);
  T("后端报错说清没提交上", t.some((x) => x.includes("没能提交")), t);
  T("后端报错不入队（避免死循环重试）", (await queue(p)).length === 0, await queue(p));

  /* ================= F. 断网入队 + 登录后补发 ================= */
  await p.evaluate((qk) => localStorage.removeItem(qk), QKEY);
  await stubCloud(p, "null", false);
  await openReportUI(p, STUB.id);
  t = await submit(p, "侵犯隐私泄露");
  T("断网时如实说明并说会补发", t.some((x) => x.includes("存在本机")), t);
  const q1 = await queue(p);
  T("断网入队 1 条", q1.length === 1, q1.length);
  T("入队项无归属（等登录后补）", !q1[0].reporter_id, q1[0].reporter_id || "");

  await stubCloud(p, "ok", true);
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await p.waitForTimeout(2400);   /* rpFlush 由 online 触发，延迟 1.5s */
  T("联网后队列自动清空", (await queue(p)).length === 0, await queue(p));
  const ins2 = await p.evaluate(() => window.__ins.slice());
  T("补发时补上举报人归属", ins2.length === 1 && ins2[0].reporter_id === "test-uid-1", ins2.map((x) => x.reporter_id));
  T("补发保留原始理由", ins2.length === 1 && ins2[0].reason === "侵犯隐私泄露", ins2[0] && ins2[0].reason);

  /* ================= G. 全程零报错 ================= */
  T("页面无 JS 报错", errs.length === 0, errs.slice(0, 3));

  await b.close();
  const line = "结果: " + pass + " 通过, " + fail + " 失败";
  console.log("\n" + line);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
