const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  await p.goto("https://xn--gmqq09al6z.cn/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(()=>{});
  await p.waitForTimeout(8000);
  await p.screenshot({ path: "temp/工单附件-站点维护状态.png" });
  const txt = await p.evaluate(() => (document.querySelector("#feed")||document.body).innerText.replace(/\s+/g," ").slice(0,120));
  console.log("截图完成 | 页面文字:", txt);
  await b.close();
})();
