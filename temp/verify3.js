/* 真实拍摄与上传 · 本地验证（临时脚本，存于 temp/） */
const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const URL='http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const PHOTO='E:/育人帮/temp/home_final.png';

async function shot(name){
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE: '+m.text().slice(0,180));});
  await page.goto(URL,{waitUntil:'load'});
  await page.waitForTimeout(4600);
  await page.screenshot({path:`E:/育人帮/temp/${name}.png`});
  return {b,page,errors};
}

(async()=>{
  const out={};

  /* ---------- A. 云 SDK 不可用：验证真实拍摄 + 本机降级渲染 ---------- */
  {
    const b=await chromium.launch({executablePath:CHROME,headless:true});
    const page=await b.newPage({viewport:{width:430,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE: '+m.text().slice(0,180));});
    await page.route('**/@tencent-ai/workbuddy-cloud-sdk**',r=>r.abort());
    await page.goto(URL,{waitUntil:'load'});
    await page.waitForTimeout(4600);

    out.A_cloudEnabled = await page.evaluate(()=>!!(window.YRB_CLOUD&&YRB_CLOUD.enabled()));
    out.A_captureLoaded = await page.evaluate(()=>!!window.YRB_CAPTURE);

    await page.click('#fab');
    await page.waitForTimeout(700);
    out.A_pickerRealCapture = await page.evaluate(()=>!!document.querySelector('#r23Picker .cap-add')&&!document.querySelector('#r23Picker .r23-pcell'));

    /* 真实选定一张图片 */
    await page.setInputFiles('#r23Picker input[data-cap-in="album"]',[PHOTO,PHOTO]);
    await page.waitForTimeout(1500);
    out.A_thumbs = await page.evaluate(()=>document.querySelectorAll('#r23Picker .cap-cell img').length);
    out.A_collect = await page.evaluate(()=>{
      const items=window.YRB_CAPTURE.collect('img');
      return {n:items.length,kind:items[0]&&items[0].kind,isFile:!!(items[0]&&items[0].blob instanceof Blob),
              size:items[0]&&items[0].blob.size,type:items[0]&&items[0].blob.type};
    });
    await page.screenshot({path:'E:/育人帮/temp/v3_capture.png'});

    /* 填标题正文并发布（云不可用 → 本机保存 + 真实图片渲染） */
    await page.fill('#r23Title','真实拍摄测试：孩子写作业拖拉怎么办');
    await page.fill('#pubText','这是通过真实图片上传的求助内容，用于验证本机降级渲染。');
    await page.click('#pubGo');
    await page.waitForTimeout(1500);
    out.A_firstCardRealImg = await page.evaluate(()=>{
      const c=document.querySelector('#feed .card');
      const img=c&&c.querySelector('img.real-img');
      return {hasCard:!!c,hasRealImg:!!img,src:(img&&img.src||'').slice(0,12)};
    });
    await page.screenshot({path:'E:/育人帮/temp/v3_local_publish.png'});
    out.A_errors=errors;
    await b.close();
  }

  /* ---------- B. 云 SDK 可用：验证登录门禁 ---------- */
  {
    const b=await chromium.launch({executablePath:CHROME,headless:true});
    const page=await b.newPage({viewport:{width:430,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE: '+m.text().slice(0,180));});
    await page.goto(URL,{waitUntil:'load'});
    await page.waitForTimeout(5200);
    out.B_cloudEnabled = await page.evaluate(()=>!!(window.YRB_CLOUD&&YRB_CLOUD.enabled()));
    out.B_signedIn = await page.evaluate(()=>window.YRB_CLOUD.signedIn());
    out.B_accountRow = await page.evaluate(()=>{const r=document.querySelector('#clAcct');return r?r.textContent.replace(/\s+/g,' ').trim():null;});

    await page.click('[data-p="me"]');
    await page.waitForTimeout(600);
    out.B_meMenuAccount = await page.evaluate(()=>{const r=document.querySelector('#clAcct');return !!r;});
    await page.screenshot({path:'E:/育人帮/temp/v3_me.png'});

    /* 未登录发布 → 应弹出登录面板 */
    await page.click('[data-p="home"]');await page.waitForTimeout(400);
    await page.click('#fab');await page.waitForTimeout(700);
    await page.setInputFiles('#r23Picker input[data-cap-in="album"]',[PHOTO]);
    await page.waitForTimeout(1200);
    await page.fill('#r23Title','登录门禁测试');
    await page.fill('#pubText','未登录点发布应当先要求登录。');
    await page.click('#pubGo');
    await page.waitForTimeout(1200);
    out.B_loginSheetOpen = await page.evaluate(()=>{const s=document.querySelector('#loginSheet');return !!(s&&s.classList.contains('open'));});
    await page.screenshot({path:'E:/育人帮/temp/v3_login.png'});

    /* 手机号校验（本地不应发出请求，仅前端校验） */
    await page.fill('#lgPhone','1380013');
    await page.click('#lgSend');
    await page.waitForTimeout(500);
    out.B_phoneErr = await page.evaluate(()=>document.querySelector('#lgPhoneErr').textContent);
    /* 11 位合法号码：本地域名下云端应返回错误，需优雅提示且不崩溃 */
    await page.fill('#lgPhone','13800138000');
    await page.click('#lgSend');
    await page.waitForTimeout(3500);
    out.B_sendErr = await page.evaluate(()=>document.querySelector('#lgErr').textContent);
    out.B_stillAlive = await page.evaluate(()=>!!document.querySelector('#lgSubmit'));
    await page.screenshot({path:'E:/育人帮/temp/v3_login_err.png'});
    out.B_errors=errors;
    await b.close();
  }

  console.log(JSON.stringify(out,null,1));
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
