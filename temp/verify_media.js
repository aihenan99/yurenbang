const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const LIVE = 'https://yurenbang.app.workbuddy.host/';
const out = {};

async function openPublish(page) {
  await page.waitForSelector('#fab', { timeout: 8000 });
  await page.click('#fab');
  await page.waitForTimeout(700);
  // 切到「微视频」
  await page.click('#pubTypes .seg-btn[data-t="video"]');
  await page.waitForTimeout(500);
}
async function helpText(page) {
  return page.evaluate(() => {
    const h = document.querySelector('.cap-help');
    if (!h) return null;
    return {
      title: (h.querySelector('.cap-help-t') || {}).textContent || '',
      why: (h.querySelector('.cap-help-w') || {}).textContent || '',
      steps: [...h.querySelectorAll('.cap-help-s li')].map(l => l.textContent.trim()),
      buttons: [...h.querySelectorAll('.cap-help-btn')].map(b => b.textContent.trim()),
      warnShown: !!document.querySelector('.cap-warn')
    };
  });
}

(async () => {
  /* ---------- 场景1：顶层窗口，权限被拒绝 ---------- */
  {
    const b = await chromium.launch({ executablePath: CHROME, headless: true }); // 不加 fake-ui → 默认拒绝
    const ctx = await b.newContext({ viewport: { width: 430, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await p.goto(BASE, { waitUntil: 'load' });
    await openPublish(p);
    // 提前提示条（http 本机属于安全上下文，应不显示 warn）
    out.denied_idle = await p.evaluate(() => ({ warn: !!document.querySelector('.cap-warn'), big: !!document.querySelector('[data-cap-vid="start"]'), syscam: !!document.querySelector('input[capture="environment"][data-cap-in="video"]') }));
    await p.click('[data-cap-vid="start"]', { force: true });
    await p.waitForTimeout(1800);
    out.denied = await helpText(p);
    out.denied_errs = errs;
    await p.screenshot({ path: 'media_denied.png' });
    // 点「返回」应恢复可操作界面
    await p.click('[data-cap-help="close"]', { force: true });
    await p.waitForTimeout(500);
    out.denied_afterClose = await p.evaluate(() => ({ help: !!document.querySelector('.cap-help'), big: !!document.querySelector('[data-cap-vid="start"]') }));
    // 语音面板同样验证
    await p.click('#pubTypes .seg-btn[data-t="voice"]');
    await p.waitForTimeout(500);
    out.voice_idle = await p.evaluate(() => ({ warn: !!document.querySelector('.cap-warn'), audioPick: !!document.querySelector('input[data-cap-in="audio"]') }));
    await p.click('[data-cap-aud="start"]', { force: true });
    await p.waitForTimeout(1800);
    out.voiceDenied = await helpText(p);
    await p.screenshot({ path: 'media_denied_voice.png' });
    await b.close();
  }

  /* ---------- 场景2：跨域 iframe（模拟预览框） ---------- */
  {
    let liveOK = false;
    try {
      const probe = await fetch(LIVE, { method: 'GET' });
      liveOK = probe.ok;
    } catch (e) { liveOK = false; }
    out.liveReachable = liveOK;
    if (liveOK) {
      const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream'] });
      const ctx = await b.newContext({ viewport: { width: 460, height: 900 }, permissions: ['camera', 'microphone'] });
      const p = await ctx.newPage();
      const wrapper = `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe src="${LIVE}" style="width:430px;height:880px;border:0"></iframe></body>`;
      await p.route('**/wrapper.html', r => r.fulfill({ contentType: 'text/html', body: wrapper }));
      await p.goto('http://127.0.0.1:8765/wrapper.html', { waitUntil: 'load' });
      await p.waitForTimeout(4000);
      const f = p.frames().find(x => x.url().includes('workbuddy.host'));
      if (f) {
        out.frameDiag = await f.evaluate(async () => {
          const d = { cross: false };
          try { d.cross = window.top.location.href ? false : true; } catch (e) { d.cross = true; }
          try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); d.ok = true; s.getTracks().forEach(t => t.stop()); }
          catch (e) { d.ok = false; d.err = e.name + ': ' + e.message; }
          return d;
        });
        await openPublish(f);
        await p.waitForTimeout(500);
        await f.click('[data-cap-vid="start"]', { force: true }).catch(() => { });
        await p.waitForTimeout(2000);
        out.frameHelp = await f.evaluate(() => {
          const h = document.querySelector('.cap-help');
          return h ? { title: h.querySelector('.cap-help-t').textContent, buttons: [...h.querySelectorAll('.cap-help-btn')].map(b => b.textContent.trim()) } : null;
        });
        await p.screenshot({ path: 'media_frame.png' });
      } else { out.frameErr = 'frame not found'; }
      await b.close();
    }
  }

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync('media_verify.json', JSON.stringify(out, null, 1));
})();
