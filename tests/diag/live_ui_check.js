// 育人帮.cn 线上真机验收：用真实 Chrome 打开手机视图，走一遍关键交互
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const SITE = "https://xn--gmqq09al6z.cn/";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const results = [];
const check = (n, ok, extra = "") => results.push({ n, ok: !!ok, extra });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: UA,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

  console.log("打开 " + SITE);
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  console.log("title = " + title);
  check("标题为新版", /家长互助社区/.test(title), title);

  // 底部 tab
  const tabs = await page.$$eval("[data-p]", (els) =>
    els.map((e) => e.getAttribute("data-p")).filter(Boolean)
  );
  console.log("底部 tab = " + JSON.stringify(tabs));
  check("底部有 首页/发布/消息/我的", ["home", "msgs", "me"].every((t) => tabs.includes(t)), JSON.stringify(tabs));
  check("底部已无「朋友」", !tabs.includes("friends"), JSON.stringify(tabs));

  // 天气
  const bodyTxt = await page.evaluate(() => document.body.innerText);
  check("页面无天气字样", !/26°|晴|多云|weather/i.test(bodyTxt));
  check("可见正文已渲染（非空白页）", bodyTxt.trim().length > 40, "len=" + bodyTxt.trim().length);

  // 关键：登录面板（运行时注入）
  await page.evaluate(() => {
    try { window.YRB_CLOUD && window.YRB_CLOUD.ensureLogin(); } catch (e) {}
  });
  await page.waitForTimeout(1500);

  const sheet = await page.$("#loginSheet");
  check("登录面板可打开（#loginSheet 已注入）", !!sheet);

  if (sheet) {
    const agree = await page.$("#lgAgree");
    check("协议勾选行存在（#lgAgree）", !!agree);

    const agreeTxt = agree ? (await agree.innerText()).replace(/\s+/g, " ") : "";
    console.log("勾选行文案 = " + agreeTxt);
    check("勾选行含《育人帮用户协议》", /育人帮用户协议/.test(agreeTxt));
    check("勾选行含《隐私政策》", /隐私政策/.test(agreeTxt));

    // 未勾选直接点「获取验证码」→ 应被拦截
    const sendBtn = await page.$("#lgSend");
    if (sendBtn) {
      await sendBtn.click();
      await page.waitForTimeout(800);
      const err = await page.$eval("#lgErr", (e) => e.textContent.trim()).catch(() => "(无 #lgErr 节点)");
      console.log("未勾选提示 = " + err);
      check("未勾选时被拦截并有提示", /请先阅读并勾选同意/.test(err), err);
      const on0 = await page.$eval("#lgCk", (e) => e.classList.contains("on")).catch(() => null);
      check("未勾选时状态确实为未勾选", on0 === false, "on=" + on0);
    } else {
      check("找到「获取验证码」按钮（#lgSend）", false, "未找到 #lgSend");
    }

    // 点头部勾选框 → 勾上
    const ck = await page.$("#lgCk");
    if (ck) {
      await ck.click();
      await page.waitForTimeout(300);
      const on = await page.$eval("#lgCk", (e) => e.classList.contains("on")).catch(() => false);
      check("点击勾选框后勾选生效", on);

      // 再点整行空白处 → 应取消勾选（行点击切换）
      const box = await page.$eval("#lgAgree", (e) => {
        const r = e.getBoundingClientRect();
        return { x: r.right - 6, y: r.top + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      await page.waitForTimeout(300);
      const off = await page.$eval("#lgCk", (e) => !e.classList.contains("on")).catch(() => false);
      check("点击整行亦可切换勾选", off);

      // 勾上后不应再有红色提示
      await ck.click();
      await page.waitForTimeout(300);
      const err2 = await page.$eval("#lgErr", (e) => e.textContent.trim()).catch(() => "x");
      check("勾选后红色提示被清除", err2 === "", err2);
    }

    // 协议全文可读
    const docs = await page.$$("#loginSheet .lg-doc");
    check("协议名称可点开阅读（.lg-doc）", docs.length >= 2, "count=" + docs.length);
    const hasDocLayer = await page.$("#lgDoc");
    check("协议阅读层存在（#lgDoc）", !!hasDocLayer);
  }

  check("无 JS 运行时报错", errs.length === 0, errs.join(" | "));

  console.log("");
  console.log("=== 线上真机验收 ===");
  let pass = 0;
  for (const x of results) {
    console.log((x.ok ? "  [PASS] " : "  [FAIL] ") + x.n + (!x.ok && x.extra ? "   → " + x.extra : ""));
    if (x.ok) pass++;
  }
  console.log("");
  console.log(`${pass}/${results.length} 通过`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error("FATAL " + e.message);
  process.exit(2);
});
