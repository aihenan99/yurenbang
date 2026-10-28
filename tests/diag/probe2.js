/* 诊断2：点击「开始拍摄」后发生了什么 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const ARGS=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'];
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true,args:ARGS});
  const ctx=await b.newContext({viewport:{width:430,height:900},permissions:['camera','microphone']});
  const page=await ctx.newPage();
  const logs=[];
  page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  page.on('console',m=>logs.push(m.type()+': '+m.text().slice(0,200)));
  await page.route('**/@tencent-ai/workbuddy-cloud-sdk**',r=>r.abort());
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(4600);
  await page.click('#fab'); await page.waitForTimeout(700);
  await page.click('#pubTypes .seg-btn[data-t="video"]'); await page.waitForTimeout(600);
  const before=await page.evaluate(()=>({
    pubType:window.S&&S.pubType,
    pickerHasStart:!!document.querySelector('[data-cap-vid="start"]'),
    html:document.querySelector('#r23Picker').innerHTML.slice(0,120)
  }));
  await page.click('[data-cap-vid="start"]');
  await page.waitForTimeout(2500);
  const after=await page.evaluate(()=>({
    hasRec:!!document.querySelector('[data-cap-vid="rec"]'),
    hasStop:!!document.querySelector('[data-cap-vid="stop"]'),
    hasPreview:!!document.querySelector('.cap-preview'),
    srcObject:!!(document.querySelector('.cap-preview')&&document.querySelector('.cap-preview').srcObject),
    toast:document.querySelector('#toast')&&document.querySelector('#toast').textContent,
    isRec:!!document.querySelector('.cap-rec.recording'),
    html:document.querySelector('#r23Picker').innerHTML.slice(0,160)
  }));
  console.log(JSON.stringify({before,after,logs:logs.filter(l=>!/workbuddy-cloud|ERR_/.test(l))},null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
