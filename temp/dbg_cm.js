const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html', { waitUntil: 'load' });
  await p.waitForTimeout(6000);
  await p.evaluate(() => { const c = document.querySelector('#feed .card'); S.curPost = +c.dataset.id; renderComments(); openSheet('commentSheet'); });
  await p.waitForTimeout(400);
  // 直接注入一条"真实语音帮忙"看渲染
  const html = await p.evaluate(() => {
    const post = S.posts.find(x => x.id === S.curPost);
    post.comments.push({ user: '测试', kind: 'voice', dur: '00:03', media: [{ kind: 'voice', url: 'blob:http://127.0.0.1:8765/abcdef' }], likes: 0, liked: false });
    renderComments();
    return document.querySelector('#cmList').innerHTML;
  });
  console.log('HAS REAL CLASS:', html.includes('cm-real'), '| HAS AUDIO:', html.includes('<audio'));
  console.log('SNIPPET:', html.slice(0, 400));
  await b.close();
})();
