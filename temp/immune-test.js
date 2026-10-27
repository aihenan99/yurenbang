/* 免疫系统 / 平稳升级 —— 故障场景回归
   跑法：node temp/immune-test.js   （需先起 http.server 8794 --directory deploy-cn） */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:8794/";
const pass = [], fail = [];
function ok(c, m) { (c ? pass : fail).push(m); console.log((c ? "  ✓ " : "  ✗ ") + m); }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });

  /* ---------- S1 正常加载：全部层健康、无报错 ---------- */
  console.log("S1 正常加载");
  {
    const p = await browser.newPage({ viewport: { width: 412, height: 900 } });
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(3000);
    const r = await p.evaluate(() => ({
      healthy: window.YRB_HEALTH ? window.YRB_HEALTH.status().healthy : null,
      ok: window.YRB_HEALTH ? window.YRB_HEALTH.status().ok : 0,
      total: window.YRB_HEALTH ? window.YRB_HEALTH.status().total : 0,
      bad: window.YRB_HEALTH ? window.YRB_HEALTH.status().bad : ["无免疫系统"],
      build: (window.YRB_UPGRADE || {}).build,
      pkg: (window.YRB_UPGRADE || {}).pkgBuild,
      mixed: document.documentElement.dataset.yrbMixed || "",
      chips: [...document.querySelectorAll("#funcrow .f-chip")].length
    }));
    ok(r.healthy === true, `全部 ${r.total} 层健康（实际 ${r.ok}/${r.total}，异常：${r.bad.join(",") || "无"}）`);
    ok(!!r.build && r.build === r.pkg, `构建号一致：页面 ${r.build} / 资源包 ${r.pkg}`);
    ok(!r.mixed, "未触发新旧混载纠正");
    ok(r.chips >= 2, `首页栏目正常渲染（${r.chips} 个）`);
    ok(errs.length === 0, `无页面报错${errs.length ? "：" + errs[0] : ""}`);
    await p.close();
  }

  /* ---------- S2 整包失败：bundle.js 被阻断，看能否自动长回来 ---------- */
  console.log("S2 整包失败自愈（阻断 bundle.js）");
  {
    const p = await browser.newPage({ viewport: { width: 412, height: 900 } });
    const errs = [], healed = [];
    p.on("pageerror", e => errs.push(e.message));
    p.on("request", q => { if (q.url().includes("heal=")) healed.push(q.url().split("/").pop().split("?")[0]); });
    await p.route("**/assets/bundle.js*", r => r.abort());
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(14000);   /* 内联兜底 1.5s + 串行补载 */
    const r = await p.evaluate(() => {
      const s = window.YRB_HEALTH ? window.YRB_HEALTH.status() : null;
      return {
        hasHealth: !!window.YRB_HEALTH,
        healthy: s ? s.healthy : false,
        ok: s ? s.ok : 0, total: s ? s.total : 0,
        bad: s ? s.bad : ["无免疫系统"],
        chips: [...document.querySelectorAll("#funcrow .f-chip")].length,
        yrbApp: !!window.YRB_APP,
        yrbCloud: !!window.YRB_CLOUD,
        yrbFood: !!window.YRB_FOOD,
        yrbJJ: !!window.YRB_JJ
      };
    });
    ok(r.hasHealth, "免疫系统在整包失败后仍被内联兜底拉起");
    ok(r.healthy, `补载后全部层恢复（${r.ok}/${r.total}，异常：${r.bad.join(",") || "无"}）`);
    ok(r.yrbApp && r.yrbCloud && r.yrbFood && r.yrbJJ, "关键层已恢复（应用/云/美食/家教）");
    ok(r.chips >= 2, `补载后首页栏目正常（${r.chips} 个）`);
    ok(new Set(healed).size >= 5, `确实发起了逐文件补载（${[...new Set(healed)].length} 个文件）`);
    console.log("     补载文件：" + [...new Set(healed)].slice(0, 20).join(", "));
    await p.close();
  }

  /* ---------- S3 运行时被覆盖：只重建 DOM，不重拉脚本 ---------- */
  console.log("S3 骨架被清空 → 原地重建（不重载脚本）");
  {
    const p = await browser.newPage({ viewport: { width: 412, height: 900 } });
    const reloads = [];
    p.on("request", q => { if (q.url().includes("heal=")) reloads.push(q.url().split("/").pop()); });
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(3200);
    await p.evaluate(() => {
      document.getElementById("funcrow").innerHTML = "";
      document.getElementById("feed").innerHTML = "";
    });
    await p.evaluate(() => window.YRB_HEALTH.sweep("测试：骨架清空"));
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({
      chips: [...document.querySelectorAll("#funcrow .f-chip")].length,
      feed: document.getElementById("feed").children.length,
      degraded: window.YRB_HEALTH.status().degraded
    }));
    ok(r.chips >= 2, `栏目被自动重建（${r.chips} 个）`);
    ok(r.feed > 0, `信息流被自动重建（${r.feed} 条）`);
    ok(reloads.filter(x => /app\.js/.test(x)).length === 0, "未重复拉取 app.js（避免二次初始化）");
    await p.close();
  }

  /* ---------- S4 单层标记丢失 → 只补该层 ---------- */
  console.log("S4 单层丢失 → 精准补载");
  {
    const p = await browser.newPage({ viewport: { width: 412, height: 900 } });
    const healed = [];
    p.on("request", q => { if (q.url().includes("heal=")) healed.push(q.url().split("/").pop().split("?")[0]); });
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(3000);
    await p.evaluate(() => { try { delete window.YRB_LICENSE; } catch (e) { window.YRB_LICENSE = undefined; } });
    await p.evaluate(() => window.YRB_HEALTH.sweep("测试：单层丢失"));
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => ({
      back: !!window.YRB_LICENSE,
      healthy: window.YRB_HEALTH.status().healthy
    }));
    ok(r.back, "license 层已自动补回");
    ok(r.healthy, "其余层不受影响，整体恢复健康");
    ok(healed.filter(x => /license\.js/.test(x)).length >= 1, "只补载了缺失的 license.js");
    console.log("     补载：" + [...new Set(healed)].join(", "));
    await p.close();
  }

  /* ---------- S5 新版本提示：探测到更高构建号 → 底部温和提示，不刷新 ---------- */
  console.log("S5 新版本温和提示");
  {
    /* 注意：页面注册了 SW，会接管 /build.json 请求导致 page.route 拦不到。
       这里显式阻断 SW，隔离测升级层自身的探测与提示逻辑。 */
    const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.route("**/build.json*", r => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ build: "209912312359", at: "2099-12-31 23:59:59" })
    }));
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(6000);   /* 4s 后探测 */
    const r = await p.evaluate(() => {
      const c = document.getElementById("yrbUpg");
      return {
        shown: !!(c && c.classList.contains("show")),
        text: c ? c.innerText.replace(/\s+/g, " ").trim() : "",
        pending: (window.YRB_UPGRADE || {}).pending,
        stillHere: !!document.getElementById("phone")
      };
    });
    ok(r.shown, "底部出现「有新版本」提示卡（pending=" + r.pending + "）");
    ok(/立即更新/.test(r.text) && /稍后/.test(r.text), "提供「立即更新 / 稍后」两个选择");
    ok(r.stillHere, "未强制刷新页面（内容仍在）");
    ok(errs.length === 0, `无页面报错${errs.length ? "：" + errs[0] : ""}`);
    await ctx.close();
  }

  /* ---------- S6 正在输入时不打扰 ---------- */
  console.log("S6 输入中不弹升级提示");
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
    const p = await ctx.newPage();
    await p.route("**/build.json*", r => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ build: "209912312359" })
    }));
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(2500);
    /* 造一个聚焦的输入框，模拟用户正在填表 */
    await p.evaluate(() => {
      const i = document.createElement("input");
      i.id = "fakeInput"; document.body.appendChild(i); i.focus();
    });
    await p.waitForTimeout(5000);
    const r = await p.evaluate(() => {
      const c = document.getElementById("yrbUpg");
      return { shown: !!(c && c.classList.contains("show")), pending: (window.YRB_UPGRADE || {}).pending };
    });
    ok(!!r.pending && !r.shown, "已探测到新版本，但用户正在输入 → 暂不打扰（pending=" + r.pending + "）");
    await ctx.close();
  }

  await browser.close();
  console.log("\n结果：" + pass.length + " 过 / " + fail.length + " 败");
  if (fail.length) { fail.forEach(f => console.log("  失败：" + f)); process.exit(1); }
})();
