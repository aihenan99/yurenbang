/* 微信安卓 UA 下采集面板的目视截图（视频 / 语音 各一张） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const path = require("path");
const UA = "Mozilla/5.0 (Linux; Android 13; V2118A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.44.2502(0x28002C35) WeChat/arm64";
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", userAgent: UA });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/index.html?cshot=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(() => { try { openSheet("publishSheet"); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.click('#pubTypes .seg-btn[data-t="video"]').catch(() => {});
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(__dirname, "shot-camera-wx-video.png") });
  await p.click('#pubTypes .seg-btn[data-t="voice"]').catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(__dirname, "shot-camera-wx-voice.png") });
  console.log("saved shot-camera-wx-video.png / shot-camera-wx-voice.png");
  await b.close();
})();
