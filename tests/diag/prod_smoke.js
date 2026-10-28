const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/favicon|Failed to fetch/.test(m.text()))errs.push('CONSOLE: '+m.text().slice(0,130));});
  await page.goto('https://yurenbang.app.workbuddy.host/',{waitUntil:'load'});
  await page.waitForTimeout(9000);
  const out={};
  out.home=await page.evaluate(()=>({cards:document.querySelectorAll('#feed .card').length,
    tabs:[...document.querySelectorAll('#tabbar .tb-item')].map(x=>x.dataset.p),
    cloudReady:!!(window.YRB_CLOUD&&YRB_CLOUD.ready()),signedIn:!!(window.YRB_CLOUD&&YRB_CLOUD.signedIn()),
    who:(window.YRB_CLOUD&&YRB_CLOUD.who())||null}));
  await page.click('.tb-item[data-p="me"]');await page.waitForTimeout(700);
  out.meMenu=await page.evaluate(()=>[...document.querySelectorAll('#meMenu .me-item')].map(x=>x.innerText.split('\n')[0]).slice(0,12));
  await page.click('#mmAdmin');await page.waitForTimeout(1800);
  out.gate=await page.evaluate(()=>({open:document.querySelector('#adLayer').classList.contains('open'),
    text:(document.querySelector('#adBody')||{}).innerText.split('\n').filter(Boolean).slice(0,3).join(' | '),
    hasLoginBtn:!!document.querySelector('#adLogin')}));
  await page.click('#adLogin');await page.waitForTimeout(900);
  out.loginSheet=await page.evaluate(()=>({open:!!document.querySelector('#loginSheet.open'),
    agreeRow:!!document.querySelector('#lgCk'),codeBtn:!!document.querySelector('#lgSend')}));
  out.errors=errs.slice(0,6);
  await page.screenshot({path:'E:/育人帮/temp/prod_admin_gate.png'});
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
