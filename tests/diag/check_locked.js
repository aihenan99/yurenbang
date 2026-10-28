const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 110)));
  await p.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html', { waitUntil: 'load' });
  await p.waitForTimeout(9000);
  const st = await p.evaluate(() => {
    const sp = (typeof S !== 'undefined' && S && S.posts) ? S.posts : [];
    const cloud = sp.filter(x => x.__cloud);
    const locked = [...document.querySelectorAll('.m-locked')];
    return {
      cloudPosts: cloud.length,
      lockedCards: locked.length,
      lockedText: locked[0] ? locked[0].textContent.trim() : '',
      demoSceneShown: document.querySelectorAll('#feed .m-imgs .scene, #feed .m-imgs svg').length
    };
  });
  // 点击未登录提示应弹出登录
  let loginOpened = false;
  try { await p.click('.m-locked', { force: true, timeout: 4000 }); await p.waitForTimeout(700); loginOpened = await p.evaluate(() => !!document.querySelector('#loginSheet.open')); } catch (e) { }
  console.log(JSON.stringify({ st, loginOpened, errs }, null, 1));
  await p.screenshot({ path: 'locked_hint.png' });
  await b.close();
})();
