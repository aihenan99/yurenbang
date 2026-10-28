const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true });
  await p.goto("http://127.0.0.1:8796/yurenbang-app.html?dbg=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const out = await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    paper.innerHTML = "<p>标题文字</p>";
    paper.focus();
    const h = paper.querySelector("h3") || paper.querySelector("p");
    const r = document.createRange(); r.selectNodeContents(h);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    let v1 = String(document.queryCommandValue("formatBlock") || "");
    let r1 = document.execCommand("bold", false, null);
    let after1 = paper.querySelector("p b, p strong") ? "yes" : "no";
    let sel = window.getSelection();
    return {
      focusIsPaper: document.activeElement === paper,
      selAnchorInPaper: s.anchorNode ? paper.contains(s.anchorNode) : false,
      selText: String(s),
      formatBlock: v1,
      boldRet: String(r1),
      afterBold: after1,
      hasCeBar: !!document.querySelector("#ceBar")
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
