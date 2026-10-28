const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'block'});
  const page=await ctx.newPage();
  await ctx.route(/workbuddy-cloud-sdk/,r=>r.fulfill({status:200,contentType:'text/plain',body:'/* blocked */'}));
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(3500);
  await page.click('#fab');await page.waitForTimeout(900);
  await page.fill('#pubText','测试：孩子写作业拖拉怎么办');
  await page.click('#pubGo');await page.waitForTimeout(500);
  const r=await page.evaluate(()=>({
    toast:document.querySelector('#toast').textContent,
    toastShown:document.querySelector('#toast').classList.contains('show'),
    confirmOpen:document.querySelector('#r23Confirm').classList.contains('open')
  }));
  console.log(JSON.stringify(r));
  await page.screenshot({path:'E:/育人帮/temp/pub_toast2.png'});
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
