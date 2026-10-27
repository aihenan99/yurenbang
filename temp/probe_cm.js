const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 430, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  const logs = []; p.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 140)); });
  await p.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html', { waitUntil: 'load' });
  await p.waitForTimeout(6000);

  // 打开第一条求助的帮忙面板
  await p.evaluate(() => { const c = document.querySelector('#feed .card'); S.curPost = +c.dataset.id; renderComments(); openSheet('commentSheet'); });
  await p.waitForTimeout(600);

  const before = await p.evaluate(() => { const p = S.posts.find(x => x.id === S.curPost); return { n: p.comments.length, tools: [...document.querySelectorAll('.cm-bar button,.cm-bar input')].map(x => x.id || x.className + '|' + (x.textContent || '').trim()) }; });
  console.log('BEFORE:', JSON.stringify(before));

  // 点 #cmVoice
  await p.click('#cmVoice', { force: true }); await p.waitForTimeout(500);
  const afterV = await p.evaluate(() => { const p = S.posts.find(x => x.id === S.curPost); return { n: p.comments.length, last: p.comments[p.comments.length - 1] }; });
  console.log('AFTER #cmVoice:', JSON.stringify(afterV));

  // 点 #cmVideo
  await p.click('#cmVideo', { force: true }); await p.waitForTimeout(500);
  const afterVd = await p.evaluate(() => { const p = S.posts.find(x => x.id === S.curPost); return { n: p.comments.length, last: p.comments[p.comments.length - 1] }; });
  console.log('AFTER #cmVideo:', JSON.stringify(afterVd));

  // 点 #a11yMicC
  const micInfo = await p.evaluate(() => {
    const m = document.querySelector('#a11yMicC');
    if (!m) return 'no a11yMicC';
    return { text: (m.textContent || '').trim(), title: m.title, visible: m.offsetParent !== null };
  });
  console.log('a11yMicC:', JSON.stringify(micInfo));
  console.log('errcount:', errs.length, 'consoleErr:', logs.length, JSON.stringify(errs.slice(0,3)));
  await b.close();
})();
