/* 本地验收：自动跟读（mediafull v2，2026-11-03）
   覆盖：① webdriver 守卫（自动化环境不出声、不请求 /yrbtts）
        ② 伪装真人后：手势解锁 → 自动读首屏卡 → 滚动跟随换读
        ③ 手动停止（再点当前卡 🔊）后同卡不重读
   断言手段：init 阶段包一层 window.fetch，/yrbtts 请求记录朗读文本并返回
   可播放的静音 WAV（无头浏览器无音频设备，真请求会 404→退本机，无法断言） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = process.env.YRB_SITE || "http://127.0.0.1:8794/";
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
}
function feedData() {
  return [{ id: 90001, title: "孩子不爱写作业怎么办", text: "试了好多办法都没用，请有经验的家长支支招。", type: "img", user: "测试家长", tag: "求助" },
          { id: 90002, title: "两岁孩子挑食怎么破", text: "每顿饭都要追着喂，愁死了。", type: "img", user: "另一位家长", tag: "求助" }];
}
const STUB = () => {
  function makeWav() {
    const sr = 8000, n = sr * 5;   /* 5 秒静音：保证「再点一次=停止」发生在朗读中 */
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: "audio/wav" });
  }
  window.__tts = [];
  const orig = window.fetch;
  window.fetch = function (u) {
    const url = String(u);
    if (url.indexOf("/yrbtts") > -1) {
      try { window.__tts.push(decodeURIComponent(url.split("t=")[1] || "").slice(0, 20)); } catch (e) { window.__tts.push("?"); }
      return Promise.resolve(new Response(makeWav(), { status: 200 }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
};
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });

  /* ---------- 页面 A：默认 webdriver=true，守卫应全程拦截 ---------- */
  const ctxA = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const pa = await ctxA.newPage();
  const reqsA = [];
  pa.on("request", r => { if (r.url().includes("/yrbtts")) reqsA.push(1); });
  await pa.goto(SITE + "?as=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await pa.waitForTimeout(1200);
  await pa.evaluate(() => { try { enterApp(); } catch (e) {} });
  await pa.waitForTimeout(1000);
  await pa.evaluate((posts) => { S.posts = posts; try { renderFeed(); } catch (e) {} document.getElementById("page-home").dispatchEvent(new Event("scroll")); }, feedData());
  await pa.waitForTimeout(1200);
  const tA = await pa.evaluate(() => ({ pill: !!document.getElementById("mfAuto"), st: YRB_MEDIAFULL.autoFollow.state() }));
  ck("A1 胶囊已注入", tA.pill);
  ck("A2 webdriver 守卫：零 /yrbtts 请求", reqsA.length === 0, reqsA.length + " 次");
  await ctxA.close();

  /* ---------- 页面 B：伪装真人（navigator.webdriver=false），验证跟随链路 ---------- */
  const ctxB = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctxB.addInitScript(
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +
    "(" + STUB.toString() + ")();"
  );
  const pb = await ctxB.newPage();
  const errs = [];
  pb.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await pb.goto(SITE + "?as=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await pb.waitForTimeout(1200);
  await pb.evaluate(() => { try { enterApp(); } catch (e) {} });
  await pb.waitForTimeout(1000);
  await pb.evaluate((posts) => { S.posts = posts; try { renderFeed(); } catch (e) {} }, feedData());
  await pb.waitForTimeout(800);

  /* B1 胶囊默认开，未解锁手势前不发声 */
  const b1 = await pb.evaluate(() => ({ txt: document.getElementById("mfAuto").textContent, n: window.__tts.length }));
  ck("B1 默认开启且未提前发声", /跟读中/.test(b1.txt) && b1.n === 0, JSON.stringify(b1));

  /* B2 在顶部栏点一下解锁（别点卡片，会开详情让跟读让路）→ 首屏卡自动开读 */
  await pb.mouse.click(206, 40);
  await pb.waitForTimeout(1500);
  const b2 = await pb.evaluate(() => ({ tts: window.__tts, st: YRB_MEDIAFULL.autoFollow.state() }));
  ck("B2 解锁后自动读首屏卡", b2.tts.length >= 1 && /不爱写作业/.test(b2.tts[0]), JSON.stringify(b2.tts));
  ck("B3 跟读记账 = 卡 90001", String(b2.st.id) === "90001", JSON.stringify(b2.st));

  /* B4 滚动到第二张卡 → 跟随换读 */
  await pb.evaluate(() => {
    const cards = document.querySelectorAll("#feed .card");
    if (cards[1]) cards[1].scrollIntoView({ block: "start" });
  });
  await pb.waitForTimeout(1200);
  const b4 = await pb.evaluate(() => ({ tts: window.__tts, st: YRB_MEDIAFULL.autoFollow.state() }));
  ck("B4 滑动跟随换到卡 90002", /挑食/.test(b4.tts[b4.tts.length - 1] || "") && String(b4.st.id) === "90002", JSON.stringify(b4));

  /* B5-B7 手动停止三连：朗读中点 🔊 = 停（无新请求）；再点 = 重读；再点 = 停 → 微滚同卡不重读 */
  const pickCur = () => {
    const cards = document.querySelectorAll("#feed .card");
    let cur = null, best = 0;
    cards.forEach(c => { const r = c.getBoundingClientRect(); const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); if (h > best) { best = h; cur = c; } });
    const btn = cur && cur.querySelector("[data-tts]");
    if (btn) btn.click();
    return cur && cur.dataset.id;
  };
  const b5a = await pb.evaluate(pickCur);
  await pb.waitForTimeout(300);
  const b5 = await pb.evaluate(() => ({ n: window.__tts.length, st: YRB_MEDIAFULL.autoFollow.state() }));
  ck("B5 朗读中再点 = 停止且无新请求", b5.st.reading === false && b5.st.id === null && b5.n === b4.tts.length, JSON.stringify(b5));
  await pb.waitForTimeout(700);
  await pb.evaluate(pickCur);              /* 重读（新请求） */
  await pb.waitForTimeout(700);
  await pb.evaluate(pickCur);              /* 再点 = 停 */
  await pb.waitForTimeout(300);
  const b6 = await pb.evaluate(() => ({ n: window.__tts.length, st: YRB_MEDIAFULL.autoFollow.state() }));
  ck("B6 停止后状态干净", b6.st.reading === false && b6.st.id === null && b6.n === b5.n + 1, JSON.stringify(b6));
  await pb.evaluate(() => { document.getElementById("page-home").scrollTop += 3; });
  await pb.waitForTimeout(1000);
  const b7 = await pb.evaluate(() => ({ n: window.__tts.length, st: YRB_MEDIAFULL.autoFollow.state() }));
  ck("B7 手动停后同卡微滚不重读", b7.n === b6.n, JSON.stringify({ before: b6.n, after: b7.n }));

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log("结果: " + pass + " 通过 / " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("脚本异常:", e.message); process.exit(2); });
