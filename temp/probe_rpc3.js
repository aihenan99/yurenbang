/* 探测 3：用 SDK 真实基址调 RPC，看是「函数不存在(404)」还是「无权限(42501)」 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);

  const out = await page.evaluate(async () => {
    const base = window.YRB_CLOUD.client.database.url;
    const post = async (fn, body) => {
      const r = await fetch(base + "/rpc/" + fn, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.text()).slice(0, 400) };
    };
    const out = { base };
    out.setSettingAnon = await post("admin_set_setting", { p_key: "__probe", p_value: "1" });
    out.isAdminAnon = await post("is_admin", {});
    out.nonExist = await post("definitely_not_a_function", {});
    /* 读表（anon 可读） */
    const r = await fetch(base + "/yb_settings?select=key&limit=3");
    out.settings = { status: r.status, body: (await r.text()).slice(0, 200) };
    /* 当前登录态 */
    try { const w = window.YRB_CLOUD.who && window.YRB_CLOUD.who(); out.who = w ? { id: w.id, phone: w.phone } : null; } catch (e) { out.who = "err"; }
    out.signedIn = (() => { try { return window.YRB_CLOUD.signedIn(); } catch (e) { return "err"; } })();
    return out;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
