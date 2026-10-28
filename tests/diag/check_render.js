const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const results = {};
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const path of ['/', '/yurenbang-app', '/yurenbang-app/', '/a/b/c']) {
    const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 100)));
    const bad = []; p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-40)); });
    await p.goto('http://127.0.0.1:8791' + path, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    results[path] = await p.evaluate(() => ({
      url: location.pathname,
      phone: !!document.querySelector('#phone'),
      styled: getComputedStyle(document.querySelector('#phone') || document.body).backgroundColor,
      fab: !!document.querySelector('#fab'),
      cssLoaded: [...document.styleSheets].length
    }));
    results[path].badResponses = bad;
    results[path].pageErrors = errs;
    await p.close();
  }
  console.log(JSON.stringify(results, null, 1));
  await b.close();
})();
