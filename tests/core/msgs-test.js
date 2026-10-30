/* msgs-test：消息页 M2 接线回归（源码直测）
   背景（2026-10-30）：消息页此前永远空态，副标题却写「帮忙 · 点赞 · 礼物」——虚假承诺；
   点击处理还是「原型演示」toast。接线后真读 yb_gifts（复用 food.js 收件箱）。
   本用例用桩数据源测五种分支：未登录 / 云维护 / 正常拉取 / 拉取失败 / 点击已读。
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
  await p.goto(BASE + "?msgs=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1200);

  const ROWS = [
    { id: 901, from_name: "朵朵妈", food: "红烧排骨", created_at: new Date(Date.now() - 36e5).toISOString(), seen: false },
    { id: 902, from_name: "阳阳爸", food: "", created_at: new Date(Date.now() - 864e5).toISOString(), seen: true }
  ];

  /* T1 未登录：如实空态 + 登录入口 */
  const r1 = await p.evaluate(async () => {
    const real = window.YRB_CLOUD;
    window.__realCloud = real;
    window.YRB_CLOUD = { signedIn: () => false, enabled: () => false, openLogin: () => { window.__loginClicked = true; } };
    await renderMsgs();
    const out = {
      txt: document.getElementById("msgList").textContent,
      hasLogin: !!document.getElementById("msgLogin"),
      badge: S.badge
    };
    document.getElementById("msgLogin").click();
    out.loginClicked = !!window.__loginClicked;
    window.YRB_CLOUD = real;
    return out;
  });
  T("未登录显示登录引导而非空态谎言", r1.hasLogin && r1.txt.indexOf("登录") >= 0, r1.txt);
  T("点登录按钮真的调起登录", r1.loginClicked === true, r1);
  T("未登录 badge 不虚标", r1.badge === 0, r1.badge);

  /* T2 云维护：如实说明 */
  const r2 = await p.evaluate(async () => {
    const real = window.YRB_CLOUD;
    window.YRB_CLOUD = { signedIn: () => true, enabled: () => false };
    await renderMsgs();
    const txt = document.getElementById("msgList").textContent;
    window.YRB_CLOUD = real;
    return { txt };
  });
  T("云维护时说明暂时看不了", r2.txt.indexOf("维护") >= 0, r2.txt);

  /* T3 正常拉取：桩数据源 → 渲染 + badge = 未读数 + S.msgs 整体替换 */
  const r3 = await p.evaluate(async () => {
    const ROWS = [
      { id: 901, from_name: "朵朵妈", food: "红烧排骨", created_at: new Date(Date.now() - 36e5).toISOString(), seen: false },
      { id: 902, from_name: "阳阳爸", food: "", created_at: new Date(Date.now() - 864e5).toISOString(), seen: true }
    ];
    const seenCalls = [];
    window.__seenCalls = seenCalls;
    const realFood = window.YRB_FOOD;
    window.__realFood = realFood;
    window.YRB_FOOD = Object.assign({}, realFood, {
      inbox: async () => ROWS,
      markSeen: (ids) => { seenCalls.push(ids); }
    });
    const realCloud = window.YRB_CLOUD;
    window.YRB_CLOUD = { signedIn: () => true, enabled: () => true };
    await renderMsgs();
    const out = {
      items: document.querySelectorAll("#msgList .msg-item").length,
      dots: document.querySelectorAll("#msgList .mg-dot").length,
      badge: S.badge,
      msgCount: S.msgs.length,
      firstTitle: (document.querySelector("#msgList .mg-t") || {}).textContent || "",
      hasTime: /\d{1,2}-\d{1,2}|分钟前|小时前|刚刚/.test((document.querySelector("#msgList .mg-time") || {}).textContent || "")
    };
    window.YRB_CLOUD = realCloud;
    return out;
  });
  T("两条礼物渲染成两条消息", r3.items === 2 && r3.msgCount === 2, r3);
  T("badge = 未读数（1）", r3.badge === 1 && r3.dots === 1, r3);
  T("标题带送信人", r3.firstTitle.indexOf("朵朵妈") >= 0, r3.firstTitle);
  T("时间是相对/日期格式而非空", r3.hasTime, r3);

  /* T4 点击消息：badge 减、markSeen 带 gid、文案不再出现「原型演示」 */
  const r4 = await p.evaluate(async () => {
    document.querySelector('#page-msgs .msg-item[data-act="msg"]').click();
    await new Promise((res) => setTimeout(res, 150));
    const t = document.getElementById("toast");
    return { badge: S.badge, seen: window.__seenCalls, toast: t ? t.textContent : "" };
  });
  T("点击后 badge 归零", r4.badge === 0, r4.badge);
  T("markSeen 落库带 gid", JSON.stringify(r4.seen) === "[[901]]", r4.seen);
  T("提示文案是真实指引（无原型演示）", r4.toast.indexOf("原型演示") < 0 && r4.toast.indexOf("收到的答谢") >= 0, r4.toast);

  /* T5 拉取失败：失败文案而非白屏 */
  const r5 = await p.evaluate(async () => {
    const realCloud = window.YRB_CLOUD;
    window.YRB_CLOUD = { signedIn: () => true, enabled: () => true };
    window.YRB_FOOD = Object.assign({}, window.__realFood, { inbox: async () => { throw new Error("net"); } });
    await renderMsgs();
    const txt = document.getElementById("msgList").textContent;
    window.YRB_CLOUD = realCloud;
    window.YRB_FOOD = window.__realFood;
    return { txt };
  });
  T("拉取失败有失败提示", r5.txt.indexOf("失败") >= 0, r5.txt);

  T("页面零脚本错误", errs.length === 0, errs.slice(0, 3));

  await b.close();
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS", e); process.exit(1); });
