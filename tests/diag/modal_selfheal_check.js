const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1000);
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }
  await p.evaluate(() => {
    S.posts.unshift({ id: 9301, mine: true, user: "测试家长", flag: "🇨🇳", type: "img", tag: "我的求助", time: "刚刚",
      loc: "本地", text: "求助", likes: 0, liked: false, favs: 0, faved: false, helps: 1, kinds: ["study"], media: [], roses: [],
      comments: [{ user: "李妈妈", flag: "🇨🇳", ava: "bear", kind: "text", text: "试试这样", likes: 0, liked: false }] });
    renderFeed();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-r23detail="9301"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector(".r23-solve").click());
  await p.waitForTimeout(300);

  // 人为盖上更高一层的遮罩（模拟真机上被别的浮层盖住）
  const covered = await p.evaluate(() => {
    const st = document.createElement("style");
    st.textContent = "#__cov{display:none}#__cov.open{display:block;position:absolute;inset:0;z-index:200;background:rgba(0,0,0,.01)}";
    document.head.appendChild(st);
    const d = document.createElement("div");
    d.id = "__cov"; d.className = "open";         /* 真实浮层都是靠 .open 显隐 */
    document.querySelector("#phone").appendChild(d);
    const btn = document.querySelector("#r23SolveOk").getBoundingClientRect();
    const hit = document.elementFromPoint(btn.left + btn.width / 2, btn.top + btn.height / 2);
    return hit && hit.id || (hit && hit.tagName);
  });
  console.log("盖上后按钮位置命中:", covered);

  await p.waitForTimeout(1100);        // 等自愈看护跑两轮
  const healed = await p.evaluate(() => ({
    cov: !!(document.getElementById("__cov") && document.getElementById("__cov").classList.contains("open")),
    z: getComputedStyle(document.querySelector("#modal")).zIndex,
    hit: (() => { const b = document.querySelector("#r23SolveOk").getBoundingClientRect();
      const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return h ? (h.id || h.tagName) : null; })()
  }));
  console.log("自愈后 → 遮罩还在:", healed.cov, "| 弹窗 z:", healed.z, "| 按钮命中:", healed.hit);

  // 真实触摸点确认
  await p.tap("#r23SolveOk");
  await p.waitForTimeout(600);
  console.log("点确认已解决 → 弹窗关闭:", await p.evaluate(() => !document.querySelector("#modal").classList.contains("open")),
    "| 状态:", await p.evaluate(() => (document.querySelector(".r23-status") || {}).textContent.replace(/\s+/g, " ").slice(0, 24)));
  await b.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
