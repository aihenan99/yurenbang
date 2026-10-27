const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  p.on('requestfailed', r => console.log('FAILED:', r.url().slice(0,80), r.failure() && r.failure().errorText));
  try {
    await p.goto('http://127.0.0.1:8766/yurenbang-app/yurenbang-app.html', { waitUntil: 'load', timeout: 10000 });
    console.log('top-level 8766 OK, title=', await p.title());
  } catch (e) { console.log('top-level 8766 ERR', String(e).slice(0,150)); }
  await b.close();
})();
