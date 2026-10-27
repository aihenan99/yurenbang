/* 线上域名全链路验证（不发送任何短信，仅只读探测） */
const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const LIVE='https://yurenbang.app.workbuddy.host/';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},ignoreHTTPSErrors:true});
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push('CONSOLE: '+m.text().slice(0,200));});
  await page.goto(LIVE,{waitUntil:'load'});
  await page.waitForTimeout(5000);
  const out={};
  out.origin = await page.evaluate(()=>location.origin);
  out.appBooted = await page.evaluate(()=>!!document.querySelector('#splash')||!!document.querySelector('#app'));
  out.cloudReady = await page.evaluate(()=>window.YRB_CLOUD&&YRB_CLOUD.ready());
  out.captureLoaded = await page.evaluate(()=>!!window.YRB_CAPTURE);

  /* 云端帖子（匿名公开读）应出现在首页 */
  await page.waitForTimeout(3000);
  out.feed = await page.evaluate(()=>({
    total:document.querySelectorAll('#feed .card').length,
    cloud:document.querySelectorAll('#feed .card').length?[...document.querySelectorAll('#feed .card')].filter(c=>+c.dataset.id>=100000).map(c=>(c.querySelector('.p-name')||{}).textContent):[]
  }));
  await page.screenshot({path:'E:/育人帮/temp/live_feed.png'});

  /* 登录面板 */
  await page.click('[data-p="me"]'); await page.waitForTimeout(600);
  await page.click('#clAcct'); await page.waitForTimeout(900);
  out.loginOpen = await page.evaluate(()=>{const s=document.querySelector('#loginSheet');return !!(s&&s.classList.contains('open'));});
  await page.screenshot({path:'E:/育人帮/temp/live_login.png'});

  /* 手机号格式校验（不点发送，只测前端校验） */
  await page.fill('#lgPhone','1380013');
  await page.click('#lgSend'); await page.waitForTimeout(600);
  out.phoneErr = await page.evaluate(()=>document.querySelector('#lgPhoneErr').textContent);

  /* 会话探测（只读） */
  out.session = await page.evaluate(async()=>{
    try{const r=await window.YRB_CLOUD.client.auth.getSession();return {ok:!r.error,hasSession:!!(r&&r.data),err:r.error?(r.error.message||'').slice(0,80):null};}
    catch(e){return {ok:false,err:(e&&e.message||'').slice(0,80)};}
  });
  out.errors=errors;
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
