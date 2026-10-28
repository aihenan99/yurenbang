/* pub-prod-probe：线上复现「+ → 图片 → 发布」链路（观察每一步的实际表现） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [], toasts = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await p.goto("https://xn--gmqq09al6z.cn/?pp=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(1000);
  const env = await p.evaluate(() => ({
    cap: !!window.YRB_CAPTURE, live: window.YRB_CAPTURE ? YRB_CAPTURE.live() : null,
    cloudReady: window.YRB_CLOUD ? YRB_CLOUD.ready() : null, signedIn: window.YRB_CLOUD ? YRB_CLOUD.signedIn() : null
  }));
  console.log("T1 环境:", JSON.stringify(env));

  /* 桩登录过门槛（gate 重放点击） */
  await p.evaluate(() => { try { YRB_CLOUD.signedIn = () => true; } catch (e) {} });
  await p.evaluate(() => document.getElementById("fab").click());
  await p.waitForTimeout(600);
  const st2 = await p.evaluate(() => ({ open: document.getElementById("publishSheet").classList.contains("open"), picker: !!document.getElementById("r23Picker") }));
  console.log("T2 发布面板:", JSON.stringify(st2));

  await p.evaluate(() => { const btn = document.querySelector('#pubTypes .seg-btn[data-t="img"]') || document.querySelectorAll('#pubTypes .seg-btn')[0]; btn.click(); });
  await p.waitForTimeout(500);
  const pick = await p.evaluate(() => {
    const h = document.getElementById("r23Picker");
    return { len: h ? h.innerHTML.length : -1, hasInput: !!document.querySelector('#r23Picker input[type=file]'), head: h ? h.innerHTML.replace(/\s+/g, " ").slice(0, 200) : "EMPTY" };
  });
  console.log("T3 图片选择器:", JSON.stringify(pick));

  const [chooser] = await Promise.all([
    p.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null),
    p.evaluate(() => { const i = document.querySelector('#r23Picker input[type=file]'); if (i) i.click(); })
  ]);
  if (chooser) {
    await chooser.setFiles("E:/育人帮/temp/ppt-test/i1.png");
    await p.waitForTimeout(2000);
    const st4 = await p.evaluate(() => ({ n: YRB_CAPTURE.count(), hint: (document.querySelector('#r23Picker .cap-hint') || {}).textContent || "" }));
    console.log("T4 选图后:", JSON.stringify(st4));
  } else console.log("T4 文件选择器没弹出");

  /* 点发布 → 确认页 → 确认发布，观察 toast 与网络 */
  const reqs = [];
  p.on("request", r => { if (r.url().includes("yrbapi")) reqs.push(r.method() + " " + r.url().slice(-70)); });
  await p.evaluate(() => { const g = document.getElementById("pubGo"); if (g) g.click(); });
  await p.waitForTimeout(800);
  const cf = await p.evaluate(() => ({ confirm: document.getElementById("r23Confirm").classList.contains("open"), toast: (document.getElementById("toast") || {}).textContent || "" }));
  console.log("T5 点发布后:", JSON.stringify(cf));
  if (cf.confirm) {
    await p.evaluate(() => { const g = document.getElementById("r23CfGo"); if (g) g.click(); });
    await p.waitForTimeout(4000);
    const r6 = await p.evaluate(() => ({ toast: (document.getElementById("toast") || {}).textContent || "", loginOpen: document.getElementById("loginSheet").classList.contains("open"), feed: document.querySelectorAll("#feed .card").length }));
    console.log("T6 确认发布后:", JSON.stringify(r6));
    console.log("yrbapi 请求:", reqs.slice(0, 8).join(" || ") || "无");
  }
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
