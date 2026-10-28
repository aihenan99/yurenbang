/* 发布面板媒体区两项修复的回归测试
   ① 拍照/相册（以及录制区）只在点选「图片/微视频/语音」后出现；打开面板时不预选
   ② 视频/音频播放器在切换类型、关闭面板时立即暂停并清空（浏览器小窗随之收起） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';

const TINY_VIDEO = 'data:video/mp4;base64,AAAAGGZ0eXBpc29tAAAAAGlzb21pc28yAAAA';

async function toastText(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('body > div')].filter(d => /toast/i.test(d.className) && d.offsetParent);
    return els.length ? els[els.length - 1].textContent.trim() : '';
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|ERR_|404|Failed to fetch/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 120)); });
  await ctx.route(/workbuddy-cloud-sdk/, r => r.fulfill({ status: 200, contentType: 'text/plain', body: '/* blocked */' }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  const out = {};

  /* ① 打开发布面板：不预选类型，无拍照/相册，显示提示 */
  await page.click('#fab'); await page.waitForTimeout(900);
  out.open = await page.evaluate(() => ({
    segOn: [...document.querySelectorAll('#pubTypes .seg-btn.on')].map(x => x.dataset.t),
    photoBtns: document.querySelectorAll('#r23Picker .cap-add').length,
    hintText: (document.querySelector('#r23Picker .r23-pick-hint') || {}).innerText || ''
  }));
  await page.screenshot({ path: 'E:/育人帮/temp/pub_open.png' });

  /* ② 点「图片」→ 拍照/相册出现 */
  await page.click('#pubTypes .seg-btn[data-t="img"]'); await page.waitForTimeout(700);
  out.afterImg = await page.evaluate(() => ({
    photoBtns: document.querySelectorAll('#r23Picker .cap-add').length,
    labels: [...document.querySelectorAll('#r23Picker .cap-add .ps')].map(x => x.textContent),
    hintGone: !document.querySelector('#r23Picker .r23-pick-hint')
  }));
  await page.screenshot({ path: 'E:/育人帮/temp/pub_img.png' });

  /* ③ 切到「微视频」→ 拍照/相册消失；注入一个"播放中"的视频模拟已录好的预览 */
  await page.click('#pubTypes .seg-btn[data-t="video"]'); await page.waitForTimeout(700);
  out.afterVideo = await page.evaluate(() => ({
    photoBtns: document.querySelectorAll('#r23Picker .cap-add').length,
    videoUI: !!document.querySelector('#r23Picker .cap-rec')
  }));
  await page.evaluate((src) => {
    const v = document.createElement('video');
    v.src = src; v.controls = true; v.playsInline = true; v.id = 'fakePrev';
    v.style.cssText = 'width:200px;height:110px';
    document.querySelector('#r23Picker').appendChild(v);
    window.__fakePrev = v;
    v.play().catch(() => {});
  }, TINY_VIDEO);
  await page.waitForTimeout(400);
  /* 切到「语音」→ 旧视频必须已暂停且 src 被清空 */
  await page.click('#pubTypes .seg-btn[data-t="voice"]'); await page.waitForTimeout(700);
  out.afterSwitchAway = await page.evaluate(() => {
    const v = window.__fakePrev;
    return {
      paused: v ? v.paused : null,
      srcCleared: v ? (!v.getAttribute('src') && !v.src) : null,
      detached: v ? !v.isConnected : null,
      voiceUI: !!document.querySelector('#r23Picker .cap-voice'),
      playingVideosInPicker: [...document.querySelectorAll('#r23Picker video')].filter(x => !x.paused).length
    };
  });

  /* ④ 播放中直接关面板（✕）→ 视频立即暂停 */
  await page.click('#pubTypes .seg-btn[data-t="video"]'); await page.waitForTimeout(700);
  await page.evaluate((src) => {
    const v = document.createElement('video');
    v.src = src; v.controls = true; v.id = 'fakePrev2';
    document.querySelector('#r23Picker').appendChild(v);
    window.__fakePrev2 = v;
    v.play().catch(() => {});
  }, TINY_VIDEO);
  await page.waitForTimeout(300);
  await page.click('#publishSheet .sh-x'); await page.waitForTimeout(600);
  out.afterClose = await page.evaluate(() => {
    const v = window.__fakePrev2;
    return { paused: v ? v.paused : null, srcCleared: v ? !v.getAttribute('src') : null };
  });

  /* ⑤ 重新打开：仍是"未选择"状态；不选媒体直接发布 → 新提示 */
  await page.click('#fab'); await page.waitForTimeout(900);
  out.reopen = await page.evaluate(() => ({
    segOn: [...document.querySelectorAll('#pubTypes .seg-btn.on')].length,
    hintBack: !!document.querySelector('#r23Picker .r23-pick-hint'),
    photoBtns: document.querySelectorAll('#r23Picker .cap-add').length
  }));
  await page.fill('#pubText', '测试：孩子写作业拖拉怎么办');
  await page.click('#pubGo'); await page.waitForTimeout(900);
  out.publishToast = await toastText(page);
  out.errors = errs.slice(0, 6);
  await page.screenshot({ path: 'E:/育人帮/temp/pub_toast.png' });

  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
