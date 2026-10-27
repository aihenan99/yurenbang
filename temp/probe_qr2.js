/* 探测 5：匿名能否读到 yb_settings 的 jiaojiao_qr */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const out = await page.evaluate(async () => {
    const D = window.YRB_CLOUD.client.database;
    const res = {};
    try {
      const r = await D.from("yb_settings").select("key,value").eq("key", "jiaojiao_qr");
      res.plain = { error: r.error ? (r.error.message || JSON.stringify(r.error)) : null, n: r.data ? r.data.length : -1, first: r.data && r.data[0] ? String(r.data[0].value).slice(0, 50) : null };
    } catch (e) { res.plain = { thrown: e.message }; }
    try {
      const r = await D.from("yb_settings").select("key,value").eq("key", "jiaojiao_qr").maybeSingle();
      res.maybe = { error: r.error ? (r.error.message || JSON.stringify(r.error)) : null, data: r.data ? String(r.data.value).slice(0, 50) : null, status: r.status };
    } catch (e) { res.maybe = { thrown: e.message }; }
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
