const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 470, height: 940 } })).newPage();
  p.on('response', r => { if (r.url().includes('8766')) console.log('RESP', r.status(), r.url().slice(0, 70)); });
  await p.goto('http://127.0.0.1:8765/temp/wf.html', { waitUntil: 'load' });
  await p.waitForTimeout(4000);
  console.log('frames:', p.frames().map(f => f.url().slice(0, 70)));
  await b.close();
})();
