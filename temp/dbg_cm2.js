const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html', { waitUntil: 'load' });
  await p.waitForTimeout(7000);
  const pre = await p.evaluate(() => ({ cloud: typeof window.YRB_CLOUD, enabled: !!(window.YRB_CLOUD && YRB_CLOUD.enabled && YRB_CLOUD.enabled()), posts: S.posts.length, firstCloud: !!S.posts[0].__cloud, firstId: S.posts[0].id }));
  console.log('PRE:', JSON.stringify(pre));
  await p.evaluate(() => { const c = document.querySelector('#feed .card'); S.curPost = +c.dataset.id; renderComments(); openSheet('commentSheet'); });
  await p.waitForTimeout(400);
  await p.click('#cmVoice', { force: true }); await p.waitForTimeout(600);
  await p.click('[data-cap-aud="start"]', { force: true }); await p.waitForTimeout(1600);
  await p.click('[data-cap-aud="stop"]', { force: true }); await p.waitForTimeout(1600);
  await p.click('[data-cap-aud="use"]', { force: true }); await p.waitForTimeout(1500);
  const post = await p.evaluate(() => {
    const post = S.posts.find(x => x.id === S.curPost);
    const last = post.comments[post.comments.length - 1];
    return {
      curPost: S.curPost, cloud: !!post.__cloud, n: post.comments.length,
      lastKind: last && last.kind, lastUrl: last && last.media && last.media[0] && last.media[0].url,
      cmListLen: document.querySelector('#cmList').innerHTML.length,
      cmListHasAudio: document.querySelector('#cmList').innerHTML.includes('<audio'),
      sheetOpen: !!document.querySelector('#commentSheet.open'),
      visibleAudio: document.querySelectorAll('#cmList audio').length
    };
  });
  console.log('POST:', JSON.stringify(post));
  await b.close();
})();
