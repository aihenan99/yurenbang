const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const path = require("path");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0,150)));
  const f = "file:///" + path.resolve("恢复清单-额度刷新当天.html").replace(/\\/g, "/");
  await p.goto(encodeURI(f), { waitUntil: "load" });
  const r = await p.evaluate(() => ({
    prog: document.getElementById("prog").textContent,
    progEm: document.getElementById("progEm").textContent,
    gates: document.querySelectorAll(".gates > div").length,
    emSteps: document.querySelectorAll("#emergency .step").length,
    boxTotal: document.querySelectorAll("input[type=checkbox]").length,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    footer: document.querySelector("footer").innerText.replace(/\s+/g," "),
  }));
  // 勾一个应急项，确认主进度不被污染
  await p.click("#e2");
  const after = await p.evaluate(() => ({
    prog: document.getElementById("prog").textContent,
    progEm: document.getElementById("progEm").textContent,
    e2Done: document.getElementById("e2").closest(".step").classList.contains("done"),
  }));
  console.log(JSON.stringify({ ...r, after, errs }, null, 2));
  await p.screenshot({ path: "temp/_checklist_preview.png", fullPage: true });
  await b.close();
})();
