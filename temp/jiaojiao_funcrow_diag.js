/* 诊断：#funcrow 的实际渲染状态、chip 是否被后续渲染覆盖 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const t of [300, 800, 1500, 3000]) {
    await page.waitForTimeout(t === 300 ? 300 : t - (t === 800 ? 300 : t === 1500 ? 800 : 1500));
    const info = await page.evaluate(() => {
      const row = document.querySelector("#funcrow");
      const chip = row && row.querySelector(".jj-chip");
      const cs = row ? getComputedStyle(row) : null;
      const chipCs = chip ? getComputedStyle(chip) : null;
      return {
        rowExists: !!row,
        rowChildren: row ? [...row.children].map(c => c.className.split(" ").slice(0, 3).join(".") + "|" + (c.textContent || "").trim().slice(0, 8)) : null,
        rowDisplay: cs && cs.display, rowVis: cs && cs.visibility, rowH: row && row.getBoundingClientRect().height,
        chip: !!chip,
        chipDisplay: chipCs && chipCs.display, chipPos: chipCs && chipCs.position,
        chipW: chip ? chip.getBoundingClientRect().width : 0,
        parentScrollW: row && row.parentElement ? row.parentElement.getBoundingClientRect().width : 0
      };
    });
    console.log(JSON.stringify(info));
  }
  await browser.close();
})();
