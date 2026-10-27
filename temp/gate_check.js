/* 育人帮 · 访问门槛（浏览免费 / 发布与帮忙需登录）验证
   思路：把 window.YRB_CLOUD 换成可控桩，这样能精确控制"未登录 / 已登录"，
        并观察 ensureLogin 是否被调用、登录成功后原动作是否被重放。
        gate.js 是运行时读取 YRB_CLOUD，所以替换桩即可生效。 */
const { chromium } = require("playwright-core");

const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra === undefined ? "" : String(extra) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "   [" + extra + "]" : ""}`);
}

const STUB = () => {
  window.__gate = { ensureLogin: 0, openLogin: 0, resolved: null };
  window.YRB_CLOUD = {
    enabled: () => true,
    signedIn: () => !!window.__gate.signed,
    name: () => "测试家长",
    who: () => ({ id: "test", phone: "18000000000", name: "测试家长" }),
    openLogin: () => { window.__gate.openLogin++; },
    ensureLogin: () => {
      window.__gate.ensureLogin++;
      return new Promise((res) => { window.__gate.resolved = res; });
    },
    signOut: () => {},
    publishPost: async () => ({ ok: true }),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  /* 应用有启动屏，等首页卡片真正渲染出来再开始 */
  await page.waitForSelector("#feed .card", { timeout: 20000 });
  await page.waitForTimeout(500);

  // 注入可控云服务桩（未登录）
  await page.evaluate(STUB);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("yrb-auth", { detail: { signedIn: false } })));
  await page.waitForTimeout(200);

  console.log("=== A. 浏览：不登录也能看 ===");
  const cards = await page.$$eval("#feed .card", (a) => a.length);
  check("首页能直接看到求助卡片（未登录）", cards > 0, `卡片数=${cards}`);
  const fabVisible = await page.$eval("#fab", (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  check("＋发布按钮可见", fabVisible);

  // 打开帮忙面板（阅读）
  await page.evaluate(() => {
    /* 选一条「确实有帮忙」的卡片（云端会不断新增 0 帮忙的帖，固定选第一张会误判） */
    const all = [...document.querySelectorAll('#feed .card [data-act="cm"]')];
    const t = all.find(el => { const m = (el.textContent || "").match(/(\d+)/); return m && +m[1] > 0; }) || document.querySelector('#feed .pa-help');
    if (t) t.click();
  });
  await page.waitForTimeout(500);
  const sheetOpen = await page.$eval("#commentSheet", (e) => e.classList.contains("open"));
  check("未登录也能打开帮忙面板（面板可开，留言锁住）", sheetOpen);

  const lock = await page.evaluate(() => {
    const l = document.querySelector("#cmList");
    const box = document.getElementById("cmLock");
    return {
      locked: !!l && l.classList.contains("cm-locked"),
      exists: !!box,
      text: box ? box.textContent.replace(/\s+/g, " ").trim() : "",
      items: l ? l.querySelectorAll(".cm-item").length : 0,
      hidden: (function () { const it = l && l.querySelector(".cm-item"); return it ? getComputedStyle(it).display === "none" : null; })(),
    };
  });
  check("未登录时帮忙留言被锁住", lock.locked);
  check("出现锁面板（不是空白）", lock.exists, lock.text);
  check("锁面板文案带条数（≥1）", Number((lock.text.match(/查看 (\d+) 条/) || [])[1]) >= 1, lock.text);
  check("★ 未登录看不到留言内容（云端拿不到数据 / 本地演示数据已隐藏）",
    lock.items === 0 || lock.hidden === true, `DOM 条数=${lock.items} 隐藏=${lock.hidden}`);
  const gateBarShown = await page.$eval("#cmGate", (e) => e.classList.contains("show")).catch(() => false);
  check("已锁住时不再重复出现第二个登录按钮", !gateBarShown);
  const inputBg = await page.$eval("#cmInput", (e) => getComputedStyle(e).backgroundColor);
  check("未登录时输入框有视觉暗示（未禁用输入）", inputBg !== "rgba(0, 0, 0, 0)" && inputBg !== "", inputBg);

  console.log("\n=== B. 帮忙回应：必须先登录 ===");
  const before = await page.$$eval("#cmList .cm-item", (a) => a.length);
  await page.fill("#cmInput", "我遇到过同样的事，可以帮你看看");
  await page.$eval("#cmSend", (e) => e.click());
  await page.waitForTimeout(400);
  const g1 = await page.evaluate(() => ({ n: window.__gate.ensureLogin, text: (document.querySelector("#cmInput") || {}).value }));
  check("未登录点「发送」→ 弹出登录（ensureLogin 被调用）", g1.n === 1, `调用次数=${g1.n}`);
  const after = await page.$$eval("#cmList .cm-item", (a) => a.length);
  check("未登录时帮忙没有被发出", after === before, `前=${before} 后=${after}`);
  check("已输入的内容被保留（不会因弹登录而丢字）", g1.text === "我遇到过同样的事，可以帮你看看", JSON.stringify(g1.text).slice(0, 40));

  // 登录成功 → 原动作应被重放
  await page.evaluate(() => { window.__gate.signed = true; window.__gate.resolved && window.__gate.resolved(true); });
  await page.waitForTimeout(600);
  const after2 = await page.$$eval("#cmList .cm-item", (a) => a.length);
  check("登录成功后自动把刚才的帮忙发出去", after2 > before, `前=${before} 后=${after2}`);
  const barAfterLogin = await page.$eval("#cmGate", (e) => e.classList.contains("show")).catch(() => false);
  check("登录后提示条自动收起", !barAfterLogin);

  console.log("\n=== C. 取消登录：不发、不丢内容 ===");
  await page.evaluate(() => {
    window.__gate.signed = false;
    window.dispatchEvent(new CustomEvent("yrb-auth", { detail: { signedIn: false } }));
  });
  await page.waitForTimeout(300);
  await page.fill("#cmInput", "第二条草稿");
  await page.$eval("#cmSend", (e) => e.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__gate.resolved && window.__gate.resolved(false); }); // 用户关闭登录
  await page.waitForTimeout(400);
  const stillThere = await page.$eval("#cmInput", (e) => e.value);
  check("取消登录后草稿仍在输入框", stillThere === "第二条草稿", JSON.stringify(stillThere).slice(0, 30));

  console.log("\n=== D. 语音 / 视频帮忙：必须先登录 ===");
  for (const id of ["#cmVoice", "#cmVideo"]) {
    await page.evaluate(() => { window.__gate.ensureLogin = 0; });
    await page.$eval(id, (e) => e.click());
    await page.waitForTimeout(250);
    const n = await page.evaluate(() => window.__gate.ensureLogin);
    check(`未登录点 ${id} → 弹出登录`, n === 1, `调用次数=${n}`);
    await page.evaluate(() => { window.__gate.resolved && window.__gate.resolved(false); });
    await page.waitForTimeout(200);
  }

  console.log("\n=== E. 发布求助：必须先登录 ===");
  await page.evaluate(() => {
    document.querySelectorAll(".sheet.open").forEach((s) => s.classList.remove("open"));
    window.__gate.ensureLogin = 0;
  });
  await page.waitForTimeout(200);
  await page.click("#fab");
  await page.waitForTimeout(400);
  const g2 = await page.evaluate(() => ({
    n: window.__gate.ensureLogin,
    pub: document.querySelector("#publishSheet").classList.contains("open"),
  }));
  check("未登录点「＋」→ 弹出登录", g2.n === 1, `调用次数=${g2.n}`);
  check("未登录时发布面板不会打开", !g2.pub);

  // 登录成功 → 自动进入发布面板
  await page.evaluate(() => { window.__gate.signed = true; window.__gate.resolved && window.__gate.resolved(true); });
  await page.waitForTimeout(600);
  const pubOpen = await page.$eval("#publishSheet", (e) => e.classList.contains("open"));
  check("登录成功后自动进入发布面板", pubOpen);

  const pickHint = await page.$("#r23Picker");
  check("发布面板素材区正常渲染（无异常）", !!pickHint);

  console.log("\n=== F. 已登录用户：不受任何拦截 ===");
  await page.evaluate(() => { window.__gate.ensureLogin = 0; });
  await page.evaluate(() => {
    document.querySelectorAll(".sheet.open").forEach((s) => s.classList.remove("open"));
  });
  await page.waitForTimeout(200);
  await page.click("#fab");
  await page.waitForTimeout(400);
  const n2 = await page.evaluate(() => window.__gate.ensureLogin);
  const pubOpen2 = await page.$eval("#publishSheet", (e) => e.classList.contains("open"));
  check("已登录点「＋」不再弹登录", n2 === 0, `调用次数=${n2}`);
  check("已登录点「＋」直接打开发布面板", pubOpen2);

  console.log("\n=== G. 无 JS 报错 ===");
  check("页面无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));

  await browser.close();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果 ${pass}/${results.length} 通过 =====`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("未通过：");
    failed.forEach((f) => console.log("  - " + f.name + (f.extra ? "  [" + f.extra + "]" : "")));
    process.exit(1);
  }
})();
