const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport: { width: 390, height: 800 } });
  await p.goto("http://127.0.0.1:8791/yurenbang-app.html", { waitUntil: "load" });
  await p.waitForSelector("#feed .card", { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => document.getElementById("phone").setAttribute("data-elder", "1"));
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const opt = document.querySelector("#page-jiaojiao .jj-opt");
    const rules = [];
    for (const sh of document.styleSheets) {
      try {
        for (const r of sh.cssRules) {
          if (r.selectorText && r.selectorText.includes(".jj-opt") && r.style && r.style.fontSize)
            rules.push(r.selectorText + " -> " + r.style.fontSize);
        }
      } catch (e) {}
    }
    return { fs: getComputedStyle(opt).fontSize, rules, inPhone: !!opt.closest("#phone") };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
