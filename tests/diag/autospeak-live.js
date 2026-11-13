/* 自动朗读「已下线」守卫（2026-11-13 改写，原文件是 11-03 的自动跟读验收）
 *
 * 为什么改：用户 11-07 要求把自动播报改成可选 → 11-13 又明确「不自动阅读」。
 * 现在自动朗读整体下线（mediafull.js 的 AUTO_READ=false），旧断言（「手势解锁后
 * 自动读首屏卡」「滚动跟随换读」）与产品口径相反，留着只会误导。
 *
 * 本脚本守的是「下线后不能死灰复燃」：
 *   ① 开关状态：autoRead=false、autoFollow.on=false
 *   ② 老设备残留：init 里预置 yrb_autospeak="1"，加载后必须被清掉
 *   ③ 真人环境（伪装 webdriver=false + 真手势）滑停 → 零 /yrbtts 请求
 *   ④ 手动点卡片 🔊 → 正常发起请求（朗读功能本身还在）
 *
 * 跑法：先起 8796（源码站），node tests/diag/autospeak-live.js
 *      完整版回归见 tests/diag/noautoread_test.js
 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = process.env.YRB_SITE || "http://127.0.0.1:8796/yurenbang-app.html";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(x => require("fs").existsSync(x));
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); }
}
const FEED = [
  { id: 90001, title: "孩子不爱写作业怎么办", text: "试了好多办法都没用，请有经验的家长支支招。", type: "img", user: "测试家长", tag: "求助", likes: 0, favs: 0, helps: 0, comments: [] },
  { id: 90002, title: "两岁孩子挑食怎么破", text: "每顿饭都要追着喂，愁死了。", type: "img", user: "另一位家长", tag: "求助", likes: 0, favs: 0, helps: 0, comments: [] },
];
const STUB = () => {
  function makeWav() {
    const sr = 8000, n = sr * 5;
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
      try {
        const q = (url.split("?")[1] || "").split("&").filter(x => /^t=/.test(x))[0].slice(2);
        window.__tts.push(decodeURIComponent(q).slice(0, 20));
      } catch (e) { window.__tts.push("?"); }
      return Promise.resolve(new Response(makeWav(), { status: 200 }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','1');}catch(e){}" +       /* 模拟老设备残留 */
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +   /* 伪装真人 */
    "(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));

  await p.goto(SITE + "?as=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1500);

  const st = await p.evaluate(() => ({
    autoRead: (() => { try { return YRB_MEDIAFULL.autoRead.enabled(); } catch (e) { return "?"; } })(),
    follow: (() => { try { return YRB_MEDIAFULL.autoFollow.state().on; } catch (e) { return "?"; } })(),
    pill: !!document.getElementById("mfAuto"),
    store: (() => { try { return localStorage.getItem("yrb_autospeak"); } catch (e) { return "?"; } })(),
    ver: (() => { try { return YRB_MEDIAFULL.version; } catch (e) { return "?"; } })(),
  }));
  console.log("  · mediafull v" + st.ver);
  ck("① autoRead 开关 = 关", st.autoRead === false, JSON.stringify(st));
  ck("② 跟读状态不启用", st.follow === false);
  ck("③ 跟读胶囊不注入", st.pill === false);
  ck("④ 残留 yrb_autospeak=\"1\" 已被清", st.store === null, st.store);

  /* 真手势解锁 + 渲染信息流 + 滚动停稳：自动朗读最容易被触发的路径 */
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.evaluate(list => { try { S.posts = list; renderFeed(); } catch (e) {} }, FEED);
  await p.waitForTimeout(600);
  await p.touchscreen.tap(200, 120).catch(() => {});
  for (let i = 0; i < 4; i++) {
    await p.evaluate(() => { const ph = document.querySelector("#page-home"); if (ph) ph.scrollTop += 260; });
    await p.waitForTimeout(700);
  }
  const afterScroll = await p.evaluate(() => ({
    n: (window.__tts || []).length,
    cards: document.querySelectorAll("#feed .card").length,
    speaking: !!(window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)),
  }));
  ck("⑤ 真人手势 + 滑停 4 次：零朗读请求", afterScroll.n === 0 && afterScroll.speaking === false, afterScroll);

  /* 手动点卡片 🔊：应正常发起（功能没被一起关死） */
  const btn = await p.$("#feed [data-tts]");
  if (btn) { await btn.tap({ force: true }).catch(() => btn.click().catch(() => {})); await p.waitForTimeout(1500); }
  const manual = await p.evaluate(() => ({ n: (window.__tts || []).length, first: (window.__tts || [])[0] || "" }));
  ck("⑥ 手动 🔊 仍可朗读", manual.n > 0, manual);

  ck("⑦ 无页面异常", errs.length === 0, errs.slice(0, 3).join(" | "));
  console.log("==== " + pass + " 通过 / " + fail + " 失败 ====");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("脚本异常:", e.message); process.exit(2); });
