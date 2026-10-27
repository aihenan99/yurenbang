/* 查看「分享网址+二维码」入口位置 */
const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const URL='http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  await page.goto(URL,{waitUntil:'load'});
  await page.waitForTimeout(6000);
  const out={};
  await page.click('.tb-item[data-p="me"]');
  await page.waitForTimeout(900);
  out.menuItems = await page.evaluate(()=>[...document.querySelectorAll('#meMenu .me-item')].map(b=>b.innerText.replace(/\s+/g,' ').trim()));
  out.shareVisibleWithoutScroll = await page.evaluate(()=>{
    const b=document.querySelector('#mmShare');if(!b)return null;
    const r=b.getBoundingClientRect();const pg=document.querySelector('#page-me');
    return {top:Math.round(r.top),viewportH:innerHeight,pageScrollTop:pg?pg.scrollTop:null,inView:r.top>=0&&r.bottom<=innerHeight};
  });
  await page.screenshot({path:'E:/育人帮/temp/where_me.png'});
  /* 滚到菜单底部 */
  await page.evaluate(()=>{const pg=document.querySelector('#page-me');if(pg)pg.scrollTop=pg.scrollHeight;});
  await page.waitForTimeout(500);
  await page.screenshot({path:'E:/育人帮/temp/where_me_scrolled.png'});
  /* 打开分享层 */
  await page.click('#mmShare');
  await page.waitForTimeout(900);
  out.shareLayer = await page.evaluate(()=>{
    const l=document.querySelector('#shareLayer');if(!l)return null;
    const qr=document.querySelector('#slQr');
    return {open:l.classList.contains('open'),url:document.querySelector('#slUrl').textContent,qrSrc:qr&&qr.getAttribute('src'),qrLoaded:qr&&qr.naturalWidth>0};
  });
  await page.screenshot({path:'E:/育人帮/temp/where_share.png'});
  /* 打开独立分享页 */
  const p2=await b.newPage({viewport:{width:430,height:900}});
  await p2.goto('http://127.0.0.1:8765/yurenbang-app/share.html',{waitUntil:'load'});
  await p2.waitForTimeout(1500);
  out.sharePage = await p2.evaluate(()=>({title:document.title,text:document.body.innerText.replace(/\s+/g,' ').slice(0,180)}));
  await p2.screenshot({path:'E:/育人帮/temp/where_sharepage.png'});
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
