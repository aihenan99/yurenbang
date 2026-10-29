/* 首页栏目（chips）配置层回归测试
   断言版：失败时 process.exit(1)，可进 npm run verify --e2e
   依赖：8793 服务（项目根，跑 /deploy-cn/）
   1) 默认 chips 只有「推荐 / 案例」，不含未开放模块
   2) YRB_CHIPS 就绪，extraAvail() 默认为空
   3) 后台下发（yrb-chips 事件）→ chips 即时变化
   4) ＋面板只列后台已开放的模块（不泄露未开放项）
   5) 爆火被下发移除时 hotMode 自动退出
   6) 离线缓存：localStorage 有配置时刷新即生效
   7) 全程无 pageerror
*/
const { chromium } = require("../helpers/pw.js").loadPlaywright();

const URL = "http://127.0.0.1:8793/deploy-cn/?tc=" + Date.now();
let pass = 0, fail = 0;
function ck(name, cond, info) {
  if (cond) { pass++; console.log("  ✓ " + name + (info ? "  [" + info + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + "  [" + (info || "") + "]"); }
}
const has = (arr, kw) => arr.some((x) => x.indexOf(kw) >= 0);

(async () => {
  const b = await chromium.launch({ executablePath: require("../helpers/pw.js").chromePath() });
  const p = await b.newPage({ viewport: { width: 412, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  await p.goto(URL, { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  /* T1 默认状态 */
  const r1 = await p.evaluate(() => ({
    chips: [...document.querySelectorAll("#funcrow .f-chip")].map((e) => e.textContent.trim()),
    hasLayer: !!window.YRB_CHIPS,
    extraAvail: window.YRB_CHIPS ? YRB_CHIPS.extraAvail() : null
  }));
  ck("默认 chips 含推荐与案例", has(r1.chips, "推荐") && has(r1.chips, "案例"), JSON.stringify(r1.chips));
  ck("默认不出现未开放模块（爆火/成长录）", !has(r1.chips, "爆火") && !has(r1.chips, "成长录"));
  ck("YRB_CHIPS 层已就绪", r1.hasLayer);
  ck("默认 extraAvail 为空", Array.isArray(r1.extraAvail) && r1.extraAvail.length === 0, JSON.stringify(r1.extraAvail));

  /* T2 后台下发 */
  const r2 = await p.evaluate(() => {
    window.dispatchEvent(new CustomEvent("yrb-chips", { detail: { funcs: ["foryou", "hot", "cases", "growth"], extra: ["名师课堂", "爱心集市"] } }));
    return {
      chips: [...document.querySelectorAll("#funcrow .f-chip")].map((e) => e.textContent.trim()),
      extraAvail: YRB_CHIPS.extraAvail()
    };
  });
  ck("下发后爆火/成长录即时上架", has(r2.chips, "爆火") && has(r2.chips, "成长录"), JSON.stringify(r2.chips));
  ck("下发后 extraAvail 同步开放", has(r2.extraAvail, "名师课堂") && has(r2.extraAvail, "爱心集市"), JSON.stringify(r2.extraAvail));

  /* T3 ＋面板不泄露未开放模块 */
  await p.evaluate(() => { const a = document.querySelector('#funcrow [data-f="add"]'); if (a) a.click(); });
  await p.waitForTimeout(400);
  const r3 = await p.evaluate(() => [...document.querySelectorAll(".fa-item")].map((e) => e.textContent.trim()));
  const leaked = r3.filter((x) => !r2.extraAvail.some((a) => x.indexOf(a) >= 0));
  ck("＋面板只列已开放模块", leaked.length === 0, "面板 " + JSON.stringify(r3) + (leaked.length ? " 越界 " + JSON.stringify(leaked) : ""));
  await p.evaluate(() => { const btn = document.querySelector("#funcAddSheet .close, [data-close]"); if (btn) btn.click(); try { closeSheet && closeSheet("funcAddSheet"); } catch (e) {} });
  await p.waitForTimeout(300);

  /* T4 爆火下架 → hotMode 自动退出 */
  const r4 = await p.evaluate(async () => {
    const btn = document.querySelector('#funcrow [data-f="hot"]');
    if (!btn) return { hotOn: false, hotAfter: false, chips: [] };
    btn.click();
    const hotOn = S.hotMode;
    window.dispatchEvent(new CustomEvent("yrb-chips", { detail: { funcs: ["foryou", "cases"], extra: [] } }));
    await new Promise((r) => setTimeout(r, 250));
    return { hotOn, hotAfter: S.hotMode, chips: [...document.querySelectorAll("#funcrow .f-chip")].map((e) => e.textContent.trim()) };
  });
  ck("点爆火进入 hotMode", r4.hotOn === true);
  ck("爆火下架后 hotMode 自动退出", r4.hotAfter === false, JSON.stringify(r4.chips));

  /* T5 离线缓存 */
  await p.evaluate(() => { localStorage.setItem("yrb_chips_v1", JSON.stringify({ funcs: ["foryou", "hot"], extra: [] })); });
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(1800);
  const r5 = await p.evaluate(() => [...document.querySelectorAll("#funcrow .f-chip")].map((e) => e.textContent.trim()));
  ck("缓存配置刷新后生效", has(r5, "爆火"), JSON.stringify(r5));

  ck("全程无 pageerror", errs.length === 0, errs.join(" | ").slice(0, 200));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
