/* 探测 2：看 /yrbapi 与站点响应的真实来源，以及云端是否可用 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = [];
  page.on("response", r => {
    const u = r.url();
    if (/yrbapi|rpc|yb_posts/.test(u)) seen.push(r.status() + " " + u.slice(0, 120));
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(async () => {
    const C = window.YRB_CLOUD || {};
    const out = {
      html: document.documentElement.outerHTML.slice(0, 80),
      cloudKeys: Object.keys(C),
      enabled: (() => { try { return C.enabled && C.enabled(); } catch (e) { return "err:" + e.message; } })(),
      client: !!(C.client),
      endpointGuess: C.client && C.client.database && C.client.database.url ? String(C.client.database.url) : "n/a"
    };
    try {
      const r = await C.client.from("yb_posts").select("id,title").limit(2);
      out.postsRead = { error: r && r.error ? (r.error.message || JSON.stringify(r.error)) : null, n: r && r.data ? r.data.length : -1 };
    } catch (e) { out.postsRead = { thrown: e.message }; }
    return out;
  });

  /* 原始 HTTP 探测（页面上下文，带真实网络栈） */
  const raw = await page.evaluate(async () => {
    const grab = async (u) => {
      try { const r = await fetch(u, { method: "GET" }); return { u, status: r.status, server: r.headers.get("server"), proxy: r.headers.get("x-yrb-proxy"), ct: r.headers.get("content-type"), body: (await r.text()).slice(0, 120) }; }
      catch (e) { return { u, err: e.message }; }
    };
    return [await grab("/yrbapi/rest/v1/yb_posts?select=id&limit=1"), await grab("https://yurenbang.pages.dev/yrbapi/rest/v1/yb_posts?select=id&limit=1")];
  });

  console.log(JSON.stringify({ info, raw, seen }, null, 2));
  await browser.close();
})();
