/* 压力测试：一次选 9 张 4032×3024 大图（模拟手机原图），量化压缩阻塞 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:8791/yurenbang-app.html";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on("pageerror", e => console.log("PAGEERR", String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  if (await page.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null); })) {
    await page.click("#splash"); await page.waitForTimeout(700);
  }
  await page.evaluate(() => { try { window.YRB_CLOUD.signedIn = () => true; } catch (e) {} });
  await page.evaluate(() => document.querySelector("#fab").click());
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#pubTypes .seg-btn[data-t="img"]').click());
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__lt = [];
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] }); } catch (e) {}
  });

  const t0 = Date.now();
  const ready = page.evaluate(() => new Promise(res => {
    const inp = document.querySelector('#r23Picker input[data-cap-in="album"]');
    const mk = (i) => new Promise(r => {
      const c = document.createElement("canvas"); c.width = 4032; c.height = 3024;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 4032, 3024);
      g.addColorStop(0, `hsl(${i * 40},70%,60%)`); g.addColorStop(1, `hsl(${i * 40 + 120},70%,35%)`);
      x.fillStyle = g; x.fillRect(0, 0, 4032, 3024);
      for (let k = 0; k < 3000; k++) { x.fillStyle = `rgba(255,255,255,${Math.random()})`; x.fillRect(Math.random() * 4032, Math.random() * 3024, 6, 6); }
      c.toBlob(b => r(new File([b], "big" + i + ".jpg", { type: "image/jpeg" })), "image/jpeg", 0.95);
    });
    (async () => {
      const fs = []; for (let i = 0; i < 9; i++) fs.push(await mk(i));
      const dt = new DataTransfer(); fs.forEach(f => dt.items.add(f));
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      res({ files: fs.length, bytes: fs.reduce((a, f) => a + f.size, 0) });
    })();
  }));
  const info = await ready;
  console.log("投喂文件:", info, "生成+派发耗时", Date.now() - t0, "ms");

  /* 等图片出现在 DOM（说明压缩 + 渲染完成） */
  let waited = 0, cnt = 0;
  while (waited < 60000) {
    cnt = await page.evaluate(() => document.querySelectorAll("#r23Picker .cap-cell").length);
    if (cnt >= 9) break;
    await page.waitForTimeout(200); waited += 200;
  }
  const lt = await page.evaluate(() => window.__lt.slice());
  console.log("9 张全部就绪耗时:", Date.now() - t0, "ms | DOM 已有", cnt, "张");
  console.log("longtasks:", JSON.stringify(lt));
  console.log("longtask 总时长:", lt.reduce((a, b) => a + b, 0), "ms | 最长:", Math.max(0, ...lt));
  await browser.close();
})();
