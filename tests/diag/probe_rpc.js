/* 探测：RPC admin_set_setting 是否在后端可发现（匿名调用应返回 42501 而非 404） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async () => {
    const res = {};
    const call = async (name, body, method = "POST") => {
      const r = await fetch("/yrbapi/rest/v1/rpc/" + name, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify(body) : undefined
      });
      const t = await r.text();
      return { status: r.status, body: t.slice(0, 300) };
    };
    res.setSetting = await call("admin_set_setting", { p_key: "__probe", p_value: "1" });
    res.isAdmin = await call("is_admin", {});
    /* 顺带看表是否可读 */
    const r = await fetch("/yrbapi/rest/v1/yb_settings?select=key&limit=3");
    res.settings = { status: r.status, body: (await r.text()).slice(0, 300) };
    /* 云端配置（cloud.js 用的 endpoint） */
    res.endpoint = (window.YRB_CLOUD && YRB_CLOUD.endpoint) || (window.YRB_CLOUD && YRB_CLOUD.url) || "n/a";
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
