/* 匿名态签名请求次数体检（2026-11-05）
   目的：signPaths 不再要求登录后，若存储未放开，不能变成「每张图发一次失败请求」。
   预期：一次批量请求失败即进入 5 分钟冷却，全程 sign 请求 <= 2（批量 + 至多一次重试）。
   用法：先起 8793（项目根），node tests/diag/guest_sign_once.mjs */
import { chromium } from "../../temp/pw/node_modules/playwright-core/index.mjs";

const URL = process.env.YRB_URL || "http://127.0.0.1:8793/deploy-cn/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  args: ["--no-proxy-server"]
});
const page = await browser.newPage();
const hits = [];
page.on("request", r => { if (/\/storage\/v1\/object\/sign/.test(r.url())) hits.push(r.url()); });
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);
console.log("sign 请求次数:", hits.length);
console.log(hits.slice(0, 4).join("\n"));
await browser.close();
process.exit(hits.length <= 2 ? 0 : 1);
