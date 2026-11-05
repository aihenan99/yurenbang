/* 一次性探针：读 SDK 内部 storage 客户端绑定的 bucketId。
   为什么需要它：匿名看图要放开 storage.objects 的 RLS，policy 里必须写 bucket_id，
   而桶名只存在于 SDK 内部（前端从不显式传），外部接口一律返回「Bucket not found」。 */
import { chromium } from "../../temp/pw/node_modules/playwright-core/index.mjs";

const URL = process.env.YRB_URL || "http://127.0.0.1:8793/deploy-cn/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  args: ["--no-proxy-server"]
});
const page = await browser.newPage();
page.on("console", m => { const t = m.text(); if (/bucket|storage/i.test(t)) console.log("[console]", t.slice(0, 200)); });
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// 等云端 SDK 就绪（最多 25 秒）
await page.waitForFunction(() => window.YRB_CLOUD && window.YRB_CLOUD.client, null, { timeout: 25000 }).catch(() => {});

const out = await page.evaluate(() => {
  const c = window.YRB_CLOUD && window.YRB_CLOUD.client;
  if (!c) return { err: "no client" };
  const s = c.storage || {};
  const keys = Object.keys(s);
  const fileApi = s.fileApi || null;
  const deep = {};
  for (const k of keys) {
    const v = s[k];
    if (v && typeof v === "object") deep[k] = Object.keys(v).slice(0, 12);
  }
  return {
    keys, deep,
    fileApiBucket: fileApi && (fileApi.bucketId || fileApi.bucket),
    // 有的实现把 bucket 放在闭包里，但 from() 会构造新对象
    fromShared: (() => {
      try {
        const f = s.from && s.from("__probe__");
        return f && f.fileApi ? f.fileApi.bucketId : (f && f.bucketId) || null;
      } catch (e) { return "err:" + e.message; }
    })()
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
