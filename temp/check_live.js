const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const out = {};
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const path of ['/', '/yurenbang-app', '/a/b/c']) {
    const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 90)));
    const bad = []; p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-34)); });
    await p.goto('https://yurenbang.app.workbuddy.host' + path, { waitUntil: 'load', timeout: 45000 });
    await p.waitForTimeout(4000);
    out[path] = await p.evaluate(() => ({
      url: location.pathname,
      app: !!document.querySelector('#phone'),
      bg: getComputedStyle(document.querySelector('#phone') || document.body).backgroundColor,
      captureLayer: typeof window.YRB_CAPTURE,
      cloud: typeof window.YRB_CLOUD,
      sheets: document.styleSheets.length
    }));
    out[path].bad = bad; out[path].errs = errs;
    // 摄像头提前提示（线上是顶层窗口，权限为询问态 → 点击后应给出权限指引）
    try {
      await p.click('#fab', { timeout: 5000 });
      await p.waitForTimeout(700);
      await p.click('#pubTypes .seg-btn[data-t="video"]', { timeout: 5000 });
      await p.waitForTimeout(600);
      out[path].cameraTab = await p.evaluate(() => ({ warn: !!document.querySelector('.cap-warn'), big: !!document.querySelector('[data-cap-vid="start"]'), syscam: !!document.querySelector('input[capture="environment"][data-cap-in="video"]') }));
    } catch (e) { out[path].cameraErr = String(e).slice(0, 90); }
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
