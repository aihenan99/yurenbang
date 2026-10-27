const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 110)));
  const bad = []; p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-34)); });
  await p.goto('https://yurenbang.app.workbuddy.host/', { waitUntil: 'load', timeout: 45000 });
  await p.waitForTimeout(10000);
  const st = await p.evaluate(() => {
    const sp = (typeof S !== 'undefined' && S && S.posts) ? S.posts : [];
    const cloud = sp.filter(x => x.__cloud);
    const locked = [...document.querySelectorAll('.m-locked')].map(x => x.textContent.trim().slice(0, 22));
    return {
      url: location.pathname, app: !!document.querySelector('#phone'),
      total: sp.length, cloudPosts: cloud.length,
      lockedCards: locked, sheets: document.styleSheets.length,
      capture: typeof window.YRB_CAPTURE, cloudLayer: typeof window.YRB_CLOUD,
      upX: !!document.querySelector('#upX')
    };
  });
  const t = await p.evaluate(async () => {
    const t0 = Date.now();
    try { await window.YRB_CLOUD._debug.withTimeout(new Promise(() => {}), 1500, '线上测试'); return 'no-timeout'; }
    catch (e) { return (Date.now() - t0) + 'ms 超时保护生效'; }
  });
  console.log(JSON.stringify({ st, timeout: t, bad: bad.slice(0, 5), errs }, null, 1));
  await p.screenshot({ path: 'live_final.png' });
  await b.close();
})();
