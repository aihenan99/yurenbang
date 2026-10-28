/* 诊断：点 + 打开发布面板 / 选图上传 的主线程卡顿 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
const IMGS = ["E:/育人帮/temp/admin_login_sheet.png", "E:/育人帮/temp/agree_block.png"];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push("[console] " + m.text()); });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const vis = await page.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null); });
  if (vis) { await page.click("#splash"); await page.waitForTimeout(700); }

  await page.evaluate(() => {
    try { if (window.YRB_CLOUD) { window.YRB_CLOUD.signedIn = () => true; window.YRB_CLOUD.name = () => "测试家长"; window.YRB_CLOUD.who = () => ({ id: "test-uid", name: "测试家长" }); } } catch (e) {}
    window.__lt = [];
    try {
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] });
    } catch (e) {}
    window.__marks = [];
    window.__mark = (n) => window.__marks.push([n, Math.round(performance.now())]);
  });

  const stat = async (label, fn) => {
    await page.evaluate(() => { window.__marks = []; window.__lt = []; });
    const t0 = Date.now();
    await fn();
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      lt: window.__lt.slice(), marks: window.__marks.slice(),
      nodes: document.querySelectorAll("*").length,
      posts: (typeof S !== "undefined" && S.posts) ? S.posts.length : -1,
      sheet: (() => { const s = document.querySelector("#publishSheet"); return s ? getComputedStyle(s).transform + "|" + getComputedStyle(s).visibility : "none"; })(),
      picker: (document.querySelector("#r23Picker") || {}).innerHTML ? document.querySelector("#r23Picker").innerHTML.length : 0
    }));
    console.log(`\n=== ${label} ===`);
    console.log("  wall(ms):", Date.now() - t0, "| DOM nodes:", r.nodes, "| posts:", r.posts);
    console.log("  longtasks:", JSON.stringify(r.lt), "| total:", r.lt.reduce((a, b) => a + b, 0));
    console.log("  marks:", JSON.stringify(r.marks));
    console.log("  picker html len:", r.picker, "| sheet:", r.sheet);
    return r;
  };

  await stat("A. 点击 + 打开发布面板", async () => {
    await page.click("#fab");
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__mark("fab-done"));
  });

  console.log("\n可见的发布面板元素:", await page.evaluate(() =>
    [...document.querySelectorAll("#publishSheet .seg-btn, #r23Picker *")].slice(0, 12).map(e => e.className || e.tagName)
  ));

  await stat("B. 点「图片」后再点「相册」label", async () => {
    await page.evaluate(() => document.querySelector("#pubTypes .seg-btn[data-t=\"img\"]").click());
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__mark("img-type"));
    const n = await page.locator('#r23Picker input[data-cap-in="album"]').count();
    console.log("  album inputs:", n);
  });

  await stat("C. 选择 2 张图片（压缩 + 渲染）", async () => {
    await page.setInputFiles('#r23Picker input[data-cap-in="album"]', IMGS);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__mark("files-done"));
  });

  const imgs = await page.evaluate(() => [...document.querySelectorAll("#r23Picker .cap-cell img")].length);
  console.log("\n已选图片数:", imgs);

  console.log("\nJS 错误:", errs.length ? errs.join("\n") : "无");
  await browser.close();
})();
