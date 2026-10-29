/* 状态边界守卫 · 浏览器实测
   目的：确认 state.js 真的接管了 S 的写入，且没有破坏页面。
   运行前先起服务： python -m http.server 8796 --directory yurenbang-app */
const { chromium } = require("../helpers/pw.js").loadPlaywright();

const BASE = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";

(async () => {
  const browser = await chromium.launch({
    executablePath: require("../helpers/pw.js").chromePath(),
    headless: true
  });
  const page = await browser.newPage({
    viewport: { width: 412, height: 900 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block"
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  const warns = [];
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") warns.push(m.text().slice(0, 160));
  });

  let pass = 0, fail = 0;
  const T = (name, ok, extra) => {
    if (ok) { pass++; console.log("  ✓ " + name); }
    else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
  };

  await page.goto(BASE + "?stateaudit=1&t=" + Date.now(), { waitUntil: "domcontentloaded" });
  /* health.js 排最后加载，且要等前置层执行完——必须显式等它，不能用固定延时 */
  try {
    await page.waitForFunction(() => !!window.YRB_HEALTH, { timeout: 10000 });
  } catch (_) { /* 交给下面的断言报出来 */ }
  await page.waitForTimeout(300);

  /* 1. 页面本身没崩 */
  T("页面加载无 JS 异常", errors.length === 0, errors[0]);
  T("核心界面已渲染（#phone 存在）", await page.evaluate(() => !!document.querySelector("#phone")));

  /* 2. 守卫挂上了 */
  const basic = await page.evaluate(() => ({
    exists: !!window.YRB_STATE,
    enabled: !!(window.YRB_STATE && window.YRB_STATE.enabled),
    fieldCount: window.YRB_STATE && window.YRB_STATE.fields ? window.YRB_STATE.fields().length : 0,
    hasReport: !!(window.YRB_STATE && typeof window.YRB_STATE.report === "function")
  }));
  T("YRB_STATE 已挂载", basic.exists);
  T("守卫已启用（开发模式）", basic.enabled);
  T("契约字段已载入（≥25 个）", basic.fieldCount >= 25, "实际 " + basic.fieldCount);
  T("report() 可用", basic.hasReport);

  /* 3. 故意越界写：应被记录但不阻断 */
  const violation = await page.evaluate(() => {
    window.YRB_STATE.clear();
    const before = window.YRB_STATE.get("lang");
    S.lang = "en";                                   /* 来自页面脚本，不在契约白名单 */
    const after = window.YRB_STATE.get("lang");
    const list = window.YRB_STATE.report();
    return { before, after, count: list.length, first: list[0] || null };
  });
  T("越界写入不阻断业务（值已生效）", violation.after === "en", JSON.stringify(violation));
  T("越界写入被记录", violation.count >= 1, "记录 " + violation.count + " 条");
  T("记录里有字段名", violation.first && violation.first["字段"] === "lang", JSON.stringify(violation.first));

  /* 4. 合法写入：不产生新违规 */
  const legal = await page.evaluate(() => {
    window.YRB_STATE.clear();
    const ok = window.YRB_STATE.set("lang", "zh", "app");
    return { ok, count: window.YRB_STATE.report().length, value: window.YRB_STATE.get("lang") };
  });
  T("YRB_STATE.set 写入成功", legal.ok && legal.value === "zh", JSON.stringify(legal));
  T("合法写入不报违规", legal.count === 0, "记录 " + legal.count + " 条");

  /* 5. 类型校验：给数字字段写字符串 */
  const typeCheck = await page.evaluate(() => {
    window.YRB_STATE.clear();
    S.published = "不是数字";
    return window.YRB_STATE.report().map((r) => r["类型"]);
  });
  T("类型不符会被记录", typeCheck.includes("type"), JSON.stringify(typeCheck));

  /* 6. M5 回归：晚建字段（reward 层启动后才挂到 S 上的 points/rank）必须被接管，
        未登记字段能被点名，_bypass 私有化后外部改不到、绕不过检查 */
  await page.waitForTimeout(1200);            /* 等 load 后的延迟重装跑过 */
  const late = await page.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(S, "points");
    return { exists: "points" in S, hasGetter: !!(d && d.get), controlled: !!d && !!d.set };
  });
  T("晚建字段 points 已被接管（有访问器）", !late.exists || (late.hasGetter && late.controlled), JSON.stringify(late));

  const unknown = await page.evaluate(() => {
    window.YRB_STATE.clear();
    S.__probeUnknown = 1;
    const list = window.YRB_STATE.scan();
    try { delete S.__probeUnknown; } catch (_) {}
    return list.some((r) => r["字段"] === "__probeUnknown" && r["类型"] === "unknown");
  });
  T("未登记字段会被点名（unknown）", unknown);

  const bypass = await page.evaluate(() => {
    window.YRB_STATE.clear();
    try { window.YRB_STATE._bypass = { field: "lang" }; } catch (_) {}
    S.lang = "en";
    const n = window.YRB_STATE.report().length;
    S.lang = "zh";
    return n;
  });
  T("_bypass 私有化：外部设了也绕不过检查", bypass >= 1, "记录 " + bypass + " 条");

  /* 7. 免疫系统认得这一层 */
  const health = await page.evaluate(() => {
    if (!window.YRB_HEALTH) return { ok: false, why: "YRB_HEALTH 未加载" };
    const r = window.YRB_HEALTH.sweep ? window.YRB_HEALTH.sweep("test") : null;
    return { ok: true, result: r ? "sweep 已执行" : "sweep 无返回（可能是异步）" };
  });
  T("health 免疫系统可用", health.ok, health.why);

  /* 8. 重置页面状态，避免影响后续手动检查 */
  await page.evaluate(() => { try { S.lang = "zh"; } catch (_) {} });

  console.log("\n---- 状态守卫实测：" + pass + " 通过 / " + fail + " 失败 ----");
  if (fail) {
    console.log("页面报错：", errors.slice(0, 3));
    console.log("控制台告警：", warns.slice(0, 5));
  }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("崩溃：", e); process.exit(2); });
