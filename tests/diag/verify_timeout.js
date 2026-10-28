const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const fs = require('fs');
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const out = {};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 100)));
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  /* 1. 超时保护：把永不返回的 Promise 交进去，必须在期限内抛出 */
  out.timeoutGuard = await p.evaluate(async () => {
    const t0 = Date.now();
    try {
      await window.YRB_CLOUD._debug.withTimeout(new Promise(() => { }), 1200, '测试');
      return { ok: false, note: '未超时（异常）' };
    } catch (e) {
      return { ok: true, ms: Date.now() - t0, message: e.message };
    }
  });

  /* 2. 正常完成不受影响 */
  out.timeoutPass = await p.evaluate(async () => {
    const v = await window.YRB_CLOUD._debug.withTimeout(Promise.resolve('done'), 2000, '测试');
    return v;
  });

  /* 3. 弹窗可关闭 */
  out.closable = await (async () => {
    await p.evaluate(() => window.YRB_CLOUD._debug.showProgress('正在上传素材到云端…'));
    await p.waitForTimeout(300);
    const before = await p.evaluate(() => ({
      open: document.querySelector('#upMask').classList.contains('open'),
      hasX: !!document.querySelector('#upX'),
      note: !!document.querySelector('.up-note'),
      sub: document.querySelector('#upS').textContent
    }));
    await p.click('#upX', { force: true });
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => document.querySelector('#upMask').classList.contains('open'));
    return { before, closedAfterClick: !after };
  })();

  /* 4. 慢网看门狗：20 秒后文案应变为安抚提示 */
  await p.evaluate(() => window.YRB_CLOUD._debug.showProgress('正在上传素材到云端…'));
  await p.evaluate(() => window.YRB_CLOUD._debug.setProgress(1, 1, '已上传'));
  await p.waitForTimeout(23000);
  out.watchdog = await p.evaluate(() => ({
    title: document.querySelector('#upT').textContent,
    sub: document.querySelector('#upS').textContent,
    stillOpen: document.querySelector('#upMask').classList.contains('open')
  }));
  await p.screenshot({ path: 'slow_net.png' });
  await p.evaluate(() => window.YRB_CLOUD._debug.hideProgress());
  await p.waitForTimeout(3000);
  out.afterHide = await p.evaluate(() => ({
    open: document.querySelector('#upMask').classList.contains('open'),
    title: document.querySelector('#upT').textContent
  }));

  out.pageErrors = errs;
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync('timeout_check.json', JSON.stringify(out, null, 1));
  await b.close();
})();
