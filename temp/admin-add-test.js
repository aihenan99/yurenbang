/* 首页「＋添加」按钮管理员可见性回归（2026-10-24）
   1) 未登录/普通用户：栏目行无 .f-add
   2) 管理员（模拟 YRB_CONSOLE.isAdmin=true + yrb-auth 事件）：出现 .f-add
   3) 管理员退出（isAdmin=false + yrb-auth）：按钮再次消失
   4) 页面零脚本错误 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const URL = "http://127.0.0.1:8794/?admintest=" + Date.now();
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  console.log((ok ? "✅" : "❌") + " " + name + (extra ? "  [" + extra + "]" : ""));
  ok ? pass++ : fail++;
}
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2600);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(1000);

  /* T1 普通用户（未登录，云端不可用 → isAdmin=false）：无 ＋ */
  const t1 = await p.evaluate(() => {
    const row = document.querySelector("#funcrow");
    return {
      hasAdd: !!document.querySelector("#funcrow .f-add"),
      chips: row ? row.querySelectorAll(".f-chip").length : -1,
      console: !!(window.YRB_CONSOLE && YRB_CONSOLE.isAdmin),
      adminNow: (window.YRB_CONSOLE && YRB_CONSOLE.isAdmin) ? YRB_CONSOLE.isAdmin() : "no-console"
    };
  });
  ck("普通用户栏目行无「＋」", !t1.hasAdd, JSON.stringify(t1));
  ck("栏目 chips 本身正常渲染", t1.chips >= 1, "chips=" + t1.chips);
  ck("YRB_CONSOLE.isAdmin 判定可用", t1.console && t1.adminNow === false, String(t1.adminNow));

  /* T2 模拟管理员登录：isAdmin=true + 派发 yrb-auth → 按钮出现 */
  const t2 = await p.evaluate(() => {
    YRB_CONSOLE.isAdmin = () => true;
    window.dispatchEvent(new CustomEvent("yrb-auth", { detail: { signedIn: true } }));
    return new Promise(r => setTimeout(() => r({ hasAdd: !!document.querySelector("#funcrow .f-add") }), 300));
  });
  ck("管理员登录后「＋」出现", t2.hasAdd);

  /* T3 点「＋」能打开添加面板（功能未被破坏） */
  const t3 = await p.evaluate(() => {
    const add = document.querySelector("#funcrow .f-add");
    if (!add) return { ok: false };
    add.click();
    return new Promise(r => setTimeout(() => {
      const sheet = document.querySelector("#funcAddSheet");
      r({ ok: !!(sheet && (sheet.classList.contains("open") || sheet.classList.contains("show") || getComputedStyle(sheet).display !== "none")) });
    }, 400));
  });
  ck("点「＋」打开添加面板", t3.ok, JSON.stringify(t3));
  await p.evaluate(() => { try { closeSheet("funcAddSheet"); } catch (e) {} });

  /* T4 管理员退出：按钮消失 */
  const t4 = await p.evaluate(() => {
    YRB_CONSOLE.isAdmin = () => false;
    window.dispatchEvent(new CustomEvent("yrb-auth", { detail: { signedIn: false } }));
    return new Promise(r => setTimeout(() => r({ hasAdd: !!document.querySelector("#funcrow .f-add") }), 300));
  });
  ck("管理员退出后「＋」消失", !t4.hasAdd);

  /* T5 页面零脚本错误 */
  ck("页面零脚本错误", errs.length === 0, errs.join(" | ").slice(0, 120));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
