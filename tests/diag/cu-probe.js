/* cu-probe：案例广场上传全链路探针（本地 deploy-cn） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  p.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.text().slice(0, 140)); });
  await p.goto("http://127.0.0.1:8793/deploy-cn/?cu=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} try { YRB_CLOUD.signedIn = () => true; } catch (e) {} });
  await p.waitForTimeout(700);

  /* T1 打开案例上传面板 */
  await p.evaluate(() => { const f = document.getElementById("caseFab"); if (f) f.click(); });
  await p.waitForTimeout(700);
  const st1 = await p.evaluate(() => {
    const ids = ["cuSheet","cuTypes","cuGrid","cuFile","cuGo","cuTitle"];
    const o = {};
    ids.forEach(id => { const el = document.getElementById(id); o[id] = el ? { exists: true, hidden: el.hidden, visible: el.offsetWidth > 0 || el.offsetHeight > 0 || id === "cuFile" } : null; });
    o.sheetOpen = (document.getElementById("cuSheet") || document.querySelector(".cu-sheet") || {}).classList ? [...(document.getElementById("cuSheet")||document.querySelector(".cu-sheet")).classList] : null;
    return o;
  });
  console.log("T1 面板元素:", JSON.stringify(st1));

  /* T2 点图片类型 → cuGrid 渲染 + 按钮 */
  await p.evaluate(() => { const b = document.querySelector('#cuTypes .seg-btn[data-t="img"]'); if (b) b.click(); });
  await p.waitForTimeout(400);
  const st2 = await p.evaluate(() => {
    const add = document.getElementById("cuAdd");
    const inp = document.getElementById("cuFile");
    return { addBtn: !!add, accept: inp && inp.accept, multiple: inp && inp.multiple, note: (document.getElementById("cuNote")||{}).textContent, gridHtml: (document.getElementById("cuGrid")||{}).innerHTML };
  });
  console.log("T2 图片类型:", JSON.stringify(st2).slice(0, 400));

  /* T3 点 + → filechooser 弹出？ */
  const [chooser] = await Promise.all([
    p.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null),
    p.evaluate(() => { const a = document.querySelector("#cuGrid label.cu-add"); if (a) a.click(); })
  ]);
  console.log("T3 文件选择器:", chooser ? "弹出 ✅" : "未弹出 ❌");
  if (chooser) {
    await chooser.setFiles(["E:/育人帮/temp/ppt-test/i1.png", "E:/育人帮/temp/ppt-test/i2.png"]);
    await p.waitForTimeout(2500);
    const st3 = await p.evaluate(() => {
      const g = document.getElementById("cuGrid");
      return { tiles: g ? g.querySelectorAll(".cu-tile").length : -1, toast: (document.getElementById("toast")||{}).textContent || "" };
    });
    console.log("T4 选图后:", JSON.stringify(st3));

    /* T5 填标题发布 */
    await p.evaluate(() => { document.getElementById("cuTitle").value = "探针测试案例"; });
    await p.evaluate(() => { const g = document.getElementById("cuGo"); if (g) g.click(); });
    await p.waitForTimeout(4000);
    const st5 = await p.evaluate(() => ({ toast: (document.getElementById("toast")||{}).textContent || "", cases: (typeof S !== "undefined" ? S.cases.length : -1), loginOpen: document.getElementById("loginSheet") ? document.getElementById("loginSheet").classList.contains("open") : null }));
    console.log("T5 发布后:", JSON.stringify(st5));
  }
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
