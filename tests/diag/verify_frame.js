const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const fs = require('fs');
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const out = {};

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 470, height: 960 }, permissions: ['camera', 'microphone'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto('http://127.0.0.1:8765/temp/wf.html', { waitUntil: 'load' });
  await p.waitForTimeout(3500);
  const f = p.frames().find(x => x.url().includes('8766'));
  if (!f) { out.err = 'frame not found'; console.log(JSON.stringify(out, null, 1)); await b.close(); return; }

  out.env = await f.evaluate(async () => {
    const d = await window.YRB_CAPTURE.diag();
    return { inFrame: d.inFrame, crossOrigin: d.crossOrigin, secure: d.secure, hasMediaDevices: d.hasMediaDevices, camera: d.camera, microphone: d.microphone, live: window.YRB_CAPTURE.live() };
  });

  await f.click('#fab');
  await f.waitForTimeout(800);
  await f.click('#pubTypes .seg-btn[data-t="video"]');
  await f.waitForTimeout(600);
  out.idleWarn = await f.evaluate(() => { const w = document.querySelector('.cap-warn'); return { warn: !!w, text: w ? w.textContent.trim() : '' }; });

  await f.click('[data-cap-vid="start"]', { force: true });
  await f.waitForTimeout(2500);
  out.help = await f.evaluate(() => {
    const h = document.querySelector('.cap-help');
    if (!h) return { shown: false };
    return { shown: true, title: h.querySelector('.cap-help-t').textContent.trim(), why: h.querySelector('.cap-help-w').textContent.trim(), buttons: [...h.querySelectorAll('.cap-help-btn')].map(x => x.textContent.trim()) };
  });
  await p.screenshot({ path: 'frame_video.png', fullPage: false });

  await f.click('[data-cap-help="close"]', { force: true });
  await f.waitForTimeout(400);
  await f.click('#pubTypes .seg-btn[data-t="voice"]');
  await f.waitForTimeout(400);
  await f.click('[data-cap-aud="start"]', { force: true });
  await f.waitForTimeout(2200);
  out.voiceHelp = await f.evaluate(() => { const h = document.querySelector('.cap-help'); return h ? { title: h.querySelector('.cap-help-t').textContent.trim(), buttons: [...h.querySelectorAll('.cap-help-btn')].map(x => x.textContent.trim()) } : { shown: false }; });
  await p.screenshot({ path: 'frame_voice.png' });

  out.pageErrors = errs;
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync('frame_result.json', JSON.stringify(out, null, 1));
  await b.close();
})();
