const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html', { waitUntil: 'load' });
  await p.waitForTimeout(7000);
  await p.evaluate(() => { const c = document.querySelector('#feed .card'); S.curPost = +c.dataset.id; renderComments(); openSheet('commentSheet'); });
  await p.waitForTimeout(400);
  await p.click('#cmVoice', { force: true }); await p.waitForTimeout(600);
  await p.click('[data-cap-aud="start"]', { force: true }); await p.waitForTimeout(1600);
  await p.click('[data-cap-aud="stop"]', { force: true }); await p.waitForTimeout(1600);
  await p.click('[data-cap-aud="use"]', { force: true }); await p.waitForTimeout(1500);
  const info = await p.evaluate(() => {
    const post = S.posts.find(x => x.id === S.curPost);
    const c = post.comments[post.comments.length - 1];
    let direct = '';
    try { direct = cmItemHTML(c, post.comments.length - 1); } catch (e) { direct = 'ERR ' + e.message; }
    return {
      comment: JSON.parse(JSON.stringify(c, (k, v) => k === 'url' && typeof v === 'string' ? v.slice(0, 40) : v)),
      hasMedia: Array.isArray(c.media), mediaLen: c.media && c.media.length,
      media0: c.media && c.media[0] ? { kind: c.media[0].kind, urlType: typeof c.media[0].url, urlHead: String(c.media[0].url || '').slice(0, 30) } : null,
      directHasAudio: direct.includes('<audio'),
      directSnippet: direct.slice(0, 260),
      cmListSnippet: document.querySelector('#cmList').innerHTML.slice(0, 260)
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await b.close();
})();
