const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';

(async () => {
  const out = {};
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['camera', 'microphone'] });

  // A. 顶层窗口
  const p1 = await ctx.newPage();
  await p1.goto(BASE, { waitUntil: 'load' });
  await p1.waitForTimeout(1500);
  out.topLevel = await p1.evaluate(async () => {
    const r = { secure: window.isSecureContext, top: window.self === window.top, hasMD: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); r.ok = true; s.getTracks().forEach(t => t.stop()); }
    catch (e) { r.ok = false; r.err = e.name + ': ' + e.message; }
    return r;
  });

  // B. 嵌入 iframe（无 allow 属性）—— 模拟预览面板
  const wrapper = `<!doctype html><meta charset="utf-8"><body style="margin:0">
  <iframe src="${BASE}" style="width:430px;height:880px;border:0"></iframe></body>`;
  const p2 = await ctx.newPage();
  await p2.route('**/wrapper.html', route => route.fulfill({ contentType: 'text/html', body: wrapper }));
  await p2.goto('http://127.0.0.1:8765/wrapper.html', { waitUntil: 'load' });
  await p2.waitForTimeout(2500);
  const frame = p2.frames().find(f => f.url().includes('yurenbang-app.html'));
  out.inIframe = frame ? await frame.evaluate(async () => {
    const r = { secure: window.isSecureContext, top: window.self === window.top, hasMD: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); r.ok = true; s.getTracks().forEach(t => t.stop()); }
    catch (e) { r.ok = false; r.err = e.name + ': ' + e.message; }
    try {
      const st = document.permissionsPolicy || document.featurePolicy;
      r.policy = st && st.allowsFeature ? { camera: st.allowsFeature('camera'), mic: st.allowsFeature('microphone') } : 'n/a';
    } catch (e) { r.policy = 'err'; }
    return r;
  }) : { err: 'frame not found' };

  // C. 在 iframe 里真实点一次「微视频」按钮，看应用自己的提示
  try {
    const fab = await frame.$('#fab');
    if (fab) {
      await fab.click();
      await frame.waitForTimeout(800);
      const vtab = await frame.$('[data-pubtype="video"], .r23-mediatab');
      const tabs = await frame.$$('[data-mtype],[data-pubtype],[data-mediatype]');
      out.tabCount = tabs.length;
      // 直接切到视频类型并点开启摄像头
      await frame.evaluate(() => {
        const t = [...document.querySelectorAll('[data-mtype],[data-pubtype],[data-mediatype]')].find(x => /video/i.test(x.dataset.mtype || x.dataset.pubtype || x.dataset.mediatype || ''));
        if (t) t.click();
      });
      await frame.waitForTimeout(600);
      const btn = await frame.$('[data-cap-vid="open"]');
      if (btn) {
        // 捕获 toast 文本
        await frame.evaluate(() => { window.__toasts = []; const o = window.toast; });
        await btn.click({ force: true });
        await frame.waitForTimeout(1800);
        out.toastText = await frame.evaluate(() => {
          const el = document.querySelector('#toast,.toast');
          return el ? el.textContent.trim() : '(no toast el)';
        });
        out.capHTML = await frame.evaluate(() => { const h = document.querySelector('#r23Picker'); return h ? h.innerHTML.slice(0, 400) : 'none'; });
      } else { out.btnErr = 'open button not found'; }
    } else { out.btnErr = 'fab not found'; }
  } catch (e) { out.clickErr = String(e).slice(0, 200); }

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync('probe_iframe.json', JSON.stringify(out, null, 1));
  await browser.close();
})();
