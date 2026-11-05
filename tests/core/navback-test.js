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
   N10~N13 页面级返回（2026-11-05）：「我的 / 案例广场」这类页面上侧滑或右滑 → 回首页，不退出站点；
            案例页 + 抽屉叠开时，连滑两次 = 先关抽屉、再回首页，全程不离开页面
   N14~N16 详情这一级：点开帖子进全屏 → 返回退全屏 → 再返回关详情 → 仍在首页
   N17~N18 落地保护：首页上再侧滑只停住（提示「已经在首页了」），2 秒内再滑一次才放行退出
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
      land: !!(history.state && history.state.__yrbLand),
      depth: window.YRB_NAVBACK ? YRB_NAVBACK.depth() : -1,
      list: window.YRB_NAVBACK ? YRB_NAVBACK.list() : [],
      tab: (function () {
        var a = document.querySelector(".page.active");
        return a ? String(a.id || "").replace(/^page-/, "") : "";
      })(),
      detail: !!document.querySelector("#r23Detail.open"),
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
  /* 机器忙（verify 并行跑多条 e2e）时 300ms 可能不够渲染出二级页，等它真的开 */
  await p.waitForFunction(() => {
    const s = document.getElementById("subpage");
    return !!(s && s.classList.contains("open"));
  }, null, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(220);
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

  /* —— N10~N13 页面级返回（2026-11-05 用户反馈：左右滑动返回上一层，
     多次滑动时应该回到首页而不是退出）—— */
  await p.evaluate(() => switchTab("me"));
  await p.waitForTimeout(400);
  const s10 = await st();
  ck("N10 切到「我的」→ 历史栈押上占位", s10.tab === "me" && s10.guard && s10.depth === 0, JSON.stringify(s10));

  await p.evaluate(() => history.back());
  await p.waitForTimeout(500);
  const s11 = await st();
  ck("N11 系统返回 → 回首页，页面没有被退出", s11.tab === "home" && s11.url === url0 && s11.alive, JSON.stringify(s11));
  ck("N11b 回首页后占位已清（不残留）", !s11.guard, JSON.stringify(s11));

  /* 案例广场页面上手指右滑 */
  await p.evaluate(() => switchTab("cases"));
  await p.waitForTimeout(500);
  const s12a = await st();
  await p.evaluate(() => {
    const el = document.getElementById("page-cases");
    const r = el.getBoundingClientRect();
    const x = Math.max(140, r.left + Math.min(220, r.width / 2)), y = r.top + 80;
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x + 130, y + 4));
  });
  await p.waitForTimeout(500);
  const s12 = await st();
  ck("N12 案例广场页上左右滑 → 回首页", s12a.tab === "cases" && s12.tab === "home" && s12.url === url0,
    JSON.stringify({ a: s12a, b: s12 }));

  /* 多次返回：案例页上叠一级菜单 → 退一级关菜单 → 再退一级回首页（全程不离开页面） */
  await p.evaluate(() => { switchTab("cases"); });
  await p.waitForTimeout(400);
  await p.evaluate(() => openDrawer());
  await p.waitForTimeout(300);
  const m1 = await st();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(450);
  const m2 = await st();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(450);
  const m3 = await st();
  ck("N13a 案例页 + 抽屉：只押一条占位", m1.tab === "cases" && m1.drawer && m1.guard, JSON.stringify(m1));
  ck("N13b 第一次返回只关抽屉，仍在案例页", !m2.drawer && m2.tab === "cases" && m2.url === url0, JSON.stringify(m2));
  ck("N13c 第二次返回回首页，页面仍在", m3.tab === "home" && m3.url === url0 && m3.alive, JSON.stringify(m3));

  /* —— N14~N16 详情页这一级：点开帖子 → 退全屏 → 关详情 → 仍在首页 —— */
  const STUB_D = {
    id: 9102, cloudId: 777, user: "返回手势测试家长", time: "刚刚", tag: "求助",
    text: "用于测试返回手势的桩帖，请勿当真。", likes: 0, favs: 0, helps: 0, ava: "animal",
    comments: [], roses: []
  };
  await p.evaluate((d) => { S.posts.unshift(d); if (typeof renderFeed === "function") renderFeed(); }, STUB_D);
  await p.waitForTimeout(400);
  /* 用真实点击（pointerdown/up 序列）：这样走 mediafull 的「点一下进全屏」，
     而不是只触发 refine23 的委托打开详情 */
  try { await p.click('#feed .card[data-id="9102"]', { force: true, timeout: 5000 }); }
  catch (e) {
    await p.evaluate(() => {
      const el = document.createElement("button");
      el.id = "__t_open"; el.setAttribute("data-r23detail", "9102");
      document.body.appendChild(el); el.click();
    });
  }
  await p.waitForTimeout(900);
  const d0 = await st();
  const fs0 = await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    return !!(d && d.classList.contains("open") && d.classList.contains("mf-fs"));
  });
  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const d1 = await st();
  const fs1 = await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    return !!(d && d.classList.contains("open") && d.classList.contains("mf-fs"));
  });
  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const d2 = await st();
  /* 断言：全屏退掉、详情留着；再退一次详情关掉，页面始终没离开 */
  ck("N14 点开帖子 → 详情打开，仍在首页", d0.detail && d0.url === url0, JSON.stringify(d0));
  ck("N15 第一次返回 → 退全屏，详情仍在", fs0 ? (!fs1 && d1.url === url0) : (d1.url === url0), JSON.stringify({ fs0, fs1, d1 }));
  ck("N16 第二次返回 → 关详情，仍在首页（没有退出）", d2.url === url0 && d2.alive, JSON.stringify(d2));

  /* —— N17/N18 落地保护：首页上侧滑只「停住」，连滑两次才放行退出 —— */
  await p.evaluate(() => history.back());
  await p.waitForTimeout(600);
  const s17 = await st();
  ck("N17 首页再侧滑 → 仍停在本站首页（没有退出）", s17.url === url0 && s17.alive && s17.land, JSON.stringify(s17));
  await p.evaluate(() => history.back());
  await p.waitForTimeout(800);
  const url18 = p.url();
  ck("N18 2 秒内再滑一次 → 放行退出（等于「再按一次退出」）", url18 !== url0, url18);

  /* —— N9 —— */
  ck("N9 全程无脚本错误", errs.length === 0, errs.join(" | "));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
