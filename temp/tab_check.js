const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|404/.test(m.text()))errs.push('CONSOLE: '+m.text().slice(0,150));});
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(6000);
  const out={};
  out.tabs = await page.evaluate(()=>[...document.querySelectorAll('#tabbar .tb-item, #tabbar #fab')].map(x=>x.id||x.dataset.p));
  out.friendsGone = await page.evaluate(()=>!document.querySelector('#page-friends')&&!document.querySelector('.tb-item[data-p="friends"]'));
  /* 各 tab 逐一点击 */
  for(const p of ['home','msgs','me']){
    await page.click(`.tb-item[data-p="${p}"]`);await page.waitForTimeout(700);
  }
  out.tabSwitchOK = await page.evaluate(()=>document.querySelector('#page-me').classList.contains('active'));
  out.errors=errs;
  await page.click('.tb-item[data-p="home"]');await page.waitForTimeout(500);
  await page.screenshot({path:'E:/育人帮/temp/no_friends_tab.png'});
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
