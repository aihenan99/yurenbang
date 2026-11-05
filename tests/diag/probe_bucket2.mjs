/* 一次性探针 2：抓 storage 请求 URL，从路径里读出 bucket 名。
   匿名签名会被 RLS 拒，但请求已经发出去了 —— 抓 request 即可。 */
import { chromium } from "../../temp/pw/node_modules/playwright-core/index.mjs";

const URL = process.env.YRB_URL || "http://127.0.0.1:8793/deploy-cn/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  args: ["--no-proxy-server"]
});
const page = await browser.newPage();
const hits = [];
page.on("request", r => { const u = r.url(); if (/\/storage\/v1\//.test(u)) hits.push(r.method() + " " + u.replace(/\?.*/, "")); });
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.YRB_CLOUD && window.YRB_CLOUD.client, null, { timeout: 25000 }).catch(() => {});

const src = await page.evaluate(() => {
  const s = window.YRB_CLOUD && window.YRB_CLOUD.client && window.YRB_CLOUD.client.storage;
  return s ? String(s.createSignedUrls || s.upload || "") : "";
});

const res = await page.evaluate(async () => {
  const s = window.YRB_CLOUD.client.storage;
  try {
    const r = await s.createSignedUrls(["shared/b03d061f-c975-4a3a-9e83-b957a36a7a4a/img/1793622441340-0-zalncw.jpg"], 600);
    return JSON.stringify(r).slice(0, 300);
  } catch (e) { return "ERR " + (e && e.message); }
});
console.log("call:", res);
console.log("requests:", hits.slice(0, 5).join("\n"));
console.log("src:", src.slice(0, 300));
await browser.close();
