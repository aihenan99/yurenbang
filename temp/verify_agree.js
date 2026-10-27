/* 登录面板「已阅读并同意协议」勾选 —— 本地验证（桩 SDK，绝不真发短信） */
const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const URL='http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(page,fn,timeout=8000,step=200){
  const t0=Date.now();
  while(Date.now()-t0<timeout){ if(await page.evaluate(fn))return true; await sleep(step); }
  return false;
}
const STUB=()=>{
  window.__PROBE={sendOtp:0,verify:0};
  const q=()=>{const o={select:()=>o,order:()=>o,limit:()=>o,eq:()=>o,then:r=>r({data:[]})};return o;};
  window.WorkBuddyCloud={createWorkBuddyCloud:()=>({
    auth:{
      getSession:async()=>({data:null}),
      sendOtp:async()=>{window.__PROBE.sendOtp++;return {data:{verificationId:'v-test',isExistingUser:false}};},
      verifyOtp:async()=>{window.__PROBE.verify++;return {error:{message:'测试桩：验证码不正确'}};},
      signInWithOAuth:async()=>({data:{url:''}}),
      signOut:async()=>({}),
      onAuthStateChange:()=>{},
      handleWechatWebCallback:async()=>({data:null})
    },
    database:{from:q,select:q},
    storage:{sharedPath:(a,b)=>a+'/'+b,upload:async()=>({data:{path:'x'}}),createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{url:''}})}
  })};
};
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_/.test(m.text()))errors.push('CONSOLE: '+m.text().slice(0,160));});
  await page.addInitScript(STUB);
  await page.goto(URL,{waitUntil:'load'});
  await page.waitForTimeout(5000);
  const out={};

  /* 打开登录面板 */
  await page.evaluate(()=>{ if(window.YRB_CLOUD&&YRB_CLOUD.openLogin)YRB_CLOUD.openLogin(); else {const e=new Event('click');} });
  out.sheetOpen = await until(page,()=>{const s=document.querySelector('#loginSheet');return !!(s&&s.classList.contains('open'));},6000);
  if(!out.sheetOpen){
    /* 兜底：未登录发布触发登录 */
    await page.click('#fab');await page.waitForTimeout(500);await page.click('#pubGo');
    out.sheetOpen = await until(page,()=>document.querySelector('#loginSheet').classList.contains('open'),8000);
  }

  /* 1. 勾选框存在、默认未勾选、位置在验证码框之下 */
  out.agreeUI = await page.evaluate(()=>{
    const c=document.querySelector('#lgCk'),row=document.querySelector('#lgAgree'),code=document.querySelector('#lgCode').closest('.lg-field'),btn=document.querySelector('#lgSubmit');
    if(!c||!row)return null;
    const rc=row.getBoundingClientRect(),rf=code.getBoundingClientRect(),rb=btn.getBoundingClientRect();
    return {
      exists:true,
      text:row.innerText.replace(/\s+/g,''),
      checkedDefault:c.classList.contains('on'),
      aria:c.getAttribute('aria-checked'),
      belowCodeField:rc.top>=rf.bottom-2,
      aboveSubmit:rc.bottom<=rb.top+2,
      docs:[...row.querySelectorAll('.lg-doc')].map(a=>a.textContent)
    };
  });

  /* 2. 未勾选 → 点获取验证码被拦（不发送） */
  await page.fill('#lgPhone','13800000000');
  await page.click('#lgSend');
  await page.waitForTimeout(700);
  out.blockSend = await page.evaluate(()=>({
    err:document.querySelector('#lgErr').textContent,
    probe:window.__PROBE.sendOtp,
    sendBtnDisabled:document.querySelector('#lgSend').disabled,
    shook:document.querySelector('#lgAgree').classList.contains('shake')
  }));
  out.shakeShot = 'E:/育人帮/temp/agree_block.png';
  await page.screenshot({path:out.shakeShot});

  /* 3. 未勾选 → 点登录也被拦 */
  await page.click('#lgSubmit');
  await page.waitForTimeout(500);
  out.blockSubmit = await page.evaluate(()=>({err:document.querySelector('#lgErr').textContent,probe:window.__PROBE.verify}));

  /* 4. 点《育人帮用户协议》→ 协议层打开 */
  await page.click('.lg-doc[data-doc="terms"]');
  out.terms = await until(page,()=>document.querySelector('#lgDoc').classList.contains('open'),4000);
  out.termsInfo = await page.evaluate(()=>({
    open:document.querySelector('#lgDoc').classList.contains('open'),
    title:document.querySelector('#lgDocTitle').textContent,
    len:document.querySelector('#lgDocBody').innerText.length,
    scrollable:document.querySelector('#lgDocBody').scrollHeight>document.querySelector('#lgDocBody').clientHeight
  }));
  await page.screenshot({path:'E:/育人帮/temp/agree_terms.png'});

  /* 5. 点「我已阅读，返回勾选」→ 关闭并自动勾选 */
  await page.click('#lgDocOk');
  await page.waitForTimeout(400);
  out.afterRead = await page.evaluate(()=>({
    docOpen:document.querySelector('#lgDoc').classList.contains('open'),
    checked:document.querySelector('#lgCk').classList.contains('on')
  }));

  /* 6. 手动取消勾选 → 再点登录应被拦 */
  await page.click('#lgCk');
  await page.waitForTimeout(200);
  const unchecked=await page.evaluate(()=>!document.querySelector('#lgCk').classList.contains('on'));
  await page.click('#lgSubmit');
  await page.waitForTimeout(400);
  out.toggleOff = {unchecked, err:(await page.evaluate(()=>document.querySelector('#lgErr').textContent))};

  /* 7. 勾选后 → 获取验证码应放行（桩计数+1）且进入倒计时 */
  await page.click('#lgCk');
  await page.waitForTimeout(200);
  await page.click('#lgSend');
  await page.waitForTimeout(1200);
  out.allowed = await page.evaluate(()=>({
    probe:window.__PROBE.sendOtp,
    btnText:document.querySelector('#lgSend').textContent,
    err:document.querySelector('#lgErr').textContent
  }));

  /* 8. 隐私政策 */
  await page.click('.lg-doc[data-doc="privacy"]');
  await until(page,()=>document.querySelector('#lgDoc').classList.contains('open'),4000);
  out.privacyInfo = await page.evaluate(()=>({
    title:document.querySelector('#lgDocTitle').textContent,
    len:document.querySelector('#lgDocBody').innerText.length
  }));
  await page.screenshot({path:'E:/育人帮/temp/agree_privacy.png'});
  await page.click('#lgDocBack');
  await page.waitForTimeout(400);
  out.afterBack = await page.evaluate(()=>document.querySelector('#lgDoc').classList.contains('open'));

  out.errors=errors;
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
