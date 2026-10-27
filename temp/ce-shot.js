/* 截图核对视觉：编辑面板 / 案例列表 / 查看端正文 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:8796/yurenbang-app.html";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC";

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await p.goto(BASE + "?shot=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1400);
  await p.evaluate(() => { const s = document.querySelector("#splash"); if (s && !s.classList.contains("hidden")) s.click(); });
  await p.waitForTimeout(600);

  // 1. 编辑面板（带内容）
  await p.evaluate(async (png) => {
    openSheet("caseUpSheet");
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#cuTypes .seg-btn[data-t="doc"]').click();
    await new Promise(r => setTimeout(r, 400));
    const paper = document.querySelector("#cePaper");
    paper.innerHTML =
      '<p>孩子刚上一年级，最难的其实不是拼音和算术，而是"坐得住"。</p>' +
      '<h3>我们试过的三个办法</h3>' +
      '<p>第一，<b>把作业拆成小块</b>，每次只做十分钟，中间起来喝口水。</p>' +
      '<p>第二，书桌上只留当前要用的东西，其他全部收起来。</p>' +
      '<p>第三，写完一起检查，不急着指出错误，先让他自己找。</p>' +
      '<img src="data:image/png;base64,' + png + '">' +
      '<p style="text-align:center">坚持一个月，明显好转。</p>';
    document.querySelector("#cuTitle").value = "一年级新生怎么坐得住";
    paper.dispatchEvent(new Event("input", { bubbles: true }));
  }, PNG);
  await p.waitForTimeout(700);
  const sheet = await p.$("#caseUpSheet");
  await sheet.screenshot({ path: "E:/育人帮/temp/shot-edit.png" });
  console.log("edit ok");

  // 2. 案例列表（纯文字案例标「图文」）
  await p.evaluate(async (png) => {
    closeSheet("caseUpSheet");
    S.cases.length = 0;
    S.cases.push(
      { t: "一年级新生怎么坐得住", by: "小明妈妈", ava: "animal", type: "img", kind: "study",
        media: [], content_html: "<p>正文</p>", helps: 12, likes: 30, favs: 8 },
      { t: "幼小衔接的三个误区", by: "豆豆爸爸", ava: "rabbit", type: "img", kind: "study",
        media: [{ kind: "img", path: "a.png", url: "data:image/png;base64," + png }], helps: 5, likes: 9, favs: 2 }
    );
    renderCases();
    if (typeof switchTab === "function") switchTab("cases");
    else if (typeof goPage === "function") goPage("cases");
    await new Promise(r => setTimeout(r, 400));
  }, PNG);
  await p.waitForTimeout(500);
  await p.screenshot({ path: "E:/育人帮/temp/shot-list.png" });
  console.log("list ok");

  // 3. 查看端正文
  await p.evaluate(async (png) => {
    S.cases[0].content_html =
      '<p>孩子刚上一年级，最难的其实不是拼音和算术，而是"坐得住"。</p>' +
      '<h3>我们试过的三个办法</h3>' +
      '<p>第一，<b>把作业拆成小块</b>，每次只做十分钟。</p>' +
      '<img data-yrb-media="0"><p style="text-align:center">坚持一个月，明显好转。</p>';
    S.cases[0].media = [{ kind: "img", path: "a.png", url: "data:image/png;base64," + png }];
    renderCases();
    const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
    card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 500));
  }, PNG);
  await p.waitForTimeout(500);
  await p.screenshot({ path: "E:/育人帮/temp/shot-view.png" });
  console.log("view ok");

  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
