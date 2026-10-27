/* 最终全链路本地验证 v2（轮询等待） */
const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const URL='http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const PHOTO='E:/育人帮/temp/home_final.png';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(page,fn,timeout=9000,step=250){
  const t0=Date.now();
  while(Date.now()-t0<timeout){
    if(await page.evaluate(fn))return true;
    await sleep(step);
  }
  return false;
}
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_/.test(m.text()))errors.push('CONSOLE: '+m.text().slice(0,180));});
  await page.goto(URL,{waitUntil:'load'});
  await page.waitForTimeout(7000);
  const out={};
  out.cloudReady = await page.evaluate(()=>window.YRB_CLOUD&&YRB_CLOUD.ready());

  out.feed = await page.evaluate(()=>({
    ids:[...document.querySelectorAll('#feed .card')].map(c=>c.dataset.id),
    cloudCount:[...document.querySelectorAll('#feed .card')].filter(c=>+c.dataset.id>=100000).length
  }));
  await page.screenshot({path:'E:/育人帮/temp/v6_feed.png'});

  /* 未登录发布 → 登录门禁（等待审核动画结束） */
  await page.click('#fab'); await page.waitForTimeout(700);
  await page.setInputFiles('#r23Picker input[data-cap-in="album"]',[PHOTO]);
  await page.waitForTimeout(1200);
  await page.fill('#r23Title','登录门禁：未登录应先登录');
  await page.fill('#pubText','验证未登录时发布求助会先弹出登录面板。');
  await page.click('#pubGo');
  out.loginGate = await until(page,()=>{const s=document.querySelector('#loginSheet');return !!(s&&s.classList.contains('open'));},10000);
  await page.screenshot({path:'E:/育人帮/temp/v6_gate.png'});
  await page.click('#lgX');
  await until(page,()=>!document.querySelector('#loginSheet').classList.contains('open'),5000);
  await until(page,()=>!document.querySelector('#r23Review').classList.contains('open'),5000);
  await page.waitForTimeout(600);

  /* 云端帖的帮忙评论面板 */
  const cards=await page.$$('#feed .card');
  let clicked=false;
  for(const c of cards){
    if(+(await c.getAttribute('data-id'))>=100000){
      const help=await c.$('.pa-help');if(help){await help.click();clicked=true;}
      break;
    }
  }
  out.cloudHelpClicked=clicked;
  out.commentSheet = await until(page,()=>{const s=document.querySelector('#commentSheet');return !!(s&&s.classList.contains('open'));},6000);
  await page.waitForTimeout(1500);
  out.commentErrFree=true;
  await page.screenshot({path:'E:/育人帮/temp/v6_comments.png'});

  /* 刷新后云端帖不重复 */
  await page.reload({waitUntil:'load'});
  await page.waitForTimeout(7500);
  out.afterReload = await page.evaluate(()=>{
    const ids=[...document.querySelectorAll('#feed .card')].map(c=>c.dataset.id);
    return {total:ids.length,unique:new Set(ids).size,cloud:ids.filter(i=>+i>=100000)};
  });
  out.errors=errors;
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
