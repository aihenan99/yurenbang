/* cu-types-probe：PPT/视频类型经 label 选取 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?cut=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);

  /* PPT：点类型 → 点 label → 选 pptx */
  await p.evaluate(() => { const f = document.getElementById("caseFab"); if (f) f.click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.querySelector('#cuTypes .seg-btn[data-t="ppt"]'); if (b) b.click(); });
  await p.waitForTimeout(400);
  const acc = await p.evaluate(() => { const i = document.querySelector("#cuGrid input.cu-in"); return i ? i.accept : null; });
  console.log("PPT accept 含 MIME:", acc && acc.includes("presentationml") ? "✅" : "❌ " + acc);
  const [ch1] = await Promise.all([
    p.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null),
    p.evaluate(() => { const l = document.querySelector("#cuGrid label.cu-add"); if (l) l.click(); })
  ]);
  if (ch1) {
    await ch1.setFiles("E:/育人帮/temp/ppt-test/sample_fixed.pptx");
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ tiles: document.querySelectorAll("#cuGrid .cu-tile").length, toast: (document.getElementById("toast")||{}).textContent || "" }));
    console.log("PPT 选取:", JSON.stringify(st));
  } else console.log("PPT 文件选择器未弹出 ❌");

  /* 视频 */
  await p.evaluate(() => { const b = document.querySelector('#cuTypes .seg-btn[data-t="video"]'); if (b) b.click(); });
  await p.waitForTimeout(400);
  const [ch2] = await Promise.all([
    p.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null),
    p.evaluate(() => { const l = document.querySelector("#cuGrid label.cu-add"); if (l) l.click(); })
  ]);
  if (ch2) {
    await ch2.setFiles("E:/育人帮/temp/ppt-test/i1.png");   /* 拿图片冒充视频文件测 change 链路（videoDur 失败会得 0 秒，仍应入列） */
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ tiles: document.querySelectorAll("#cuGrid .cu-tile").length, toast: (document.getElementById("toast")||{}).textContent || "" }));
    console.log("视频链路:", JSON.stringify(st));
  } else console.log("视频文件选择器未弹出 ❌");

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
