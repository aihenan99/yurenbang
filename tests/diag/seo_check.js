const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|404|Failed to fetch/.test(m.text()))errs.push('CONSOLE: '+m.text().slice(0,120));});
  const out={};
  /* 首页：品牌闪屏 → 自动进入应用 */
  await page.goto('http://127.0.0.1:8765/yurenbang-app/',{waitUntil:'load'});
  await page.waitForTimeout(300);
  out.splash=await page.evaluate(()=>({title:document.title,h1:(document.querySelector('h1')||{}).textContent,hasGoBtn:!!document.querySelector('.go')}));
  await page.waitForTimeout(8000);
  out.redirected=page.url().includes('yurenbang-app.html');
  out.appTitle=await page.title();
  out.cards=await page.evaluate(()=>document.querySelectorAll('#feed .card').length);
  await page.screenshot({path:'E:/育人帮/temp/seo_home.png'});
  /* 分享页 */
  const p2=await ctx.newPage();
  await p2.goto('http://127.0.0.1:8765/yurenbang-app/share.html',{waitUntil:'load'});
  await p2.waitForTimeout(900);
  out.share=await p2.evaluate(()=>({h1:(document.querySelector('h1')||{}).textContent,
    sections:[...document.querySelectorAll('.tips .t')].map(x=>x.textContent),
    qr:document.querySelector('.qr').naturalWidth}));
  await p2.screenshot({path:'E:/育人帮/temp/seo_share.png',fullPage:true});
  out.errors=errs.slice(0,5);
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
