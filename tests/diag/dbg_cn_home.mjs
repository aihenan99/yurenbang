import fs from 'fs';import path from 'path';import {createRequire} from 'module';import {fileURLToPath} from 'url';
const require=createRequire(import.meta.url);
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const {chromium}=require(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','temp','pw','node_modules','playwright-core'));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
const p=await c.newPage();
p.on('pageerror',e=>console.log('[err]',String(e.message).slice(0,120)));
await p.goto('http://118.89.185.37/',{waitUntil:'domcontentloaded',timeout:40000}).catch(e=>console.log('goto',e.message.slice(0,60)));
await p.waitForTimeout(9000);
console.log('url now:',p.url());
console.log(JSON.stringify(await p.evaluate(()=>({
  title:document.title,
  build:window.YRB_BUILD||'',
  splash:(document.querySelector('#splash')||{}).className,
  app:(document.querySelector('#app')||{}).className,
  cards:document.querySelectorAll('#feed .card').length,
  scripts:[...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')).slice(0,4)
})),null,1));
await b.close();
