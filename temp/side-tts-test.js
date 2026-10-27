/* side-tts-test.js — 卡片侧边操作列 + 云端真人语音回归（2026-10-24）
   覆盖：p-side 布局（♥⭐🔊 移出底部操作行）/ 侧边按钮交互仍正常 /
        云端语音优先（/yrbtts）与失败回退本机 / 停止切换 / 零脚本错误 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const fs = require("fs");
const URL = "http://127.0.0.1:8794/?stts=" + Date.now();
const MP3 = fs.readFileSync("E:/育人帮/temp/edge-tts-sample.mp3");

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + "  [" + (extra || "") + "]"); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  let failMode = false;
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  let ttsReqs = 0;
  /* 云端语音：正常返回真实 mp3；failMode 时返回 502（真实失败路径） */
  await ctx.route("**/yrbtts*", r => {
    ttsReqs++;
    if (failMode || r.request().url().includes("fail=1")) return r.fulfill({ status: 502, contentType: "application/json", body: '{"error":"tts_failed"}' });
    r.fulfill({ status: 200, contentType: "audio/mpeg", body: MP3 });
  });
  /* 无头 speechSynthesis 替身（验证云端优先时不被调用 / 回退时被调用） */
  await p.addInitScript(() => {
    const cap = []; window.__cap = cap;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: u => cap.push(String(u.text || "")),
        cancel() { window.__cancelled = (window.__cancelled || 0) + 1; }
      }
    });
  });
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2400);
  await p.evaluate(() => {
    try { enterApp(); } catch (e) {}
    try { YRB_CLOUD.signedIn = () => true; } catch (e) {}   /* 点赞门槛（与媒体测试同做法） */
  });
  await p.waitForTimeout(900);

  /* T0 样本注入（2026-10-25 种子模板假数据已下线：样本 likes=23，对齐原断言 24） */
  await p.evaluate(() => {
    S.posts.unshift({
      id: 9501, mine: false, user: "测试家长", flag: "🇨🇳", ava: "rabbit", type: "img",
      kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试", title: "侧列语音测试求助",
      text: "孩子写作业总是拖拉，每天都要催很多遍，有什么好办法吗？",
      likes: 23, liked: false, favs: 0, faved: false, helps: 0, comments: []
    });
    renderFeed();
  });
  await p.waitForTimeout(300);

  /* T1 侧边列布局 */
  const t1 = await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9501']");
    if (!card) return { err: "no card" };
    const side = card.querySelector(".p-side");
    const acts = card.querySelector(".p-acts");
    return {
      hasSide: !!side,
      inSide: side ? {
        like: !!side.querySelector(".pa-btn.like"),
        fav: !!side.querySelector(".pa-btn.fav"),
        tts: !!side.querySelector("[data-tts]")
      } : null,
      actsClean: acts ? (!acts.querySelector(".pa-btn.like") && !acts.querySelector(".pa-btn.fav") && !acts.querySelector("[data-tts]")) : null,
      actsHas: acts ? { pill: !!acts.querySelector(".helps-pill"), help: !!acts.querySelector(".pa-help"), link: !!acts.querySelector(".r23-detail-link") } : null
    };
  });
  ck("卡片有侧边操作列", t1.hasSide === true, JSON.stringify(t1).slice(0, 140));
  ck("♥ ⭐ 🔊 都在侧边列", !!(t1.inSide && t1.inSide.like && t1.inSide.fav && t1.inSide.tts));
  ck("底部操作行已清爽（无 ♥⭐🔊）", t1.actsClean === true);
  ck("底部操作行保留 帮忙数/帮忙/查看完整", !!(t1.actsHas && t1.actsHas.pill && t1.actsHas.help && t1.actsHas.link));

  /* T2 侧边点赞交互正常（点击会触发 renderFeed 整卡重建，需重新查询） */
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9501']");
    card.querySelector(".p-side .pa-btn.like").click();
  });
  await p.waitForTimeout(800);
  const t2 = await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9501']");
    const like = card.querySelector(".p-side .pa-btn.like");
    return { after: like.querySelector(".n").textContent, on: like.classList.contains("on") };
  });
  ck("侧边点赞计数+1 且高亮", t2.after === "24" && t2.on, JSON.stringify(t2));

  /* T3 云端语音优先：点 🔊 → 走 /yrbtts，不碰本机 speechSynthesis */
  await p.evaluate(() => { window.__cap.length = 0; window.__cancelled = 0; });
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9501']");
    card.querySelector(".p-side [data-tts]").click();
  });
  await p.waitForTimeout(1200);
  const t3 = await p.evaluate(() => ({
    cap: window.__cap.length,                 /* 本机被调用次数：云端优先应为 0 */
    ttsBtn: document.querySelector("#feed .card[data-id='9501'] .p-side [data-tts]").textContent
  }));
  ck("云端语音请求已发出", ttsReqs >= 1, "reqs=" + ttsReqs);
  ck("云端优先：未回退本机语音", t3.cap === 0, "localCalls=" + t3.cap);
  ck("朗读中按钮显示 ⏹", t3.ttsBtn === "⏹", t3.ttsBtn);

  /* 等 mp3 播完（约 3.3s）→ 按钮复位 */
  await p.waitForTimeout(4200);
  const t3b = await p.evaluate(() => document.querySelector("#feed .card[data-id='9501'] .p-side [data-tts]").textContent);
  ck("播完按钮复位 🔊", t3b === "🔊", t3b);

  /* T4 云端失败 → 自动回退本机语音（真实 502 路径） */
  failMode = true;
  await p.evaluate(() => { window.__cap.length = 0; window.__cancelled = 0; });
  await p.evaluate(() => {
    const card = document.querySelector("#feed .card[data-id='9501']");
    card.querySelector(".p-side [data-tts]").click();          /* 点朗读：云端 502 → 回退 */
  });
  await p.waitForTimeout(1500);
  const t4 = await p.evaluate(() => ({ cap: window.__cap.join("") }));
  ck("云端 502 后自动回退本机语音", t4.cap.length > 0, t4.cap.slice(0, 40));
  failMode = false;

  /* T5 页面零脚本错误 */
  ck("无脚本错误", errs.length === 0, errs.join(" | "));

  await b.close();
  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试崩溃：", e); process.exit(2); });
