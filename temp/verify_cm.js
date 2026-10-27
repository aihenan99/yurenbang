const { chromium } = require('playwright-core');
const CHROME = 'C://Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const b = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 130)));
  const cerr = []; p.on('console', m => { if (m.type() === 'error') cerr.push(m.text().slice(0, 130)); });

  await p.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html', { waitUntil: 'load' });
  await p.waitForTimeout(6500);

  const out = {};
  // 打开帮忙面板
  await p.evaluate(() => { const c = document.querySelector('#feed .card'); S.curPost = +c.dataset.id; renderComments(); openSheet('commentSheet'); });
  await p.waitForTimeout(500);
  out.tools = await p.evaluate(() => [...document.querySelectorAll('#cmTools .cm-tool')].map(b => (b.textContent || '').trim()));
  out.micIcons = await p.evaluate(() => [...document.querySelectorAll('#cmTools .cm-tool')].filter(b => /🎤|🎙/.test(b.textContent || '')).length);

  // ---- 录语音帮忙 ----
  await p.click('#cmVoice', { force: true }); await p.waitForTimeout(700);
  out.capOpenVoice = await p.evaluate(() => !!document.querySelector('#cmCap.open [data-cap-aud="start"]'));
  await p.click('[data-cap-aud="start"]', { force: true }); await p.waitForTimeout(1800);
  out.recording = await p.evaluate(() => !!document.querySelector('[data-cap-aud="stop"]'));
  await p.click('[data-cap-aud="stop"]', { force: true }); await p.waitForTimeout(1800);
  out.hasUseVoice = await p.evaluate(() => !!document.querySelector('[data-cap-aud="use"]'));
  await p.click('[data-cap-aud="use"]', { force: true }); await p.waitForTimeout(1200);
  out.afterVoice = await p.evaluate(() => {
    const post = S.posts.find(x => x.id === S.curPost);
    const last = post.comments[post.comments.length - 1];
    return {
      n: post.comments.length, kind: last && last.kind, dur: last && last.dur,
      hasUrl: !!(last && last.media && last.media[0] && last.media[0].url),
      audioInDom: !!document.querySelector('#cmList .cm-media.cm-real audio'),
      capClosed: !document.querySelector('#cmCap.open')
    };
  });

  // ---- 录视频帮忙 ----
  await p.click('#cmVideo', { force: true }); await p.waitForTimeout(700);
  out.capOpenVideo = await p.evaluate(() => !!document.querySelector('#cmCap.open [data-cap-vid="start"]'));
  await p.click('[data-cap-vid="start"]', { force: true }); await p.waitForTimeout(1500);
  out.vLive = await p.evaluate(() => !!document.querySelector('[data-cap-vid="rec"]'));
  await p.click('[data-cap-vid="rec"]', { force: true }); await p.waitForTimeout(2000);
  await p.click('[data-cap-vid="stop"]', { force: true }); await p.waitForTimeout(1800);
  out.hasUseVideo = await p.evaluate(() => !!document.querySelector('[data-cap-vid="use"]'));
  await p.click('[data-cap-vid="use"]', { force: true }); await p.waitForTimeout(1200);
  out.afterVideo = await p.evaluate(() => {
    const post = S.posts.find(x => x.id === S.curPost);
    const last = post.comments[post.comments.length - 1];
    return {
      n: post.comments.length, kind: last && last.kind, dur: last && last.dur,
      hasUrl: !!(last && last.media && last.media[0] && last.media[0].url),
      videoInDom: !!document.querySelector('#cmList .cm-media.cm-real video')
    };
  });

  out.errs = errs; out.consoleErrs = cerr.slice(0, 4);
  console.log(JSON.stringify(out, null, 1));
  await p.screenshot({ path: 'cm_tools.png' });
  await b.close();
})();
