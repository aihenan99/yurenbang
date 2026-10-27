/* guard-test：错误监控守护层（guard.js）——捕获/去重/云端限频上报 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?grd=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  /* T1 层已加载且 API 完整 */
  const t1 = await p.evaluate(() => ({
    on: !!window.YRB_GUARD,
    api: !!(window.YRB_GUARD && window.YRB_GUARD.push && window.YRB_GUARD.status && window.YRB_GUARD.recent)
  }));
  ck("YRB_GUARD 已加载且 API 完整", t1.on && t1.api, JSON.stringify(t1));

  /* T2 免疫系统探针认得 guard 层 */
  const t2 = await p.evaluate(() => {
    const s = YRB_HEALTH.status();
    return { layers: s.layers ? null : null, guard: s.detail.guard || {}, healthy: s.healthy, layerList: YRB_HEALTH.layers().indexOf("guard") };
  });
  ck("health 探针登记 guard 层且状态 ok", t2.guard.state === "ok" && t2.layerList >= 0, JSON.stringify(t2.guard));

  /* T3 桩云 SDK → push 后自动上报 yb_errlog */
  const t3 = await p.evaluate(async () => {
    window.__ins = [];
    const orig = window.YRB_CLOUD || {};
    window.YRB_CLOUD = Object.assign({}, orig, {
      enabled: () => true,
      client: { database: { from(t) { return { insert(rows) { window.__ins.push({ t, rows }); return Promise.resolve({}); } }; } } }
    });
    YRB_GUARD.push("js-error", "测试错误A", "test.js");
    await new Promise(r => setTimeout(r, 900));
    const row = window.__ins.length ? window.__ins[0] : null;
    return {
      sent: row ? row.t : null,
      kind: row && row.rows && row.rows[0] ? row.rows[0].kind : null,
      msg: row && row.rows && row.rows[0] ? row.rows[0].msg : null,
      uidOk: !!(row && row.rows && row.rows[0] && /^u[a-z0-9]{4,}/.test(row.rows[0].uid)),
      counter: YRB_GUARD.status().sent
    };
  });
  ck("push → 自动写入 yb_errlog", t3.sent === "yb_errlog" && t3.kind === "js-error" && t3.msg === "测试错误A", JSON.stringify(t3).slice(0, 140));
  ck("上报带匿名 uid", t3.uidOk, "");

  /* T4 同指纹 90 秒去重 */
  const t4 = await p.evaluate(() => {
    const before = YRB_GUARD.recent().length;
    const r1 = YRB_GUARD.push("js-error", "去重错误B");
    const r2 = YRB_GUARD.push("js-error", "去重错误B");
    return { before, r1, r2: !!r2 };
  });
  ck("同指纹 90s 内去重（第二条被拒）", t4.r1 === true && t4.r2 === false, JSON.stringify(t4));

  /* T5 全局捕获真的在工作：抛一个未捕获错误 → recent 出现 js-error */
  await p.evaluate(() => { setTimeout(() => { try { null.__x.y(); } catch (e) { /* 触发 window error 需异步未捕获 */ } }, 0); });
  await p.evaluate(() => { setTimeout(() => { window.__uncaught = () => { throw new Error("guard捕获测试E"); }; window.__uncaught(); }, 0); });
  await p.waitForTimeout(600);
  const t5 = await p.evaluate(() => (YRB_GUARD.recent().map(x => x.msg)).join("||"));
  ck("真实未捕获错误被捕获记录", t5.indexOf("guard捕获测试E") >= 0, t5.slice(0, 120));

  /* T6 云未就绪 → 进队列不丢，client 恢复后 flush 补发 */
  const t6 = await p.evaluate(async () => {
    const orig = window.YRB_CLOUD;
    window.YRB_CLOUD = Object.assign({}, orig, { enabled: () => false, client: null });
    YRB_GUARD.push("promise", "离线队列测试F");
    const queued = YRB_GUARD.status().pending >= 0;
    /* 恢复云：下一次 flush（visible/timer）会把队列送出 */
    window.YRB_CLOUD = Object.assign({}, orig, {
      enabled: () => true,
      client: { database: { from(t) { return { insert(rows) { window.__ins.push({ t, rows }); return Promise.resolve({}); } }; } } }
    });
    YRB_GUARD.flush("test");
    await new Promise(r => setTimeout(r, 700));
    const msgs = (window.__ins || []).map(x => x.rows.map(r2 => r2.msg).join(",")).join("|");
    return { queued, got: msgs.indexOf("离线队列测试F") >= 0 };
  });
  ck("云未就绪进队列、恢复后补发", t6.queued && t6.got, JSON.stringify(t6));

  ck("除注入的测试错误外无其他脚本错误", errs.length === 1 && errs[0].indexOf("guard捕获测试E") >= 0, errs.join(" | ").slice(0, 120));
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
