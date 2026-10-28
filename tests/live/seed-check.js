/* seed-check — 线上复验：模板假数据已下线 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("https://xn--gmqq09al6z.cn/?sc=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const txt = document.body.innerText || "";
    const names = ["小雨妈妈", "乐乐爸爸", "David", "佐藤花子", "心理老师周周", "Anna"];
    const leftovers = names.filter(n => txt.includes(n));
    const feedCards = document.querySelectorAll("#feed .card").length;
    const feedEmpty = !!document.querySelector("#feed .empty");
    const cases = document.querySelectorAll("#caseGrid .case-card").length;
    const badge = (document.getElementById("msgBadge") || {}).textContent || "";
    const stats = (document.getElementById("meStats") || {}).innerText || "";
    return { leftovers, feedCards, feedEmpty, feedEmptyText: feedEmpty ? document.querySelector("#feed .empty").textContent.trim() : "", cases, badge, stats: stats.replace(/\n/g, " ") };
  });
  console.log(JSON.stringify(r, null, 1));
  console.log("errs:", errs.length ? errs.join(" | ") : "无");
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
