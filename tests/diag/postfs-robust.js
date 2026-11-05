/* 真机稳健性：就算浏览器原生全屏被系统撤掉、pointerup 被 WebView 吞掉，
   「点开求助 = 全屏」也必须成立（mediafull v4 的兜底链路） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const PHOTO = "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8fb3c7"/></svg>'
).toString("base64");
const POSTS = [
  { id: 9501, user: "测试家长", title: "", text: "看到孩子参加科技竞赛比赛，我感到非常欣慰。大家支持吗？",
    type: "img", likes: 0, favs: 0, helps: 3, time: "3小时前", ava: "rabbit", tag: "求助",
    comments: [], roses: [], vis: 0, urg: 0, media: [{ kind: "img", url: PHOTO, thumbUrl: PHOTO }] },
  { id: 9502, user: "另一位家长", title: "孩子不肯自己睡", text: "五岁了还要大人陪睡，一关灯就哭。",
    likes: 0, favs: 0, helps: 0, time: "刚刚", ava: "rabbit", tag: "求助",
    comments: [], roses: [], vis: 0, urg: 0 }
];

let pass = 0, fail = 0;
const ck = (n, ok, extra) => { ok ? (pass++, console.log("✓ " + n)) : (fail++, console.log("✗ " + n + "  → " + extra)); };

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/index.html?rb=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(list => { S.posts = list; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POSTS);
  await p.waitForTimeout(700);

  const st = () => p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    return { open: d.classList.contains("open"), fs: d.classList.contains("mf-fs"), native: !!document.fullscreenElement };
  });

  /* R1 原生全屏被系统撤掉 → 视觉全屏必须留着 */
  await p.locator('#feed .card[data-id="9501"] .p-text').first().tap();
  await p.waitForTimeout(600);
  const r1a = await st();
  await p.evaluate(async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) {}
  });
  await p.waitForTimeout(500);
  const r1b = await st();
  ck("R1 点卡片 → 全屏", r1a.open && r1a.fs, JSON.stringify(r1a));
  ck("R1b 原生全屏退出后视觉全屏仍在", r1b.open && r1b.fs, JSON.stringify(r1b));

  /* R2 全屏类被别的层冲掉 → 420ms 内自动补回 */
  await p.evaluate(() => { document.getElementById("r23Detail").classList.remove("mf-fs"); });
  await p.waitForTimeout(700);
  const r2 = await st();
  ck("R2 全屏类被刷掉后自动补回", r2.fs, JSON.stringify(r2));

  /* R3 左右滑退出后，不会再被「自动补全屏」拉回来 */
  await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    const el = d.querySelector(".r23-dcard .p-text");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 30;
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x + 150, y + 8));
  });
  await p.waitForTimeout(900);
  const r3 = await st();
  ck("R3 左滑退出全屏后不被拉回", r3.open && !r3.fs, JSON.stringify(r3));

  /* R4 pointerup 丢失（只来了 click）：点卡片文字仍要打开 + 全屏 */
  await p.evaluate(() => { document.getElementById("r23Detail").classList.remove("open", "mf-fs"); });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const el = document.querySelector('#feed .card[data-id="9502"] .p-text');
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(900);
  const r4 = await st();
  ck("R4 只有 click（无 pointerup）也能全屏", r4.open && r4.fs, JSON.stringify(r4));

  /* R5 关闭详情 → 全屏类收回、退出记忆清空，再开能重新进全屏 */
  await p.evaluate(() => { document.getElementById("r23DBack").click(); });
  await p.waitForTimeout(600);
  const r5a = await st();
  await p.locator('#feed .card[data-id="9502"] .p-text').first().tap();
  await p.waitForTimeout(800);
  const r5b = await st();
  ck("R5 关掉详情后全屏类收回", !r5a.open && !r5a.fs, JSON.stringify(r5a));
  ck("R5b 再次打开又能进全屏", r5b.open && r5b.fs, JSON.stringify(r5b));

  console.log("\n" + pass + "/" + (pass + fail) + " 通过");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
