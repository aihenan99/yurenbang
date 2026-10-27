const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true });
  p.on("pageerror", e => console.log("PAGEERR:", String(e).slice(0, 100)));
  await p.goto("http://127.0.0.1:8796/yurenbang-app.html?dbg=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const out = await p.evaluate(async () => {
    const splash = document.querySelector("#splash");
    let splashVisible = !!(splash && !splash.classList.contains("hidden"));
    if (splashVisible) splash.click();
    await new Promise(r => setTimeout(r, 600));
    document.querySelector('#cuTypes .seg-btn[data-t="doc"]').click();
    await new Promise(r => setTimeout(r, 300));
    const paper = document.querySelector("#cePaper");
    const r1 = paper.focus();
    await new Promise(r => setTimeout(r, 50));
    const ae1 = document.activeElement && (document.activeElement.id || document.activeElement.tagName);
    paper.innerHTML = "<p>标题文字</p>";
    const h = paper.querySelector("p");
    const range = document.createRange(); range.selectNodeContents(h);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    const ae2 = document.activeElement && (document.activeElement.id || document.activeElement.tagName);
    let boldRet = "n/a";
    try { boldRet = String(document.execCommand("bold", false, null)); } catch (e) { boldRet = "throw:" + e; }
    await new Promise(r => setTimeout(r, 80));
    return {
      splashVisible,
      activeAfterFocus: ae1,
      activeAfterSelect: ae2,
      boldRet,
      boldWorked: !!paper.querySelector("p b, p strong"),
      paperHidden: paper.offsetParent === null,
      cePanelHidden: document.querySelector("#cePanel").hidden,
      paperCE: paper.getAttribute("contenteditable")
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
