/* 补充验证：认证徽标 + favicon */
const { chromium } = require('playwright-core');
(async()=>{
  const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',headless:true});
  const page = await browser.newPage({viewport:{width:430,height:900}});
  const errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,120));});
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(4600);
  /* 帖子3（佐藤花子）的帮忙评论里有心理老师周周 */
  const cards = await page.$$('.card');
  await cards[2].$('.pa-help').then(b=>b.click());
  await page.waitForTimeout(800);
  const pro = await page.evaluate(()=>{
    const names=[...document.querySelectorAll('#cmList .cm-name')].map(n=>n.textContent);
    const badges=document.querySelectorAll('#cmList .pro-badge').length;
    return {names,badges};
  });
  await page.screenshot({path:'E:/育人帮/temp/verify_pro.png'});
  console.log(JSON.stringify({pro,errors},null,1));
  await browser.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
