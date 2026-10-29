/* 诊断3：SDK 动态加载（unpkg 备用源）+ 登录面板打开 + 会话探测 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const logs=[];
  page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error')logs.push('CONSOLE: '+m.text().slice(0,200));});
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(6500);   /* 等待 SDK 双源加载 */
  const out={};
  out.sdkGlobal = await page.evaluate(()=>{const W=window.WorkBuddyCloud;return W?Object.keys(W).slice(0,8):null;});
  out.cloudEnabled = await page.evaluate(()=>window.YRB_CLOUD&&YRB_CLOUD.enabled());
  out.cloudReady = await page.evaluate(()=>window.YRB_CLOUD&&YRB_CLOUD.ready());
  out.accountRow = await page.evaluate(()=>{const r=document.querySelector('#clAcct');return r?r.textContent.replace(/\s+/g,' ').trim():null;});

  /* 我的页面 → 登录/注册 → 登录面板 */
  await page.click('[data-p="me"]'); await page.waitForTimeout(500);
  await page.click('#clAcct'); await page.waitForTimeout(900);
  out.loginOpen = await page.evaluate(()=>{const s=document.querySelector('#loginSheet');return !!(s&&s.classList.contains('open'));});
  out.loginFields = await page.evaluate(()=>!!(document.querySelector('#lgPhone')&&document.querySelector('#lgSend')&&document.querySelector('#lgWx')));
  await page.screenshot({path:'E:/育人帮/temp/v5_login.png'});

  /* 会话探测（只读，不发送任何短信） */
  out.sessionProbe = await page.evaluate(async()=>{
    try{
      const r=await window.YRB_CLOUD.client.auth.getSession();
      return {ok:!r.error, session:!!(r&&r.data), err:r.error?(r.error.message||String(r.error)).slice(0,90):null};
    }catch(e){return {ok:false,err:(e&&e.message||'').slice(0,90)};}
  });
  console.log(JSON.stringify(out,null,1));
  console.log('LOGS:',JSON.stringify(logs.filter(l=>!/ERR_NAME|net::/.test(l)),null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
