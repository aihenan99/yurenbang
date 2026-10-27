const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const B='http://127.0.0.1:8766';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const errs=[],fails=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text().slice(0,140));});
  page.on('response',r=>{if(r.status()>=400)fails.push(r.status()+' '+r.url().replace(B,''));});
  const out={};
  await page.goto(B+'/',{waitUntil:'load'});
  await page.waitForTimeout(8000);
  out.app = await page.evaluate(()=>({
    title:document.title,
    active:!document.querySelector('#app').classList.contains('hidden'),
    cards:document.querySelectorAll('#feed .card').length,
    cloudReady:!!(window.YRB_CLOUD&&YRB_CLOUD.ready()),
    cloudClient:!!(window.YRB_CLOUD&&YRB_CLOUD.client),
    cloudPosts:[...document.querySelectorAll('#feed .card')].filter(c=>+c.dataset.id>=100000).length,
    manifest:(document.querySelector('link[rel=manifest]')||{}).href,
    sw:!!navigator.serviceWorker.controller||'registering'
  }));
  /* 分享层：网址是否为新域名 + 二维码是否加载 */
  await page.click('.tb-item[data-p="me"]');await page.waitForTimeout(800);
  await page.click('#mmShare');await page.waitForTimeout(1000);
  out.share = await page.evaluate(()=>{
    const qr=document.querySelector('#slQr');
    return {url:document.querySelector('#slUrl').textContent,qrLoaded:qr&&qr.naturalWidth>0,qrW:qr&&qr.naturalWidth};
  });
  await page.screenshot({path:'E:/育人帮/temp/deploy_cn_share.png'});
  /* share.html */
  const p2=await b.newPage({viewport:{width:430,height:900}});
  await p2.goto(B+'/share.html',{waitUntil:'load'});await p2.waitForTimeout(1200);
  out.sharePage = await p2.evaluate(()=>({shown:document.querySelector('#u').textContent,img:document.querySelector('.qr').naturalWidth}));
  await p2.screenshot({path:'E:/育人帮/temp/deploy_cn_sharepage.png'});
  await page.evaluate(()=>document.querySelector('#slBack').click());await page.waitForTimeout(700);
  /* 未登录点发布 → 登录面板 + 协议勾选 */
  await page.click('#fab');await page.waitForTimeout(900);
  await page.click('#pubGo');await page.waitForTimeout(1500);
  out.login = await page.evaluate(()=>({open:document.querySelector('#loginSheet').classList.contains('open'),agree:!!document.querySelector('#lgCk')}));
  out.errors=errs.slice(0,8);out.httpFails=fails.slice(0,10);
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
