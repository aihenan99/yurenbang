const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await p.goto("http://127.0.0.1:8796/yurenbang-app.html?dbg=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const s = document.querySelector("#splash"); if (s && !s.classList.contains("hidden")) s.click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('#cuTypes .seg-btn[data-t="doc"]').click());
  await p.waitForTimeout(250);
  // 复现主测试 step3 粘贴
  await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    paper.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", '<div><p>你好<b>世界</b></p><img src="data:image/png;base64,iVBORw0KGgo="></div>');
    paper.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(300);
  // 复现主测试 step4
  const r = await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    paper.innerHTML = "<p>标题文字</p><p>正文内容</p>";
    paper.focus();
    const h = paper.querySelector("p");
    const rg = document.createRange(); rg.selectNodeContents(h);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(rg);
    return {
      active: document.activeElement === paper,
      anchorIn: paper.contains(window.getSelection().anchorNode)
    };
  });
  console.log("step4 焦点/选区:", JSON.stringify(r));
  await p.evaluate(() => document.querySelector('#ceBar [data-ce="h3"]').click());
  await p.waitForTimeout(120);
  const r2 = await p.evaluate(() => ({
    h3: !!document.querySelector("#cePaper h3"),
    active: document.activeElement === document.querySelector("#cePaper"),
    anchorIn: document.querySelector("#cePaper").contains(window.getSelection().anchorNode),
    selLen: String(window.getSelection()).length
  }));
  console.log("h3 后状态:", JSON.stringify(r2));
  await p.evaluate(() => document.querySelector('#ceBar [data-ce="center"]').click());
  await p.waitForTimeout(120);
  await p.evaluate(() => {
    const h = document.querySelector("#cePaper h3");
    const paper = document.querySelector("#cePaper");
    paper.focus();
    const rg = document.createRange(); rg.selectNodeContents(h);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(rg);
  });
  await p.evaluate(() => document.querySelector('#ceBar [data-ce="bold"]').click());
  await p.waitForTimeout(150);
  const r3 = await p.evaluate(() => ({
    boldWorked: !!document.querySelector("#cePaper h3 b, #cePaper h3 strong"),
    h3html: (document.querySelector("#cePaper h3") || {}).outerHTML
  }));
  console.log("bold 后:", JSON.stringify(r3));
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
