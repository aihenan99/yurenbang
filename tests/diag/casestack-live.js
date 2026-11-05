/* 案例全屏的系统返回接管（casedit 的 ceHistPush）
   断言：
   J1 双击进全屏 → 历史栈押了占位记录（history.state.yrbCase=1）
   J2 系统返回 → 只退出全屏，查看器仍开着、页面没被退走
   J3 再双击回全屏 → 垫片重新押上
   J4 点 ✕ 关闭查看器 → 垫片还回去（state 不再带 yrbCase）、页面仍在
   J5 全程无脚本错误 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = process.env.YRB_SITE || "http://127.0.0.1:8794/";
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + "  " + JSON.stringify(extra)); }
}
const STUB = () => {
  window.__tts = [];
  const orig = window.fetch;
  window.fetch = function (u) {
    const url = String(u);
    if (url.indexOf("/yrbtts") > -1) {
      window.__tts.push(1);
      return Promise.resolve(new Response(makeWavSrc(), { status: 200 }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
  function makeWavSrc() {
    const sr = 8000, n = sr * 6;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: "audio/wav" });
  }
};
const CASES = [
  { id: "c1", t: "自己的孩子自己爱", by: "测试家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
    content_html: "<h3>自己的孩子自己爱</h3><p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。</p><p>先把自己安顿好，才有余力接住孩子的情绪。</p>", media: [] }
];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +
    "(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));

  const st = () => p.evaluate(() => {
    const v = document.getElementById("viewer");
    return {
      open: v.classList.contains("open"), fs: v.classList.contains("vw-fs"),
      state: JSON.stringify(history.state || null), url: location.href,
      alive: !!document.getElementById("caseGrid")
    };
  });
  async function waitFs(want, ms) {
    try {
      await p.waitForFunction(w => document.getElementById("viewer").classList.contains("vw-fs") === w, want, { timeout: ms || 3000 });
      return true;
    } catch (e) { return false; }
  }

  await p.goto(SITE + "?cs=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);
  await p.evaluate(list => {
    S.posts = []; S.cases = list;
    try { switchTab("cases"); } catch (e) {}
    try { renderCases(); } catch (e) {}
  }, CASES);
  await p.waitForTimeout(700);
  const url0 = p.url();

  /* J1 双击进全屏 */
  await p.locator("#caseGrid .case-card .c-title").first().dblclick({ delay: 40 });
  await waitFs(true, 3000);
  const s1 = await st();
  ck("J1 进全屏且押了占位记录", s1.open && s1.fs && /yrbCase/.test(s1.state), s1);

  /* J2 系统返回 → 只退全屏 */
  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const s2 = await st();
  ck("J2 系统返回 → 退出全屏、查看器仍在", s2.fs === false && s2.open === true, s2);
  ck("J2b 页面没被退走", s2.url === url0 && s2.alive, s2);

  /* J3 再双击正文回全屏 → 垫片重新押上 */
  await p.locator("#viewer .vw-card .yrb-doc-body p").first().dblclick({ delay: 40 });
  await waitFs(true, 3000);
  const s3 = await st();
  ck("J3 再进全屏仍押上垫片", s3.fs && /yrbCase/.test(s3.state), s3);

  /* J4 点 ✕ 关查看器 → 垫片还回 */
  await p.evaluate(() => { const x = document.getElementById("vwX"); if (x) x.click(); });
  await p.waitForTimeout(900);
  const s4 = await st();
  ck("J4 关闭查看器后垫片已还回、页面仍在", !s4.open && !/yrbCase/.test(s4.state) && s4.url === url0 && s4.alive, s4);

  ck("J5 全程无脚本错误", errs.length === 0, errs.join(" | "));
  console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
