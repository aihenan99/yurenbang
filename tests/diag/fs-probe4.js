const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CASES = [
  { id: "c1", t: "自己的孩子自己爱", by: "测试家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
    content_html: "<h3>自己的孩子自己爱</h3><p>很多家长把全部精力放在孩子身上。</p>", media: [] }
];
const STUB = () => {
  function makeWav() {
    const sr = 8000, n = sr * 6;
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
    if (url.indexOf("/yrbtts") > -1) { window.__tts.push(url.slice(0, 60)); return Promise.resolve(new Response(makeWav(), { status: 200 })); }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
};
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});(" + STUB.toString() + ")();");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/?p4=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate((list) => { S.posts = []; S.cases = list; try { switchTab("cases"); } catch (e) {} try { renderCases(); } catch (e) {} }, CASES);
  await p.waitForTimeout(300);
  const title = await p.$("#caseGrid .case-card .c-title");
  await title.dblclick({ delay: 40 });
  await p.waitForTimeout(1200);
  const a = await p.evaluate(() => ({
    cls: document.getElementById("viewer").className,
    tts: window.__tts.length,
    btn: !!document.querySelector(".vw-head .mf-tts"),
    btnCls: (document.querySelector(".vw-head .mf-tts") || {}).className,
    txt: (document.querySelector("#vwBody .yrb-doc-body") || {}).textContent
  }));
  console.log("after dblclick:", JSON.stringify(a));
  const bres = await p.evaluate(() => {
    window.__tts.length = 0;
    try { YRB_MEDIAFULL.speak("手动测试文本", document.querySelector(".vw-head .mf-tts"), false, "case"); }
    catch (e) { return "throw:" + e.message; }
    return "called";
  });
  await p.waitForTimeout(600);
  console.log("manual speak:", bres, "tts=", await p.evaluate(() => window.__tts.length));
  await b.close();
})();
