/* feed-check：线上首页信息流诊断 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [], cloudLog = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  p.on("console", m => { const t = m.text(); if (/cloud|posts|merge|错误|fail|error/i.test(t)) cloudLog.push(m.type() + ":" + t.slice(0, 160)); });
  const reqs = [];
  p.on("response", async r => {
    if (r.url().includes("yb_posts")) reqs.push(r.status() + " " + r.url().slice(-60));
  });
  await p.goto("https://xn--gmqq09al6z.cn/?fc=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(2500);
  const st = await p.evaluate(() => ({
    cards: document.querySelectorAll("#feed .card").length,
    empty: (document.querySelector("#feed .empty") || {}).textContent || null,
    cloudPosts: (function () { try { return (S.posts || []).filter(x => x.__cloud).length; } catch (e) { return "n/a"; } })(),
    totalPosts: (function () { try { return (S.posts || []).length; } catch (e) { return "n/a"; } })(),
    cloudReady: (function () { try { return YRB_CLOUD.ready(); } catch (e) { return "n/a"; } })(),
    signedIn: (function () { try { return YRB_CLOUD.signedIn(); } catch (e) { return "n/a"; } })()
  }));
  console.log("信息流状态:", JSON.stringify(st));
  console.log("yb_posts 响应:", reqs.slice(0, 6).join(" || ") || "无");
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log("console:", cloudLog.slice(0, 10).join(" || ") || "无");
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
