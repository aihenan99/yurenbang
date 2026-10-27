const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const bad = []; p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-40)); });
  await p.goto('https://yurenbang.app.workbuddy.host/', { waitUntil: 'load', timeout: 45000 });
  await p.waitForTimeout(12000);
  const st = await p.evaluate(() => {
    const sp = (typeof S !== 'undefined' && S && S.posts) ? S.posts : [];
    const cloud = sp.filter(x => x.__cloud);
    const withImg = cloud.filter(x => (x.media || []).some(m => m.url));
    return {
      total: sp.length, cloudPosts: cloud.length,
      withSignedImage: withImg.length,
      titles: cloud.map(x => x.title).slice(0, 4),
      sampleImg: (withImg[0] && withImg[0].media[0].url || '').slice(0, 60)
    };
  });
  console.log(JSON.stringify({ st, bad: bad.slice(0, 6) }, null, 1));
  await b.close();
})();
