/* 定位外部请求的发起者：用 CDP 的 Network.requestWillBeSent 拿 initiator 调用栈 */
const path = require("path");
const { chromium } = require(path.join(__dirname, "../../temp/pw/node_modules/playwright-core"));
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL = process.argv[2] || "http://118.89.185.37/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");

  const found = [];
  cdp.on("Network.requestWillBeSent", (e) => {
    const u = e.request.url;
    if (!u.startsWith(URL.replace(/\/$/, "")) && !u.startsWith("data:") && !u.startsWith("blob:")) {
      found.push({
        url: u.slice(0, 160),
        type: e.type,
        initiator: e.initiator,
        docUrl: e.documentURL,
      });
    }
  });

  await page.goto(URL, { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);

  console.log("== 站外请求 ==");
  if (!found.length) console.log("  无");
  for (const f of found) {
    console.log("\n  URL   ", f.url);
    console.log("  type  ", f.type);
    console.log("  init  ", JSON.stringify(f.initiator).slice(0, 500));
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
