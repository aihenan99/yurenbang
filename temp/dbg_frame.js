const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 470, height: 940 } })).newPage();
  p.on('console', m => console.log('CONSOLE:', m.text().slice(0, 120)));
  const wrapper = `<meta charset="utf-8"><body style="margin:0"><iframe src="http://127.0.0.1:8766/yurenbang-app/yurenbang-app.html" style="width:430px;height:860px;border:0"></iframe></body>`;
  await p.route('**/wrapper3.html', r => r.fulfill({ contentType: 'text/html', body: wrapper }));
  await p.goto('http://127.0.0.1:8765/wrapper3.html', { waitUntil: 'load' });
  await p.waitForTimeout(4000);
  console.log('page url', p.url());
  console.log('frames', p.frames().map(f => f.url()));
  await b.close();
})();
