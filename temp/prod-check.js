/* 生产环境发布自检（发布守卫的执行体）
   跑法：node temp/prod-check.js [--json]
   退出码：0 = 线上健康；1 = 有问题（供 release.py 决定是否回滚）
   检查的是"用户视角能不能用"，不是"文件在不在"。 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const SITE = "https://xn--gmqq09al6z.cn/";

(async () => {
  const out = { ok: false, at: new Date().toISOString(), checks: [], build: "", errors: [] };
  function ck(name, cond, detail) {
    out.checks.push({ name, ok: !!cond, detail: detail || "" });
    if (!cond) { out.ok = false; }
  }
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 880 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));

    const resp = await p.goto(SITE + "?probe=" + Date.now(), { waitUntil: "load", timeout: 45000 });
    ck("首页可访问", resp && resp.status() === 200, "HTTP " + (resp ? resp.status() : "无响应"));

    /* 等免疫系统跑完首检 */
    await p.waitForTimeout(4200);

    const r = await p.evaluate(() => {
      const H = window.YRB_HEALTH, U = window.YRB_UPGRADE;
      const s = H ? H.status() : null;
      return {
        hasHealth: !!H, hasUpgrade: !!U,
        healthy: s ? s.healthy : false,
        okLayers: s ? s.ok : 0, total: s ? s.total : 0,
        bad: s ? s.bad : ["无免疫系统"],
        build: (U && U.build) || document.querySelector('meta[name="yrb-build"]')?.content || "",
        pkg: (U && U.pkgBuild) || "",
        mixed: document.documentElement.dataset.yrbMixed || "",
        chips: [...document.querySelectorAll("#funcrow .f-chip")].map(e => e.textContent.trim()),
        hasPhone: !!document.getElementById("phone"),
        hasTabbar: !!document.getElementById("tabbar"),
        hasFab: !!document.getElementById("fab"),
        hasJiajiao: !!document.querySelector(".jj-chip, [data-act='jiaojiao'], .f-chip[data-f='jiaojiao']"),
        bodyLen: (document.body.innerText || "").length
      };
    });

    ck("免疫系统在线", r.hasHealth);
    ck("平稳升级层在线", r.hasUpgrade);
    ck(
      "全部功能层健康",
      r.healthy,
      r.okLayers + "/" + r.total + (r.bad.length ? "，异常：" + r.bad.join(",") : "")
    );
    ck("构建号一致", !!r.build && r.build === r.pkg, "页面 " + r.build + " / 资源包 " + r.pkg);
    ck("无新旧混载", !r.mixed);
    ck("应用骨架在位", r.hasPhone && r.hasTabbar && r.hasFab);
    ck("首页栏目正常", r.chips.length >= 2, r.chips.join(" / "));
    ck("家教入口在位", r.hasJiajiao || r.chips.some(x => x.indexOf("家教") >= 0), r.chips.join(" / "));
    ck("页面有内容", r.bodyLen > 200, r.bodyLen + " 字符");
    ck("无脚本错误", errs.length === 0, errs.slice(0, 2).join(" | "));

    /* build.json 与页面构建号一致（决定"能不能平稳升级到它"） */
    const bj = await p.evaluate(async () => {
      try {
        const x = await fetch("/build.json?t=" + Date.now(), { cache: "no-store" });
        return x.ok ? await x.json() : null;
      } catch (e) { return null; }
    });
    ck("build.json 可读", !!bj && !!bj.build, bj ? bj.build : "读取失败");
    if (bj && bj.build && r.build) {
      ck("线上构建号与页面一致", bj.build === r.build, "build.json " + bj.build + " / 页面 " + r.build);
      out.build = bj.build;
    }
    out.errors = errs;
    out.ok = out.checks.every(x => x.ok);
    await ctx.close();
  } catch (e) {
    out.ok = false;
    out.checks.push({ name: "自检执行", ok: false, detail: String(e.message).slice(0, 200) });
  } finally {
    if (browser) { await browser.close().catch(() => {}); }
  }

  const json = process.argv.indexOf("--json") >= 0;
  if (json) {
    console.log(JSON.stringify(out));
  } else {
    console.log("生产自检 " + (out.ok ? "通过 ✅" : "失败 ❌") + "  构建号 " + (out.build || "未知"));
    out.checks.forEach(c => console.log("  " + (c.ok ? "✓" : "✗") + " " + c.name + (c.detail ? "（" + c.detail + "）" : "")));
  }
  process.exit(out.ok ? 0 : 1);
})();
