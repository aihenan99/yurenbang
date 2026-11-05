const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/?probe=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    const log = [];
    document.addEventListener("fullscreenchange", () => log.push("change:" + !!document.fullscreenElement));
    let res = "n/a";
    try {
      const pr = document.documentElement.requestFullscreen();
      await pr; res = "resolved";
    } catch (e) { res = "rejected:" + (e && e.name); }
    await new Promise(r => setTimeout(r, 300));
    return { res, log, now: !!document.fullscreenElement, enabled: document.fullscreenEnabled };
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
