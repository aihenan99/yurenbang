/* deepcheck-test：后台「🩺 系统健康」云端深度体检 + 用户端错误日志 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?deep=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  /* 场景一：云端体检成功 */
  const A = await p.evaluate(async () => {
    const healthData = {
      tables: [{ name: "yb_posts", rls: true }, { name: "yb_comments", rls: true }, { name: "yb_cases", rls: true }, { name: "yb_errlog", rls: true }],
      posts: 12, comments: 30, cases: 10, gifts: 5, tutors: 2, errlog: 3, errlog24h: 1,
      checked_at: "2026-10-25 21:10:00"
    };
    const errsData = [
      { created_at: new Date().toISOString(), kind: "js-error", msg: "Cannot read properties of undefined (reading 'x')", src: "app.js:120", build: "202610252057", uid: "uabc12345" },
      { created_at: new Date().toISOString(), kind: "promise", msg: "上传超时", src: "", build: "202610252057", uid: "udef67890" }
    ];
    function q(data) { const o = { select() { return o; }, order() { return o; }, eq() { return o; }, limit() { return Promise.resolve({ data: [] }); }, maybeSingle() { return Promise.resolve({ data: null }); } }; return o; }
    const calls = [];
    const orig = window.YRB_CLOUD || {};
    window.YRB_CLOUD = Object.assign({}, orig, {
      enabled: () => true, signedIn: () => true,
      who: () => ({ id: "2110319594408247296", phone: "18000005855", name: "管理员" }),
      client: {
        database: {
          from(t) { return q([]); },
          rpc(fn, args) { calls.push(fn); if (fn === "yb_admin_health") return Promise.resolve({ data: healthData }); if (fn === "yb_admin_recent_errs") return Promise.resolve({ data: errsData }); return Promise.resolve({ data: null }); }
        }
      }
    });
    window.YRB_ADMINGUARD = { needed: () => true, unlocked: () => true, prompt() {} };
    window.confirm = () => true;
    try { YRB_CONSOLE.isAdmin = () => true; } catch (e) {}
    try { YRB_CONSOLE.openAdmin(); } catch (e) { return { err: "openAdmin: " + e.message }; }
    await new Promise(r => setTimeout(r, 600));
    const tab = document.querySelector('[data-adtab="health"]');
    if (!tab) return { err: "no health tab" };
    tab.click();
    await new Promise(r => setTimeout(r, 400));
    const deepBtn = document.querySelector('[data-heal="deep"]');
    if (!deepBtn) return { err: "no deep button" };
    deepBtn.click();
    await new Promise(r => setTimeout(r, 900));
    const deep = document.getElementById("adDeep") || {};
    const errsBox = document.getElementById("adErrs") || {};
    return {
      called: calls,
      deepText: deep.textContent || "",
      errsText: errsBox.textContent || "",
      copyBtn: !!document.querySelector('[data-heal="copyreport"]'),
      clearBtn: !!document.querySelector('[data-heal="clearerrs"]')
    };
  });
  if (A.err) { console.log("❌ 没跑到：" + A.err); fail++; }
  else {
    ck("「云端深度体检」按钮在位", (A.called || []).indexOf("yb_admin_health") >= 0, JSON.stringify(A.called));
    ck("体检结果渲染（RLS 防线/数据规模）", A.deepText.indexOf("yb_posts") >= 0 && A.deepText.indexOf("RLS 防线开启") >= 0, A.deepText.slice(0, 160));
    ck("显示 24h 错误概况", A.deepText.indexOf("最近 24 小时") >= 0, "");
    ck("用户端错误日志拉取渲染（2 条）", (A.errsText || "").indexOf("Cannot read properties") >= 0 && (A.errsText || "").indexOf("上传超时") >= 0, A.errsText.slice(0, 160));
    ck("复制报告/清理日志按钮在位", A.copyBtn && A.clearBtn, "");
  }

  /* 场景二：非管理员调用被 42501 拒绝 → 明确失败提示（独立加载） */
  await p.goto("http://127.0.0.1:8793/deploy-cn/?deep2=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  const B = await p.evaluate(async () => {
    function q(data) { const o = { select() { return o; }, order() { return o; }, eq() { return o; }, limit() { return Promise.resolve({ data }); }, maybeSingle() { return Promise.resolve({ data: null }); } }; return o; }
    const orig = window.YRB_CLOUD || {};
    window.YRB_CLOUD = Object.assign({}, orig, {
      enabled: () => true, signedIn: () => true,
      who: () => ({ id: "2110319594408247296", phone: "18000005855", name: "管理员" }),
      client: { database: { from(t) { return q([]); }, rpc(fn) { return Promise.resolve({ error: { message: "42501: 仅管理员可执行深度体检" } }); } } }
    });
    window.YRB_ADMINGUARD = { needed: () => true, unlocked: () => true, prompt() {} };
    try { YRB_CONSOLE.isAdmin = () => true; } catch (e) {}
    try { YRB_CONSOLE.openAdmin(); } catch (e) { return { err: "openAdmin: " + e.message }; }
    await new Promise(r => setTimeout(r, 1000));
    let tab = document.querySelector('[data-adtab="health"]');
    if (!tab) return { err: "no health tab", body: (document.getElementById("adBody") || {}).textContent || "" };
    tab.click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('[data-heal="deep"]').click();
    await new Promise(r => setTimeout(r, 800));
    const deep = document.getElementById("adDeep") || {};
    return { text: deep.textContent || "" };
  });
  if (B.err) { console.log("❌ 拒绝场景没跑到：" + B.err); fail++; }
  else {
    ck("非管理员被拒 → 明确提示（不假装成功）", B.text.indexOf("深度体检失败") >= 0 && B.text.indexOf("42501") >= 0, B.text.slice(0, 120));
  }

  const realErrs = errs.filter(x => x.indexOf("仅管理员") < 0);
  ck("无意外脚本错误", realErrs.length === 0, realErrs.join(" | ").slice(0, 120));
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
