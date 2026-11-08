/* 左右滑动（真实触摸事件）实机路径排查（2026-11-08）
   背景：用户反馈「左右滑动要返回首页后再次滑动才能退出 APP」。
   之前 prod_nav_check.js 只用 history.back() 验证系统返回，没有覆盖**手指横滑**这条独立路径
   （安卓微信 / PWA 独立窗口没有系统侧滑，只能靠本层手写的横滑）。
   本脚本用真实 TouchEvent 复测三条路径：
     ① 非首页（我的）横滑 → 回首页
     ② 首页横滑 → 应先提示「再滑一次退出」，2 秒内再滑 → 真正离开站点
     ③ 打开抽屉后横滑 → 关抽屉
   运行：node tests/diag/swipe-nav-test.js [url] */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const BASE = process.env.YRB_PROD || process.argv[2] || "https://xn--gmqq09al6z.cn/";

/* 在页面里造一次横滑：起点 (x0,y0) → 终点 (x1,y1)
   注意：必须传函数本体，传字符串只会被求值（拿到函数但不执行），滑了个寂寞 */
function swipeInPage(a) {
  const [x0, y0, x1, y1] = a;
  const el = document.elementFromPoint(x0, y0) || document.body;
  const mk = (x, y) => new Touch({ identifier: 1, target: el,
    clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
  const fire = (type, list, changed) => {
    const ev = new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: list, targetTouches: list, changedTouches: changed });
    el.dispatchEvent(ev);
  };
  fire("touchstart", [mk(x0, y0)], [mk(x0, y0)]);
  fire("touchend", [], [mk(x1, y1)]);
  return true;
}

(async () => {
  /* 测境内 IP 站时要绕开本机代理（Chrome 会把 http://118.89.185.37 判成被拦截）：
     YRB_DIRECT=1 node tests/diag/swipe-nav-test.js */
  const args = process.env.YRB_DIRECT === "1" ? ["--no-proxy-server", "--proxy-bypass-list=*"] : [];
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", args });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  await p.goto(BASE + "?sw=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { const s = document.querySelector("#splash"); if (s && !s.classList.contains("hidden")) s.click(); } catch (e) {} });
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);

  const st = () => p.evaluate(() => ({
    tab: (() => { const a = document.querySelector(".page.active"); return a ? a.id.replace("page-", "") : ""; })(),
    drawer: !!document.querySelector("#drawer.open"),
    alive: !!document.getElementById("feed"),
    url: location.href,
    land: !!(window.YRB_NAVBACK && window.YRB_NAVBACK.landed && window.YRB_NAVBACK.landed())
  }));
  const swipe = (x0, y0, x1, y1) => p.evaluate(swipeInPage, [x0, y0, x1, y1]);

  const s0 = await st();
  console.log("BUILD", await p.evaluate(() => (document.querySelector('meta[name="yrb-build"]') || {}).content || "?"),
    "| NAVBACK", await p.evaluate(() => !!(window.YRB_NAVBACK && window.YRB_NAVBACK.ready)),
    "| 落地保护", s0.land);

  /* ① 我的 → 横滑 → 回首页 */
  await p.evaluate(() => switchTab("me"));
  await p.waitForTimeout(500);
  await swipe(200, 500, 80, 505);
  await p.waitForTimeout(500);
  const s1 = await st();
  const ok1 = s1.tab === "home" && s1.alive;
  console.log((ok1 ? "✓" : "✗") + ` ① 我的页横滑 → 回首页  tab=${s1.tab}`);

  /* ② 首页横滑两次 → 第一次提示停住、第二次真退出 */
  await swipe(200, 500, 80, 505);
  await p.waitForTimeout(400);
  const s2a = await st();
  const ok2a = s2a.alive;                                   /* 第一次：必须还在站内 */
  console.log((ok2a ? "✓" : "✗") + ` ②a 首页横滑一次 → 停住不退出  alive=${s2a.alive}`);

  await swipe(200, 520, 80, 525);
  await p.waitForTimeout(900);
  let s2b = { alive: true, url: "" };
  try {
    s2b = await p.evaluate(() => ({ alive: !!document.getElementById("feed"), url: location.href }));
  } catch (e) { s2b = { alive: false, url: "(导航走掉)" }; }
  const ok2b = !s2b.alive;
  console.log((ok2b ? "✓" : "✗") + ` ②b 2 秒内再横滑 → 真正退出  alive=${s2b.alive} url=${s2b.url}`);

  /* ③ 重进一页，首页上打开抽屉再横滑 → 只关抽屉，不退出（层级优先於退出） */
  await p.goto(BASE + "?sw2=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(1800);
  await p.evaluate(() => { try { const s = document.querySelector("#splash"); if (s && !s.classList.contains("hidden")) s.click(); } catch (e) {} });
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(() => { try { openDrawer(); } catch (e) { const d = document.getElementById("drawer"); if (d) d.classList.add("open"); } });
  await p.waitForTimeout(300);
  const beforeDrawer = await st();
  await swipe(200, 600, 80, 605);
  await p.waitForTimeout(500);
  const afterDrawer = await st();
  const ok3 = beforeDrawer.drawer === true && afterDrawer.drawer === false && afterDrawer.alive;
  console.log((ok3 ? "✓" : "✗") + ` ③ 首页抽屉横滑 → 只关抽屉不退出  drawer ${beforeDrawer.drawer}→${afterDrawer.drawer} alive=${afterDrawer.alive}`);

  console.log(errs.length ? "PAGEERR " + errs.join(" | ") : "无脚本错误");
  const pass = ok1 && ok2a && ok2b && ok3;
  console.log(pass ? "\\n全部通过" : "\\n存在失败项（上面标 ✗ 的即当前缺口）");
  await b.close();
  process.exit(pass ? 0 : 1);
})();
