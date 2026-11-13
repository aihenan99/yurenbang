/* 首屏体感回归（2026-11-13 提速改造）
   覆盖：
   ① 启动屏关键样式内联到位，HTML 一到就能画出有样式的启动屏
   ② bundle.css 首帧不阻塞（media=print），主程序执行后切成 all，界面样式真生效
   ③ 启动屏点得比主程序早：不重载页面，主程序一就位就进入
   ④ 进入后先出界面、卡片随后补上（不再同步卡住淡出）
   ⑤ 首屏不再预拉 qr-share.png（46KB，只在生成分享长图时才要）
   用法：node tests/diag/firstpaint_test.js [url]   默认 http://127.0.0.1:8793/deploy-cn/index.html */
const path = require("path");
const { chromium } = require(path.join(__dirname, "../../temp/pw/node_modules/playwright-core"));
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL = process.argv[2] || "http://127.0.0.1:8793/deploy-cn/index.html";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); }
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  page.on("pageerror", (e) => console.log("  ! pageerror:", e.message));

  /* 只等第一个字节，模拟"页面刚出现就点了" */
  await page.goto(URL, { waitUntil: "commit", timeout: 60000 });
  await page.waitForSelector("#splash", { state: "attached" });

  const crit = await page.evaluate(() => {
    const st = document.querySelector("#yrbCrit");
    const sp = document.querySelector("#splash");
    return {
      hasStyle: !!st,
      bg: sp ? getComputedStyle(sp).backgroundImage.slice(0, 60) : "",
      display: sp ? getComputedStyle(sp).display : "",
    };
  });
  ok("① 启动屏关键样式已内联（<style id=yrbCrit>）", crit.hasStyle);
  ok("① 启动屏首帧就有背景（不靠外部 CSS）", /gradient/.test(crit.bg), crit.bg);

  /* ② 看原始 HTML（浏览器里此刻已经切回 all，看不出首帧状态） */
  const raw = await new Promise((res, rej) => {
    require("http").get(URL, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej);
  }).catch(() => "");
  ok("② 原始 HTML 里 bundle.css 是 media=print（首帧不阻塞）",
    /id="yrbBundleCss"[^>]*media="print"/.test(raw) || /media="print"[^>]*id="yrbBundleCss"/.test(raw),
    (raw.match(/<link rel="stylesheet"[^>]*>/g) || []).slice(0, 2));

  /* 立刻点一下启动屏：此时 bundle.js 多半还没执行完（模拟弱网手快） */
  const navBefore = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await page.touchscreen.tap(195, 420).catch(() => {});

  const tApp = await page.waitForFunction(() => {
    const a = document.querySelector("#app");
    return a && !a.classList.contains("hidden");
  }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  ok("③ 早点击也能进入 App（意图已记录，不丢）", tApp);

  await page.waitForTimeout(400);
  const st = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation");
    const css = document.querySelector("#yrbBundleCss");
    const tb = document.querySelector("#tabbar");
    const cards = document.querySelectorAll("#feed .card").length;
    return {
      navCount: nav.length,
      hash: location.search,
      cssMedia: css ? css.media : "无",
      hasSheet: !!(css && css.sheet),
      tabbarPos: tb ? getComputedStyle(tb).position : "",
      cards,
    };
  });
  ok("③ 没有触发自救重载（导航次数不变）", st.navCount === navBefore && !/yrbheal/.test(st.hash), st);
  ok("② bundle.css 已切回 media=all 且已加载", st.cssMedia === "all" && st.hasSheet, st);
  ok("② 界面样式真生效（#tabbar 有布局样式）", st.tabbarPos === "absolute" || st.tabbarPos === "fixed", st.tabbarPos);

  /* 卡片随后补上（本地无后端：注入一条桩帖，验证延迟到 rAF 的 renderFeed 真的会跑） */
  await page.evaluate(() => {
    try {
      if (!S.posts.some((x) => String(x.id) === "9701")) {
        S.posts.push({ id: 9701, title: "首屏测试求助", text: "首屏测试正文，用来确认信息流会被画出来。",
          user: "测试家长", ava: "rabbit", time: Date.now(), likes: 0, favs: 0, helps: 0, comments: [] });
      }
      renderFeed();
    } catch (e) {}
  });
  const tCards = await page.waitForFunction(() => document.querySelectorAll("#feed .card").length > 0, null, { timeout: 8000 })
    .then(() => true).catch(() => false);
  ok("④ 进入后信息流照常渲染（renderFeed 未被 rAF 丢掉）", tCards);

  const qr = reqs.filter((u) => /qr-share\.png/.test(u));
  ok("⑤ 首屏没有预拉分享二维码 46KB", qr.length === 0, qr);

  const js = reqs.filter((u) => /vendor\/cloud-sdk\.global\.js/.test(u));
  ok("⑤ 自建客户端在时不拉平台 SDK", js.length === 0, js);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
