/* 线上返回手势实机校验（2026-11-05）
   目的：确认生产站真的跑的是新版 navback（用户多次遇到「改了但手机上还是旧的」= 缓存）。
   校验：①切到「我的」②系统返回 → 回首页且网址不变 ③再返回 → 仍停在首页（落地保护）
   运行：node tests/diag/prod_nav_check.js */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const BASE = process.env.YRB_PROD || "https://xn--gmqq09al6z.cn/";

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  await p.goto(BASE + "?nav=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { const s = document.querySelector("#splash"); if (s && !s.classList.contains("hidden")) s.click(); } catch (e) {} });
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);

  const st = () => p.evaluate(() => ({
    tab: (() => { const a = document.querySelector(".page.active"); return a ? a.id.replace("page-", "") : ""; })(),
    url: location.href,
    build: (document.querySelector('meta[name="yrb-build"]') || {}).content || "",
    nav: !!(window.YRB_NAVBACK && window.YRB_NAVBACK.ready),
    alive: !!document.getElementById("feed")
  }));

  const s0 = await st();
  console.log("BUILD", s0.build, "| NAVBACK", s0.nav);

  await p.evaluate(() => switchTab("me"));
  await p.waitForTimeout(500);
  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const s1 = await st();

  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const s2 = await st();

  const ok1 = s1.tab === "home" && s1.url === s0.url && s1.alive;
  const ok2 = s2.url === s0.url && s2.alive;
  console.log((ok1 ? "✓" : "✗") + " 返回一次 → 回首页不退出 " + JSON.stringify(s1));
  console.log((ok2 ? "✓" : "✗") + " 再返回一次 → 仍停在首页（落地保护） " + JSON.stringify(s2));
  console.log(errs.length ? "PAGEERR " + errs.join(" | ") : "无脚本错误");
  await b.close();
  process.exit(ok1 && ok2 ? 0 : 1);
})();
