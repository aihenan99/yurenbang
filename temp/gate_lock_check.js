/* 育人帮 · 「帮忙留言需注册才可查看」验证（真锁版）
   规则：
     · 求助内容免费看（首页 / 卡片 / 详情正文）
     · 查看帮忙留言要登录 —— 未登录**连数据都拿不到**（服务端 RLS 只放行 authenticated），
       前端只显示条数（取自 yb_posts.helps，由触发器维护）
     · 发布求助 / 帮忙回应要登录
   做法：把 window.YRB_CLOUD 换成可控桩，精确切换登录态（只影响 gate 层）。 */
const { chromium } = require("playwright-core");

const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra === undefined ? "" : String(extra) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "   [" + extra + "]" : ""}`);
}

const STUB = () => {
  window.__gate = { ensureLogin: 0, openLogin: 0, resolved: null, signed: false };
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

const probe = (listSel, lockId) => ({
  listSel, lockId,
  run: `(() => {
    const l = document.querySelector(${JSON.stringify(listSel)});
    const box = document.getElementById(${JSON.stringify(lockId)});
    return {
      hasList: !!l,
      locked: !!l && l.classList.contains("cm-locked"),
      hasLock: !!box,
      text: box ? box.textContent.replace(/\\s+/g, " ").trim() : "",
      items: l ? l.querySelectorAll(".cm-item").length : 0,
      lockBeforeList: !!(box && l && box.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  })()`,
});

const num = (t, re) => { const m = String(t).match(re); return m ? Number(m[1]) : -1; };

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
  await page.waitForSelector("#feed .card", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(STUB);
  await page.waitForTimeout(200);

  const CM = probe("#cmList", "cmLock");

  console.log("=== A. 底部「帮忙」面板：未登录只给条数 ===");
  /* 挑一张确定有帮忙留言的卡片，后面 D 段复用同一张 */
  const pickId = await page.evaluate(() => {
    const cards = Array.prototype.slice.call(document.querySelectorAll("#feed .card"));
    const withHelp = cards.filter((c) => {
      const pill = c.querySelector(".helps-pill");
      const m = pill && pill.textContent.match(/(\d+)/);
      return m && Number(m[1]) > 0;
    });
    const card = withHelp[0] || cards[0];
    if (!card) return null;
    const t = card.querySelector('[data-act="cm"]');
    if (t) t.click();
    return card.dataset.id;
  });
  check("找到一张有帮忙留言的卡片", !!pickId, "id=" + pickId);

  await page.waitForSelector("#commentSheet.open", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector("#cmLock", { timeout: 5000 }).catch(() => {});
  check("打开面板即出现锁面板（不等云端返回，避免闪出「还没有帮忙」）",
    await page.evaluate(() => !!document.getElementById("cmLock")));
  await page.waitForTimeout(1500);   /* 给"万一还能拉到数据"留足时间 */
  const a = await page.evaluate(CM.run);
  check("帮忙面板能打开（求助本身免费看）", !!a.hasList);
  check("留言列表被锁（容器加 cm-locked）", a.locked);
  check("锁面板在留言列表上方", a.lockBeforeList);
  check("★ 未登录连留言数据都拿不到（服务端 RLS 已封）", a.items === 0, `DOM 条数=${a.items}`);
  const titleN = await page.$eval("#cmTitle", (e) => { const m = e.textContent.match(/（(\d+)）/); return m ? Number(m[1]) : -1; }).catch(() => -1);
  const lockN = num(a.text, /查看 (\d+) 条/);
  check("锁面板数字与面板标题一致（取自权威计数 helps）", lockN === titleN && lockN > 0, `锁=${lockN} 标题=${titleN}`);
  const pillTxt = await page.$eval(`#feed .card[data-id="${pickId}"] .helps-pill`, (e) => e.textContent.trim()).catch(() => "");
  check("卡片上「帮忙数」仍可见（数字保留）", /个帮忙/.test(pillTxt), pillTxt);
  check("卡片数字与锁面板一致", num(pillTxt, /(\d+)/) === lockN, `卡片=${num(pillTxt, /(\d+)/)} 锁=${lockN}`);

  console.log("\n=== B. 点锁面板的按钮 → 拉起登录 ===");
  await page.evaluate(() => { window.__gate.openLogin = 0; window.__gate.ensureLogin = 0; });
  await page.$eval("#cmLock .cm-lock-b", (e) => e.click());
  await page.waitForTimeout(300);
  const asked = await page.evaluate(() => window.__gate.openLogin + window.__gate.ensureLogin);
  check("点「登录 / 注册」会拉起登录", asked >= 1, `调用次数=${asked}`);

  console.log("\n=== C. 登录后立即解锁（不刷新页面） ===");
  await page.evaluate(() => {
    window.__gate.signed = true;
    window.dispatchEvent(new CustomEvent("yrb-auth", { detail: { signedIn: true } }));
  });
  await page.waitForTimeout(700);
  const c = await page.evaluate(CM.run);
  check("登录后锁 class 被移除", !c.locked);
  check("登录后锁面板被移除", !c.hasLock);
  const reset = await page.evaluate(() => (typeof S !== "undefined" && S && S.posts) ? S.posts.every((p) => !p._cmLoaded) : false);
  check("登录后清除了「已加载」标记（否则会一直卡在『还没有帮忙』）", reset);

  console.log("\n=== D. 求助详情页内嵌留言：未登录同样锁住 ===");
  await page.evaluate(() => { window.__gate.signed = false; });
  const openInfo = await page.evaluate((id) => {
    document.querySelectorAll(".sheet.open").forEach((s) => s.classList.remove("open"));
    const card = document.querySelector('#feed .card[data-id="' + id + '"]') || document.querySelector("#feed .card");
    if (!card) return { ok: false, why: "没有卡片" };
    const acts = card.querySelector(".p-acts");
    if (acts && !card.querySelector("[data-r23detail]")) {
      acts.insertAdjacentHTML("beforeend",
        '<button class="r23-detail-link" data-r23detail="' + card.dataset.id + '">📄 查看完整求助</button>');
    }
    const el = card.querySelector("[data-r23detail]");
    if (!el) return { ok: false, why: "入口注入失败" };
    el.click();
    return { ok: true, id: card.dataset.id };
  }, pickId);
  await page.waitForSelector("#r23Detail.open", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector("#r23Lock", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const RD = probe("#r23CmList", "r23Lock");
  const d = await page.evaluate(RD.run);
  const detailOpen = await page.$eval("#r23Detail", (e) => e.classList.contains("open")).catch(() => false);
  check("详情页能打开（求助正文免费看）", detailOpen, openInfo.ok ? "card id=" + openInfo.id : openInfo.why);
  check("求助正文没有被锁（.p-text 可见）",
    await page.$eval("#r23Detail .p-text", (e) => getComputedStyle(e).display !== "none").catch(() => false));
  check("详情页出现锁面板", d.hasLock);
  check("★ 详情页游客同样拿不到留言数据", d.items === 0, `DOM 条数=${d.items}`);
  const cmheadN = await page.$eval("#r23Detail .r23-cmhead", (e) => { const m = e.textContent.match(/(\d+)/); return m ? Number(m[1]) : -1; }).catch(() => -1);
  const lockN2 = num(d.text, /查看 (\d+) 条/);
  check("详情页锁面板数字与「帮忙评论 N」一致", lockN2 === cmheadN && lockN2 > 0, `锁=${lockN2} 标题=${cmheadN}`);
  const heads = await page.evaluate(() => {
    const n = document.querySelector("#r23Detail .r23-cmhead");
    const s = document.querySelector("#r23Detail .r23-status");
    return { cmhead: n ? n.textContent.replace(/\s+/g, " ").trim() : "", status: s ? s.textContent.replace(/\s+/g, " ").trim() : "" };
  });
  check("「帮忙评论 N」标题保留（数字可见）", /帮忙评论/.test(heads.cmhead), heads.cmhead);
  check("「已有 N 位家长伸出援手」保留", /伸出援手|已解决/.test(heads.status), heads.status);

  console.log("\n=== E. 死循环检查（未登录停留 1.5s） ===");
  await page.evaluate(() => {
    window.__mut = 0;
    window.__obs = new MutationObserver((list) => { window.__mut += list.length; });
    window.__obs.observe(document.getElementById("r23Detail"), { childList: true, subtree: true });
  });
  await page.waitForTimeout(1500);
  const mut = await page.evaluate(() => { window.__obs.disconnect(); return window.__mut; });
  check("未登录停留 1.5s 内详情页未被反复重渲染", mut <= 6, `子树变更次数=${mut}`);

  console.log("\n=== F. 长辈模式：锁面板要更大更好按 ===");
  const before = await page.$eval("#r23Lock .cm-lock-t", (e) => parseFloat(getComputedStyle(e).fontSize));
  await page.evaluate(() => document.getElementById("phone").setAttribute("data-elder", "1"));
  await page.waitForTimeout(350);
  const after = await page.$eval("#r23Lock .cm-lock-t", (e) => parseFloat(getComputedStyle(e).fontSize));
  const bSize = await page.$eval("#r23Lock .cm-lock-b", (e) => parseFloat(getComputedStyle(e).fontSize));
  check("长辈模式下锁面板字号变大", after > before, `${before}px → ${after}px`);
  check("长辈模式下登录按钮字号够大（≥16px）", bSize >= 16, `${bSize}px`);
  await page.evaluate(() => document.getElementById("phone").setAttribute("data-elder", "0"));

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
