/* 返回手势层（navback.js）回归：手机侧滑 / 返回键退一级菜单，而不是退出应用
   用户反馈：「智能手机左右滑动可以退出一级二级菜单，现在不能了」。
   断言：
   N1 抽屉（一级菜单）打开 → 历史栈押上占位记录
   N2 系统返回 → 抽屉关掉、页面没走（网址不变 + 信息流还在）
   N3 二级页（设置页）打开 → 系统返回 → 关二级页
   N4 一级 + 二级同时开 → 一次返回只退一级，再返回退另一级（不越级、不退出）
   N5 点 ‹ 正常关二级页 → 占位记录被还回去（下一次侧滑不会「滑了没反应」）
   N6 二级页上左右滑 → 关二级页
   N7 发布面板（底部面板）→ 返回 → 面板关闭且遮罩收起
   N8 弹窗（字体大小）→ 返回 → 弹窗关闭
   N9 全程无脚本错误
   运行前：python -m http.server 8793 --bind 127.0.0.1（项目根，测 /deploy-cn/ 产物） */
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8793/deploy-cn/";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => { errs.push(e.message); console.log("PAGEERR", e.message); });

  await p.goto(BASE + "?nav=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);

  const url0 = p.url();
  const st = () => p.evaluate(() => {
    const on = id => { const e = document.getElementById(id); return !!(e && e.classList.contains("open")); };
    const dr = document.getElementById("drMask");
    return {
      drawer: on("drawer"),
      sub: on("subpage"),
      pub: on("publishSheet"),
      modal: on("modal"),
      mask: !!(dr && dr.classList.contains("show")),
      guard: !!(history.state && history.state.__yrbGuard),
      depth: window.YRB_NAVBACK ? YRB_NAVBACK.depth() : -1,
      list: window.YRB_NAVBACK ? YRB_NAVBACK.list() : [],
      url: location.href,
      alive: !!document.getElementById("feed"),
      nav: !!window.YRB_NAVBACK
    };
  });

  /* —— N1/N2 一级菜单：抽屉 —— */
  await p.evaluate(() => openDrawer());
  await p.waitForTimeout(260);
  const s1 = await st();
  ck("N1 抽屉打开后押上占位记录", s1.drawer && s1.guard && s1.depth === 1, JSON.stringify(s1));

  await p.evaluate(() => history.back());
  await p.waitForTimeout(500);
  const s2 = await st();
  ck("N2 系统返回 → 抽屉关掉、页面没走", !s2.drawer && s2.url === url0 && s2.alive && s2.depth === 0, JSON.stringify(s2));
  ck("N2b 占位记录已消耗", !s2.guard, JSON.stringify(s2));

  /* —— N3 二级页 —— */
  await p.evaluate(() => openSubpage("acct"));
  await p.waitForTimeout(260);
  const s3a = await st();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(500);
  const s3 = await st();
  ck("N3 二级页：打开押占位 → 返回关闭", s3a.sub && s3a.guard && !s3.sub && s3.url === url0 && s3.alive,
    JSON.stringify({ a: s3a, b: s3 }));

  /* —— N4 一级 + 二级叠加：一次返回只退一级 —— */
  await p.evaluate(() => { openDrawer(); openSubpage("general"); });
  await p.waitForTimeout(300);
  const s4a = await st();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(450);
  const s4b = await st();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(450);
  const s4c = await st();
  ck("N4a 两级同开时只押一条占位", s4a.drawer && s4a.sub && s4a.guard && s4a.depth === 2, JSON.stringify(s4a));
  ck("N4b 第一次返回 → 只关二级页，抽屉还在", s4b.drawer && !s4b.sub && s4b.url === url0, JSON.stringify(s4b));
  ck("N4c 第二次返回 → 关抽屉，页面仍在", !s4c.drawer && s4c.sub === false && s4c.url === url0 && s4c.alive, JSON.stringify(s4c));

  /* —— N5 点 ‹ 关二级页 → 占位记录被还回 —— */
  await p.evaluate(() => openSubpage("general"));
  await p.waitForTimeout(260);
  await p.evaluate(() => { const b = document.getElementById("spBack"); if (b) b.click(); });
  await p.waitForTimeout(600);
  const s5 = await st();
  ck("N5 点 ‹ 关二级页后占位记录已还回", !s5.sub && !s5.guard && s5.depth === 0 && s5.url === url0, JSON.stringify(s5));

  /* —— N6 二级页上左右滑 —— */
  await p.evaluate(() => openSubpage("general"));
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const el = document.querySelector("#spBody .sp-note") || document.getElementById("spBody");
    const r = el.getBoundingClientRect();
    const x = Math.max(120, r.left + r.width / 2), y = r.top + Math.min(60, r.height / 2);
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x - 130, y + 3));
  });
  await p.waitForTimeout(400);
  const s6 = await st();
  ck("N6 二级页上左右滑 → 关闭二级页", !s6.sub && s6.url === url0 && s6.alive, JSON.stringify(s6));

  /* —— N7 发布面板 —— */
  await p.evaluate(() => openSheet("publishSheet"));
  await p.waitForTimeout(280);
  await p.evaluate(() => history.back());
  await p.waitForTimeout(500);
  const s7 = await st();
  ck("N7 发布面板：返回 → 面板关闭且遮罩收起", !s7.pub && !s7.mask && s7.url === url0, JSON.stringify(s7));

  /* —— N8 弹窗 —— */
  await p.evaluate(() => { try { openFontsModal(); } catch (e) { } });
  await p.waitForTimeout(300);
  const s8a = await st();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(500);
  const s8 = await st();
  ck("N8 弹窗：打开押占位 → 返回关闭", s8a.modal && s8a.guard && !s8.modal && s8.url === url0,
    JSON.stringify({ a: s8a, b: s8 }));

  /* —— N9 —— */
  ck("N9 全程无脚本错误", errs.length === 0, errs.join(" | "));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
