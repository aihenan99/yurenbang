const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 110)));
  const bad = []; p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-30)); });
  await p.goto('https://yurenbang.app.workbuddy.host/', { waitUntil: 'load', timeout: 45000 });
  await p.waitForTimeout(5000);
  const st = await p.evaluate(() => ({
    url: location.pathname, app: !!document.querySelector('#phone'),
    bg: getComputedStyle(document.querySelector('#phone') || document.body).backgroundColor,
    cloud: window.YRB_CLOUD.state ? 'ok' : typeof window.YRB_CLOUD,
    dbg: !!(window.YRB_CLOUD && window.YRB_CLOUD._debug),
    upX: !!document.querySelector('#upX'),
    posts: (window.S && S.posts ? S.posts.length : 0)
  }));
  // 超时保护在线上环境再验一次
  const t = await p.evaluate(async () => {
    const t0 = Date.now();
    try { await window.YRB_CLOUD._debug.withTimeout(new Promise(() => {}), 1500, '线上测试'); return 'no-timeout'; }
    catch (e) { return (Date.now() - t0) + 'ms / ' + e.message; }
  });
  console.log(JSON.stringify({ st, timeout: t, bad, errs }, null, 1));
  await b.close();
})();
