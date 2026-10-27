const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERROR:", String(e.message).slice(0,200)));
  p.on("console", m => { if (m.type()==="error") console.log("CONSOLE-ERR:", m.text().slice(0,200)); });
  p.on("requestfailed", r => console.log("REQFAIL:", r.url().slice(0,110), r.failure() && r.failure().errorText));
  await p.goto("http://127.0.0.1:8791/yurenbang-app.html", { waitUntil: "domcontentloaded" });
  for (const t of [500, 1500, 3000]) {
    await p.waitForTimeout(t === 500 ? 500 : t - 500);
    const s = await p.evaluate(() => ({
      t: document.title,
      cards: document.querySelectorAll("#feed .card").length,
      feedLen: (document.querySelector("#feed")||{}).innerHTML ? document.querySelector("#feed").innerHTML.length : -1,
      fab: !!document.querySelector("#fab"),
      fabBox: (()=>{const e=document.querySelector("#fab");if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];})(),
      phoneH: (document.querySelector("#phone")||{offsetHeight:-1}).offsetHeight,
      splash: !!document.querySelector("#boot,splash,.splash"),
      scripts: [...document.scripts].map(x=>x.src.split("/").pop()).filter(Boolean),
      yrbCloud: typeof window.YRB_CLOUD,
    }));
    console.log("t=" + t + "ms", JSON.stringify(s));
  }
  await b.close();
})();
