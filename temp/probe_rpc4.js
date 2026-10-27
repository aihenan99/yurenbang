/* 探测 4：走 SDK 的 rpc（带正确鉴权头），看函数是否可发现 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(async () => {
    const D = window.YRB_CLOUD.client.database;
    const res = {};
    const safe = async (k, fn) => { try { const r = await fn(); res[k] = r && r.error ? { error: (r.error.message || JSON.stringify(r.error)).slice(0, 240), status: r.status } : { ok: true, data: r && r.data }; } catch (e) { res[k] = { thrown: e.message }; } };
    await safe("setSetting", () => D.rpc("admin_set_setting", { p_key: "__probe", p_value: "1" }));
    await safe("isAdmin", () => D.rpc("is_admin", {}));
    await safe("ghost", () => D.rpc("no_such_fn_xyz", {}));
    await safe("readSettings", () => D.from("yb_settings").select("key,length(value)").limit(5));
    await safe("readPosts", () => D.from("yb_posts").select("id,title").limit(2));
    res.signedIn = (() => { try { return window.YRB_CLOUD.signedIn(); } catch (e) { return "err"; } })();
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
