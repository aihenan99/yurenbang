/* pub-probe：复现「+ → 图片/微视频/语音 → 上传」链路 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
  });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", permissions: ["camera", "microphone"] });
  const p = await ctx.newPage();
  const errs = [], logs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  p.on("console", m => { if (m.type() === "error" || m.type() === "warning") logs.push(m.type() + ":" + m.text().slice(0, 120)); });
  await p.goto("http://127.0.0.1:8794/?pp=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} try { YRB_CLOUD.signedIn = () => true; try { YRB_CLOUD.name = () => "测试家长"; } catch (e) {} } catch (e) {} });
  await p.waitForTimeout(700);

  const st1 = await p.evaluate(() => ({
    cap: !!window.YRB_CAPTURE,
    live: window.YRB_CAPTURE ? YRB_CAPTURE.live() : null,
    diag: window.YRB_CAPTURE && YRB_CAPTURE.diag ? YRB_CAPTURE.diag() : null
  }));
  console.log("T1 环境诊断:", JSON.stringify(st1));

  /* 点 + 打开发布面板 */
  await p.evaluate(() => document.getElementById("fab").click());
  await p.waitForTimeout(500);
  const sheetOpen = await p.evaluate(() => document.getElementById("publishSheet").classList.contains("open") || document.getElementById("publishSheet").classList.contains("show"));
  console.log("T2 发布面板打开:", sheetOpen);

  /* 点「图片」类型 */
  await p.evaluate(() => { const btn = document.querySelector('#pubTypes .seg-btn[data-t="img"]') || document.querySelectorAll('#pubTypes .seg-btn')[0]; btn.click(); });
  await p.waitForTimeout(500);
  const pick1 = await p.evaluate(() => ({ html: (document.getElementById("r23Picker") || {}).innerHTML ? document.getElementById("r23Picker").innerHTML.slice(0, 600) : "EMPTY" }));
  console.log("T3 图片选择器:", pick1.html.replace(/\s+/g, " ").slice(0, 500));

  /* 走相册文件选择 */
  const [chooser] = await Promise.all([
    p.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null),
    p.evaluate(() => { const inp = document.querySelector('#r23Picker input[type=file]'); if (inp) inp.click(); else { const b = document.querySelector('#r23Picker [data-album],[data-cam],[data-add]'); if (b) b.click(); } })
  ]);
  if (chooser) {
    await chooser.setFiles("E:/育人帮/temp/ppt-test/i1.png");
    await p.waitForTimeout(1500);
    const st3 = await p.evaluate(() => ({ n: YRB_CAPTURE.count(), val: YRB_CAPTURE.validate("img") }));
    console.log("T4 选图后:", JSON.stringify(st3));
  } else console.log("T4 没有弹出文件选择器（picker 里没有可点的上传入口）");

  /* 点发布，观察校验/上传提示 */
  const pubBtn = await p.evaluate(() => { const b = document.querySelector('#r23Pub,[data-pub],.r23-pub'); if (b) { b.click(); return b.textContent.trim(); } return null; });
  await p.waitForTimeout(2000);
  const after = await p.evaluate(() => ({ toast: (document.getElementById("toast") || {}).textContent || "", feed: document.querySelectorAll("#feed .card").length, cloudFlag: document.querySelectorAll("#feed .card.__cloud,#feed .card[data-cloud]").length }));
  console.log("T5 发布按钮:", pubBtn, "结果:", JSON.stringify(after));
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log("console:", logs.slice(0, 6).join(" || ") || "无");
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
