/* privacy-test：隐私与个人信息（设置页）——2026-10-28 整改后的防回潮用例
   背景：整改前设置页有两类硬伤，第三方审核一票否决：
     ① 虚假状态：示例手机号 138****8888、微信绑定「已绑定」、实名认证「已认证」、
        我的页挂「已实名」标签——平台根本没有对应流程；
     ② 装饰开关：公开我的求助 / 允许陌生人评论 / 个性化推荐 / 同城可见 四个开关，
        只切 UI 不落库，契约里也没有字段。
   现在：开关全部撤掉，只留三个真实可读的正文入口；政策正文升级到 v2.0。
   覆盖：入口可达 / 零开关 / 三个入口齐全 / 政策正文关键条款 / 阅读模式不代勾同意 /
         儿童规则正文 / 我的数据说明 / 账号页与我的页零虚假状态
   运行前：python -m http.server 8796 --bind 127.0.0.1 --directory yurenbang-app */
const { chromium } = require("../helpers/pw.js").loadPlaywright();
const CHROME = require("../helpers/pw.js").chromePath();
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";
let pass = 0, fail = 0;
function T(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}

async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const errs = [];
  p.on("pageerror", e => errs.push(String((e && (e.stack || e.message)) || e).slice(0, 400)));
  await p.goto(BASE + "?pv=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(1200);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.click("#splash"); await p.waitForTimeout(600); }
  return { p, errs };
}

/* 打开 设置 → 隐私与个人信息（走真实 UI：点齿轮开下拉，再点菜单项） */
async function openPrivacy(p) {
  await p.evaluate(() => { const b = document.getElementById("btnSet"); if (b) b.click(); });
  await p.waitForTimeout(300);
  const hit = await p.evaluate(() => {
    const it = document.querySelector('#dropdown .dd-item[data-k="privacy"]');
    if (it) it.click();
    return it ? it.textContent.trim() : "";
  });
  await p.waitForTimeout(350);
  const state = await p.evaluate(() => ({
    open: !!document.querySelector("#subpage.open"),
    title: (document.getElementById("spTitle") || {}).textContent || "",
    switches: document.querySelectorAll("#spBody .switch").length,
    hasPolicy: !!document.getElementById("pvPolicy"),
    hasChild: !!document.getElementById("pvChild"),
    hasMine: !!document.getElementById("pvMine"),
    rows: [...document.querySelectorAll("#spBody .sp-row")].map(r => r.textContent.trim())
  }));
  return { hit, state };
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const { p, errs } = await openPage(b);

  /* ---------- 一、入口与页面结构 ---------- */
  const { hit, state } = await openPrivacy(p);
  T("设置菜单项叫「隐私与个人信息」", /隐私与个人信息/.test(hit), hit);
  T("隐私子页可打开且标题正确", state.open && state.title === "隐私与个人信息", state);
  T("隐私页零装饰开关（.switch 数量为 0）", state.switches === 0, { switches: state.switches });
  T("三个真实正文入口齐全（政策 / 儿童规则 / 我的数据）",
    state.hasPolicy && state.hasChild && state.hasMine, state.rows);

  /* ---------- 二、隐私政策 v2.0 正文 ---------- */
  await p.evaluate(() => { const b = document.getElementById("pvPolicy"); if (b) b.click(); });
  await p.waitForTimeout(400);
  const doc = await p.evaluate(() => {
    const p2 = document.querySelector("#lgDoc");
    const body = document.getElementById("lgDocBody");
    return {
      open: !!(p2 && p2.classList.contains("open")),
      text: body ? body.textContent : "",
      btn: (document.getElementById("lgDocOk") || {}).textContent || "",
      version: ((document.getElementById("lgDocTag") || {}).textContent || "").trim()
    };
  });
  T("隐私政策正文能打开", doc.open, doc.open);
  T("正文版本为 v2.0", /v2\.0/.test(doc.version), doc.version);
  T("含 PIPL 必备条款（处理者 / 跨境 / 单独同意 / 12377）",
    /个人信息处理者/.test(doc.text) && /跨境/.test(doc.text) && /单独同意/.test(doc.text) && /12377/.test(doc.text),
    doc.text.slice(0, 60));
  T("不再出现「存储于中国境内」这类与事实不符的表述", !/存储于中国境内/.test(doc.text), "");
  T("底部按钮为「关闭」（设置页阅读模式）", doc.btn.trim() === "关闭", doc.btn);

  /* 阅读模式不得替用户勾上登录页的同意框 */
  await p.evaluate(() => { const b = document.getElementById("lgDocOk"); if (b) b.click(); });
  await p.waitForTimeout(300);
  const ck = await p.evaluate(() => {
    const c = document.getElementById("lgCk");
    return { on: !!(c && c.classList.contains("on")), closed: !document.querySelector("#lgDoc.open") };
  });
  T("关闭正文后不代勾登录同意框，且正文已关闭", !ck.on && ck.closed, ck);

  /* ---------- 三、儿童个人信息处理规则 ---------- */
  await p.evaluate(() => { const b = document.getElementById("pvChild"); if (b) b.click(); });
  await p.waitForTimeout(400);
  const child = await p.evaluate(() => {
    const body = document.getElementById("lgDocBody");
    return { open: !!document.querySelector("#lgDoc.open"), text: body ? body.textContent : "" };
  });
  T("儿童规则可读且写清 72 小时响应 / 监护人同意",
    child.open && /72 小时/.test(child.text) && /监护人/.test(child.text), child.text.slice(0, 40));
  await p.evaluate(() => { const b = document.getElementById("lgDocOk"); if (b) b.click(); });
  await p.waitForTimeout(250);

  /* ---------- 四、我的数据（删除与注销）说明 ---------- */
  await p.evaluate(() => { const b = document.getElementById("pvMine"); if (b) b.click(); });
  await p.waitForTimeout(350);
  const mine = await p.evaluate(() => {
    const m = document.getElementById("mdCard");
    return { open: !!document.querySelector("#modal.open"), text: m ? m.textContent : "" };
  });
  T("「我的数据」说明可打开，且如实说明自助入口未开放",
    mine.open && /注销/.test(mine.text) && /15 个工作日/.test(mine.text), mine.text.slice(0, 60));
  await p.evaluate(() => { const m = document.getElementById("modal"); if (m) m.classList.remove("open"); });
  await p.evaluate(() => { if (window.closeSubpage) window.closeSubpage(); });

  /* ---------- 五、账号与安全页：零虚假状态 ---------- */
  await p.evaluate(() => { if (window.openSubpage) window.openSubpage("acct"); });
  await p.waitForTimeout(400);
  const acct = await p.evaluate(() => {
    const t = (document.getElementById("spBody") || {}).textContent || "";
    return {
      text: t,
      fake: ["138****8888", "已绑定", "已认证", "实名认证", "微信绑定"].filter(s => t.includes(s)),
      phoneRow: [...document.querySelectorAll("#spBody .sp-row")].some(r => /手机号/.test(r.textContent))
    };
  });
  T("账号与安全页无虚假状态（手机号示例 / 微信 / 实名）", acct.fake.length === 0, acct.fake);
  T("账号与安全页保留手机号入口（登录后显示真实号）", acct.phoneRow && /登录后显示/.test(acct.text), acct.text.slice(0, 40));

  /* ---------- 六、我的页：未登录不显示「已实名」 ---------- */
  await p.evaluate(() => { if (window.closeSubpage) window.closeSubpage(); const t = document.querySelector('#tabbar [data-p="me"]'); if (t) t.click(); });
  await p.waitForTimeout(400);
  const me = await p.evaluate(() => {
    const el = document.getElementById("meId") || document.querySelector(".me-id");
    return { text: el ? el.textContent : "", hasReal: document.body.textContent.includes("已实名") };
  });
  T("我的页不再挂「已实名」标签", !/已实名/.test(me.text) && !me.hasReal, me);

  T("全程无未捕获脚本异常", errs.length === 0, errs.slice(0, 2));

  await b.close();
  console.log("\n" + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("FAIL 用例异常", String(e && e.stack || e).slice(0, 500)); console.log("\n0 通过, 1 失败"); process.exit(1); });
