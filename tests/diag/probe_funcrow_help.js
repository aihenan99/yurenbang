/* 线上验收：首页栏目调整（2026-11-01）
   断言：1) 栏目顺序 = 推荐/案例/家教/求助（家教不再第一位）
         2) 行内无「＋添加」
         3) 点「求助」弹出与底部 ＋ 相同的发布面板（#publishSheet.open）
         4) 点「家教」切到家教页
   用法：node tests/diag/probe_funcrow_help.js */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "https://xn--gmqq09al6z.cn/";

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3500);

  const chips = await page.$$eval("#funcrow .f-chip", es => es.map(e => e.textContent.trim()));
  const addCnt = await page.$$eval("#funcrow .f-add", es => es.length);
  console.log("栏目：", chips.join(" / "));
  console.log("行内＋添加数量（应为 0）：", addCnt);

  let ok1 = chips.join("|").indexOf("推荐") < chips.join("|").indexOf("家教")
        && chips.join("|").indexOf("家教") < chips.join("|").indexOf("求助");
  console.log(ok1 ? "✅ 顺序：推荐→…→家教→求助" : "❌ 顺序不对");
  console.log(addCnt === 0 ? "✅ 行内＋已撤" : "❌ 行内还有＋");

  /* 点「求助」→ 发布面板应打开 */
  await page.$$eval("#funcrow .help-chip", es => es[0] && es[0].click());
  await page.waitForTimeout(1200);
  const sheetOpen = await page.$eval("#publishSheet", el => el.classList.contains("open")).catch(() => false);
  const sheetTitle = await page.$eval("#publishSheet", el => (el.textContent || "").slice(0, 60).replace(/\s+/g, " ")).catch(() => "");
  console.log(sheetOpen ? "✅ 点求助弹出发布面板" : "❌ 发布面板未打开");
  console.log("   面板内容片段：", sheetTitle);

  /* 关掉，再点「家教」→ 应切到家教页 */
  await page.$eval("#publishSheet .sheet-x, #publishSheet [data-close]", el => el.click()).catch(() => {});
  await page.waitForTimeout(600);
  await page.$$eval("#funcrow .jj-chip", es => es[0] && es[0].click());
  await page.waitForTimeout(1200);
  const jjActive = await page.$eval("#page-jiaojiao", el => el.classList.contains("active")).catch(() => false);
  console.log(jjActive ? "✅ 点家教切到家教页" : "❌ 家教页未激活");

  console.log(errs.length ? "❌ 页面脚本报错：" + errs.join(" | ") : "✅ 零脚本报错");
  await b.close();
  process.exit(ok1 && addCnt === 0 && sheetOpen && jjActive && !errs.length ? 0 : 1);
})();
