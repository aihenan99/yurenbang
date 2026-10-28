const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.goto('https://yurenbang.app.workbuddy.host/',{waitUntil:'load'});
  await page.waitForTimeout(400);
  console.log('闪屏H1:',await page.evaluate(()=>(document.querySelector('h1')||{}).textContent));
  await page.waitForTimeout(8000);
  console.log('自动跳转到应用:',page.url().includes('yurenbang-app.html'),'| 应用标题:',await page.title());
  console.log('卡片数:',await page.evaluate(()=>document.querySelectorAll('#feed .card').length));
  console.log('报错:',errs.slice(0,3));
  await page.screenshot({path:'E:/育人帮/temp/live_seo_home.png'});
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
