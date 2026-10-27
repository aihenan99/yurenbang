/* 美食答谢自检：面板 / 满屏动画 / 收件箱 / 按钮接线 / 长辈模式 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? (pass++, console.log("  ✅ " + n + (extra ? " ｜ " + extra : ""))) : (fail++, console.log("  ❌ " + n + (extra ? " ｜ " + extra : ""))); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  /* 启动屏可能已自动收起（线上加载慢时点击前就 hidden），仅在可见时点击 */
  const splashVis = await page.evaluate(() => {
    const s = document.querySelector("#splash");
    return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null);
  });
  if (splashVis) { await page.click("#splash"); await page.waitForTimeout(700); }
  console.log("启动屏处理:", splashVis ? "已点击进入" : "已自动收起，直接进入");

  console.log("=== A. 我的页入口 ===");
  await page.click('.tb-item[data-p="me"]'); await page.waitForTimeout(400);
  const entry = await page.evaluate(() => { const b = document.querySelector("#fdInboxBtn"); return b ? b.textContent.replace(/\s+/g, " ").trim() : ""; });
  check("「收到的答谢」入口存在", /收到的答谢/.test(entry), entry);
  await page.click("#fdInboxBtn"); await page.waitForTimeout(500);
  const inbox = await page.evaluate(() => ({ open: document.querySelector("#fdInSheet").classList.contains("open"), empty: document.querySelector("#fdInList").textContent.slice(0, 40) }));
  check("收件箱打开（未登录空态）", inbox.open && /还没有收到答谢/.test(inbox.empty), inbox.empty.trim().slice(0, 20));
  await page.click("#fdInX");

  console.log("=== B. 答谢面板 ===");
  await page.evaluate(() => { window.YRB_FOOD.openPanel({ name: "乐乐爸爸" }); });
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => ({
    open: document.querySelector("#fdSheet").classList.contains("open"),
    to: document.querySelector("#fdToName").textContent,
    cards: document.querySelectorAll("#fdSheet .fd-card").length,
    imgs: [...document.querySelectorAll("#fdSheet .fd-card img")].filter(i => i.naturalWidth > 0).length
  }));
  check("面板打开且显示对方名字", panel.open && panel.to === "乐乐爸爸", panel.to);
  check("9 道菜 + 玫瑰共 10 个选项", panel.cards === 10, panel.cards + " 个");
  /* 等菜品图加载完（懒加载 + 网络，最多 8s） */
  let imgs = 0;
  for (let t = 0; t < 16; t++) {
    imgs = await page.evaluate(() => [...document.querySelectorAll("#fdSheet .fd-card img")].filter(i => i.naturalWidth > 0).length);
    if (imgs >= 9) break;
    await page.waitForTimeout(500);
  }
  check("菜品图片全部加载成功", imgs === 9, imgs + "/9");

  console.log("=== C. 嘉年华式大礼动画 ===");
  const t0 = Date.now();
  await page.click('#fdSheet .fd-card[data-food="crayfish"]');
  await page.waitForTimeout(90);
  const start = await page.evaluate(() => {
    const hero = document.querySelector("#fdFx .fd-hero");
    const g = document.querySelector("#fdFx .fd-gift");
    const r = hero ? hero.getBoundingClientRect() : null;
    return {
      fx: !!document.querySelector("#fdFx"),
      gifts: document.querySelectorAll("#fdFx .fd-gift").length,
      w: g ? Math.round(g.offsetWidth) : 0,   /* 布局宽度，不受入场缩放影响 */
      heroY: r ? Math.round(r.top + r.height / 2) : null,
      rays: !!document.querySelector("#fdFx .fd-rays"),
      halo: !!document.querySelector("#fdFx .fd-halo"),
      sparks: document.querySelectorAll("#fdFx .fd-spark").length,
      waves: document.querySelectorAll("#fdFx .fd-wave").length,
      steam: document.querySelectorAll("#fdFx .fd-steam").length
    };
  });
  check("只有一份超大礼物", start.fx && start.gifts === 1, start.gifts + " 份");
  check("超大尺寸（≥260px，约 86% 屏宽）", start.w >= 260, start.w + "px / 屏宽 390");
  check("金光放射 + 光晕 + 光波", start.rays && start.halo && start.waves >= 2, `rays=${start.rays} halo=${start.halo} wave=${start.waves}`);
  check("星星爆散粒子（≥20）", start.sparks >= 20, start.sparks + " 颗");
  check("热气存在", start.steam >= 3, start.steam + " 缕");
  check("从屏幕下方冲出（起点在画面下部）", start.heroY === null || start.heroY > 560, "起始 y=" + start.heroY);

  /* 落定后应停在画面中央并轻浮 */
  await page.waitForTimeout(1400);
  const mid = await page.evaluate(() => {
    const hero = document.querySelector("#fdFx .fd-hero");
    const r = hero ? hero.getBoundingClientRect() : null;
    const cap = (document.querySelector("#fdFx .fd-cap") || {}).textContent || "";
    return { y: r ? Math.round(r.top + r.height / 2) : null, cap };
  });
  check("停在画面中央（y ≈ 48% 屏高）", mid.y !== null && Math.abs(mid.y - 405) < 80, "落定 y=" + mid.y);
  check("字幕带对方名字与菜名", /乐乐爸爸/.test(mid.cap) && /麻辣小龙虾/.test(mid.cap), mid.cap.replace(/\s+/g, " ").slice(0, 30));
  /* 层级：必须盖过帮忙评论面板 #commentSheet(67)（否则从面板里送餐会被挡住只露光芒） */
  const zFx = await page.evaluate(() => { const fx = document.querySelector("#fdFx"); return fx ? +getComputedStyle(fx).zIndex : 0; });
  check("动画层级 ≥80（压过评论面板 67）", zFx >= 80, "z=" + zFx);
  const lg = await page.evaluate(() => JSON.parse(localStorage.getItem("yrb_food_out_v1") || "[]")[0] || {});
  check("本地留档（菜名/受赠人/时间）", lg.name === "麻辣小龙虾" && lg.to === "乐乐爸爸" && !!lg.at, JSON.stringify(lg).slice(0, 60));
  await page.screenshot({ path: "E:/育人帮/temp/food_fx.png" });

  /* 时长 ≥6 秒 */
  let gone = false, goneAt = 0;
  for (let t = 0; t < 24; t++) {
    gone = await page.evaluate(() => !document.querySelector("#fdFx"));
    if (gone) { goneAt = Date.now() - t0; break; }
    await page.waitForTimeout(400);
  }
  const sheetClosed = await page.evaluate(() => !document.querySelector("#fdSheet").classList.contains("open"));
  check("动画时长 ≥6 秒", gone && goneAt >= 6000, (goneAt / 1000).toFixed(1) + "s");
  check("收场后面板已关闭", sheetClosed);

  console.log("=== D. 按钮接线（原两处送玫瑰 → 答谢面板） ===");
  await page.evaluate(() => {
    const b1 = document.createElement("button"); b1.dataset.act = "cgift"; b1.dataset.i = "0"; b1.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:99"; b1.textContent = "t1";
    const b2 = document.createElement("button"); b2.setAttribute("data-dcgift", "0"); b2.style.cssText = "position:fixed;left:4px;bottom:40px;z-index:99"; b2.textContent = "t2";
    document.body.appendChild(b1); document.body.appendChild(b2);
  });
  await page.click('button[data-act="cgift"]'); await page.waitForTimeout(300);
  check("评论页「🎁 答谢大餐」→ 面板", await page.evaluate(() => document.querySelector("#fdSheet").classList.contains("open")));
  await page.click("#fdX");
  await page.click('button[data-dcgift="0"]'); await page.waitForTimeout(300);
  check("详情页「🎁 答谢大餐」→ 面板（拦截原生送玫瑰）", await page.evaluate(() => document.querySelector("#fdSheet").classList.contains("open")));
  await page.click("#fdX");
  await page.evaluate(() => { document.querySelectorAll('button[data-act="cgift"],button[data-dcgift="0"]').forEach(b => { if (b.textContent === "t1" || b.textContent === "t2") b.remove(); }); });

  console.log("=== E. 玫瑰选项仍走原满屏玫瑰 ===");
  await page.evaluate(() => { window.YRB_FOOD.openPanel({ name: "阳阳爸爸" }); }); await page.waitForTimeout(300);
  await page.click('#fdSheet .fd-card[data-food="rose"]'); await page.waitForTimeout(500);
  const rose = await page.evaluate(() => ({ gift: document.querySelector("#gift").classList.contains("show") || document.querySelector("#gift").style.display !== "none", text: (document.querySelector("#gTitle") || {}).textContent || "" }));
  check("选玫瑰 → 原玫瑰满屏流程", rose.gift, rose.text);
  await page.evaluate(() => { try { document.querySelector("#gift").classList.remove("show"); } catch (e) {} });

  console.log("=== F. 我的钱包（玫瑰 + 收到的礼物） ===");
  await page.click('.tb-item[data-p="me"]'); await page.waitForTimeout(400);
  const wlBtn = await page.evaluate(() => {
    const b = document.querySelector('[data-act="memu"][data-t="钱包 · 玫瑰"]');
    return b ? { sub: (b.querySelector(".arr") || {}).textContent || "" } : null;
  });
  check("「钱包 · 玫瑰」入口存在", !!wlBtn, wlBtn && wlBtn.sub);
  check("副标题显示玫瑰朵数", !!wlBtn && /朵/.test(wlBtn.sub), wlBtn && wlBtn.sub);
  await page.click('[data-act="memu"][data-t="钱包 · 玫瑰"]'); await page.waitForTimeout(700);
  const wl = await page.evaluate(() => ({
    open: document.querySelector("#fdWlSheet").classList.contains("open"),
    rose: (document.querySelector("#fdWlRose") || {}).textContent || "",
    gift: (document.querySelector("#fdWlGift") || {}).textContent || "",
    head: (document.querySelector(".fd-wl-h") || {}).textContent || "",
    empty: (document.querySelector("#fdWlList") || {}).textContent || "",
    tryBtn: !!document.querySelector("[data-fd-try]"),
    oldRose: document.querySelector("#gift") ? document.querySelector("#gift").classList.contains("show") : false
  }));
  check("钱包面板打开", wl.open);
  const roseNow = await page.evaluate(() => String(S.roses));
  check("玫瑰余额展示", wl.rose === roseNow, wl.rose + " 朵（S.roses=" + roseNow + "）");
  check("有「收到的礼物」区块", /收到的礼物/.test(wl.head), wl.head.trim());
  check("未登录空态 + 试看入口", /还没有收到答谢/.test(wl.empty) && wl.tryBtn);
  check("点钱包不再触发旧玫瑰动画", !wl.oldRose);

  await page.click("[data-fd-try]"); await page.waitForTimeout(900);
  const tryFx = await page.evaluate(() => ({
    fx: !!document.querySelector("#fdFx"),
    closed: !document.querySelector("#fdWlSheet").classList.contains("open"),
    cap: (document.querySelector("#fdFx .fd-cap") || {}).textContent || ""
  }));
  check("试看效果 → 满屏大餐动画", tryFx.fx && tryFx.closed, tryFx.cap.replace(/\s+/g, " ").slice(0, 24));
  await page.evaluate(() => { const f = document.querySelector("#fdFx"); if (f) f.remove(); });

  /* 收到的礼物列表：点任意一份再播一次（获得者视角） */
  await page.click('[data-act="memu"][data-t="钱包 · 玫瑰"]'); await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelector("#fdWlList").innerHTML =
      '<button type="button" class="fd-in-item" data-fd-replay="0" data-fd-food="duck" data-fd-from="乐乐爸爸">' +
      '<span class="fd-e">🦆</span><span class="fd-in-m"><b>乐乐爸爸 请你吃了「烤鸭」</b><span>刚刚</span></span>' +
      '<span class="fd-again">▶ 再看</span></button>';
  });
  await page.click('#fdWlList [data-fd-replay="0"]'); await page.waitForTimeout(900);
  const rp = await page.evaluate(() => {
    const g = document.querySelector("#fdFx .fd-gift");
    return {
      fx: !!document.querySelector("#fdFx"),
      src: g ? g.getAttribute("src") : "",
      cap: (document.querySelector("#fdFx .fd-cap") || {}).textContent || "",
      closed: !document.querySelector("#fdWlSheet").classList.contains("open")
    };
  });
  check("点礼物「▶ 再看」→ 再播一次", rp.fx && /duck/.test(rp.src) && /乐乐爸爸/.test(rp.cap) && rp.closed, rp.cap.replace(/\s+/g, " ").slice(0, 26));
  await page.evaluate(() => { const f = document.querySelector("#fdFx"); if (f) f.remove(); });

  console.log("=== G. 长辈模式 ===");
  await page.evaluate(() => { document.querySelector("#phone").dataset.elder = "1"; });
  await page.waitForTimeout(350);
  await page.evaluate(() => { window.YRB_FOOD.openPanel({ name: "TA" }); }); await page.waitForTimeout(300);
  const big = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#fdSheet .fd-bar b")).fontSize));
  check("长辈模式标题 ≥19px", big >= 19, big + "px");

  console.log("JS 错误:", errs.length ? errs.slice(0, 3) : "无");
  console.log(`\n===== 美食答谢测试：${pass} 通过 / ${fail} 失败 =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
