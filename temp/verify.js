/* 育人帮功能验证脚本（临时，存于 temp/） */
const { chromium } = require('playwright-core');
(async()=>{
  const browser = await chromium.launch({
    executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    headless:true
  });
  const page = await browser.newPage({viewport:{width:430,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE: '+m.text().slice(0,200));});

  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(4600); /* 等待自动进入 App */

  const checks = await page.evaluate(()=>({
    ball: !!document.querySelector('#a11yBall'),
    search: !!document.querySelector('#a11ySearch'),
    splashElder: !!document.querySelector('#splashElder'),
    micP: !!document.querySelector('#a11yMicP'),
    quickT: !!document.querySelector('#a11yQuickT'),
    age: !!document.querySelector('#r23Age'),
    hotline: !!document.querySelector('#r23Hotline'),
    quickR: !!document.querySelector('#a11yQuickR'),
    feedCards: document.querySelectorAll('#feed .card').length,
    ttsBtns: document.querySelectorAll('[data-tts]').length,
    sciTip: !!document.querySelector('#sciTip'),
    sciNote: !!document.querySelector('#sciNote'),
    ageChips: document.querySelectorAll('#feed .age-chip').length,
    proBadgesFeed: document.querySelectorAll('#feed .pro-badge').length,
  }));
  await page.screenshot({path:'E:/育人帮/temp/verify_home.png'});

  /* 搜索过滤 */
  await page.fill('#a11ySearch','数学');
  await page.waitForTimeout(400);
  const searchVis = await page.evaluate(()=>[...document.querySelectorAll('#feed .card')].filter(c=>c.style.display!=='none').length);
  await page.fill('#a11ySearch','');
  await page.waitForTimeout(200);

  /* 打开适老弹窗 → 开启长辈模式 */
  await page.click('#a11yBall');
  await page.waitForTimeout(500);
  await page.click('#abElder');
  await page.waitForTimeout(300);
  await page.click('#modal [data-x="close"]');
  await page.waitForTimeout(400);
  const elder = await page.evaluate(()=>document.querySelector('#phone').dataset.elder);
  const fsAfterElder = await page.evaluate(()=>document.querySelector('#phone').dataset.fs);
  await page.screenshot({path:'E:/育人帮/temp/verify_elder.png'});

  /* 长辈模式下调大字号冲突检查：关闭长辈后字号恢复 */
  await page.click('#a11yBall');
  await page.waitForTimeout(400);
  await page.click('#abElder');
  await page.waitForTimeout(300);
  const fsRestored = await page.evaluate(()=>document.querySelector('#phone').dataset.fs);

  /* 打开发布面板验证快捷填入 */
  await page.click('#modal [data-x="close"]');
  await page.waitForTimeout(200);
  await page.click('#fab');
  await page.waitForTimeout(600);
  await page.click('#a11yQuickT .a11y-chip');
  await page.waitForTimeout(200);
  const quickFill = await page.evaluate(()=>({
    title: document.querySelector('#r23Title').value,
    bodyLen: document.querySelector('#pubText').value.length
  }));
  /* 紧急程度 → 热线提示 */
  await page.click('#r23Urg .r23-urg[data-u="3"]');
  await page.waitForTimeout(200);
  const hotlineShown = await page.evaluate(()=>document.querySelector('#r23Hotline').classList.contains('show'));
  await page.screenshot({path:'E:/育人帮/temp/verify_publish.png'});

  /* 评论面板快捷温暖语 */
  await page.click('[data-close="publishSheet"]');
  await page.waitForTimeout(400);
  const helpBtns = await page.$$('.pa-help');
  if(helpBtns[0]){ await helpBtns[0].click(); await page.waitForTimeout(600); }
  await page.click('#a11yQuickR .a11y-chip');
  await page.waitForTimeout(200);
  const quickReply = await page.evaluate(()=>document.querySelector('#cmInput').value);
  await page.screenshot({path:'E:/育人帮/temp/verify_comment.png'});

  console.log(JSON.stringify({checks, searchVis, elder, fsAfterElder, fsRestored, quickFill, hotlineShown, quickReply, errors},null,1));
  await browser.close();
})().catch(e=>{console.error('FATAL',e && e.message);process.exit(1);});
