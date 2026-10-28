/* 钱包面板视觉截图：空态 + 有礼物列表 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const vis = await page.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null); });
  if (vis) { await page.click("#splash"); await page.waitForTimeout(700); }
  await page.click('.tb-item[data-p="me"]'); await page.waitForTimeout(400);
  await page.click('[data-act="memu"][data-t="钱包 · 玫瑰"]'); await page.waitForTimeout(700);
  await page.screenshot({ path: "E:/育人帮/temp/food_wallet_empty.png" });

  /* 造 3 条礼物记录看列表排版 */
  await page.evaluate(() => {
    const rows = [
      { food: "crab", from_name: "乐乐爸爸", seen: false, t: "刚刚" },
      { food: "crayfish", from_name: "小雨妈妈", seen: true, t: "2 小时前" },
      { food: "duck", from_name: "果果奶奶", seen: true, t: "昨天" }
    ];
    document.querySelector("#fdWlGift").textContent = rows.length;
    document.querySelector("#fdWlCnt").textContent = " · 共 3 份";
    document.querySelector("#fdWlList").innerHTML = rows.map((r, i) => {
      const n = { crab: "帝王蟹", crayfish: "麻辣小龙虾", duck: "烤鸭" }[r.food];
      return `<button type="button" class="fd-in-item ${r.seen ? "" : "new"}" data-fd-replay="${i}" data-fd-food="${r.food}" data-fd-from="${r.from_name}">
        <img src="assets/gifts/${r.food}.webp" alt="">
        <span class="fd-in-m"><b>${r.from_name} 请你吃了「${n}」</b><span>${r.t}${r.seen ? "" : " · 新"}</span></span>
        <span class="fd-again">▶ 再看</span></button>`;
    }).join("");
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "E:/育人帮/temp/food_wallet_list.png" });
  console.log("ok");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
