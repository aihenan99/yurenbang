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
  const out=await page.evaluate(()=>({
    wxExists:!!document.querySelector('.wx')||!!document.querySelector('#wxI')||!!document.querySelector('#wxC'),
    topbarText:document.querySelector('#topbar').innerText.replace(/\s+/g,' ').trim(),
    date:document.querySelector('#dtTxt').textContent,
    topbarHeight:Math.round(document.querySelector('#topbar').getBoundingClientRect().height)
  }));
  out.errors=errs;
  await page.screenshot({path:'E:/育人帮/temp/no_weather.png'});
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
