/* 真实录制（视频/语音）与完整发布链路验证 —— 使用 Chrome 虚拟摄像头/麦克风 */
const { chromium } = require('playwright-core');
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const URL='http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const PHOTO='E:/育人帮/temp/home_final.png';
const ARGS=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'];

(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true,args:ARGS});
  const ctx=await b.newContext({viewport:{width:430,height:900},permissions:['camera','microphone']});
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/workbuddy-cloud-sdk|ERR_(FAILED|CONNECTION_RESET|NAME_NOT_RESOLVED)/.test(m.text()))errors.push('CONSOLE: '+m.text().slice(0,180));});

  await page.route('**/@tencent-ai/workbuddy-cloud-sdk**',r=>r.abort());  /* 本地无外网：验证离线降级 */
  await page.goto(URL,{waitUntil:'load'});
  await page.waitForTimeout(4600);
  const out={};
  out.secureContext = await page.evaluate(()=>window.isSecureContext);
  out.mediaDevices = await page.evaluate(()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia));
  out.recorder = await page.evaluate(()=>typeof window.MediaRecorder!=='undefined');

  /* ---- 1. 图片：真实相册选择 ---- */
  await page.click('#fab'); await page.waitForTimeout(700);
  await page.setInputFiles('#r23Picker input[data-cap-in="album"]',[PHOTO]);
  await page.waitForTimeout(1200);
  out.imgThumbs = await page.evaluate(()=>document.querySelectorAll('#r23Picker .cap-cell img').length);

  /* ---- 2. 视频：真实录制 ---- */
  await page.click('#pubTypes .seg-btn[data-t="video"]'); await page.waitForTimeout(500);
  out.vidIdleUI = await page.evaluate(()=>!!document.querySelector('[data-cap-vid="start"]'));
  await page.click('[data-cap-vid="start"]'); await page.waitForTimeout(1500);
  out.vidLive = await page.evaluate(()=>{const v=document.querySelector('.cap-preview');return !!(v&&v.srcObject);});
  out.vidRecBtn = await page.evaluate(()=>!!document.querySelector('[data-cap-vid="rec"]'));
  await page.click('[data-cap-vid="rec"]',{force:true}); await page.waitForTimeout(2200);
  out.vidRecordingFlag = await page.evaluate(()=>!!document.querySelector('.cap-recflag'));
  await page.click('[data-cap-vid="stop"]',{force:true}); await page.waitForTimeout(1200);
  out.vidDone = await page.evaluate(()=>!!document.querySelector('.cap-rec.done video'));
  out.vidCollect = await page.evaluate(()=>{
    const it=window.YRB_CAPTURE.collect('video');
    return {n:it.length,kind:it[0]&&it[0].kind,size:it[0]&&it[0].blob.size,dur:it[0]&&it[0].dur,mime:it[0]&&it[0].blob.type};
  });
  await page.screenshot({path:'E:/育人帮/temp/v4_video.png'});
  await page.click('[data-cap-vid="use"]'); await page.waitForTimeout(300);

  /* ---- 3. 语音：真实录制 ---- */
  await page.click('#pubTypes .seg-btn[data-t="voice"]'); await page.waitForTimeout(500);
  await page.click('[data-cap-aud="start"]',{force:true}); await page.waitForTimeout(2200);
  out.audRecording = await page.evaluate(()=>!!document.querySelector('.cap-voice.rec'));
  await page.click('[data-cap-aud="stop"]',{force:true}); await page.waitForTimeout(1200);
  out.audDone = await page.evaluate(()=>!!document.querySelector('.cap-voice.done audio'));
  out.audCollect = await page.evaluate(()=>{
    const it=window.YRB_CAPTURE.collect('voice');
    return {n:it.length,kind:it[0]&&it[0].kind,size:it[0]&&it[0].blob.size,dur:it[0]&&it[0].dur,mime:it[0]&&it[0].blob.type};
  });
  await page.screenshot({path:'E:/育人帮/temp/v4_voice.png'});

  /* ---- 4. 发布（语音类型）：本机降级保存 + 真实音频渲染 ---- */
  await page.fill('#r23Title','真实语音求助：孩子不肯独自睡怎么办');
  await page.fill('#pubText','用真实录音上传的求助，验证音频上传与渲染链路。');
  await page.click('#pubGo');
  await page.waitForTimeout(5200);   /* 等审核动画 + 发布完成 */
  out.published = await page.evaluate(()=>{
    const cards=[...document.querySelectorAll('#feed .card')];
    const c=cards[0];
    const audio=c&&c.querySelector('audio');
    return {firstTag:c?c.getAttribute('data-id'):null,hasAudio:!!audio,
            audioSrc:(audio&&audio.getAttribute('src')||'').slice(0,12),
            text:(c&&c.querySelector('.p-text')&&c.querySelector('.p-text').textContent||'').slice(0,20)};
  });
  out.stoppedTracks = await page.evaluate(()=>{
    /* 录制结束后不应残留活动的媒体轨道 */
    return !document.querySelector('.cap-voice.rec');
  });
  await page.screenshot({path:'E:/育人帮/temp/v4_published.png'});

  /* ---- 5. 详情页真实音频 ---- */
  const link=await page.$('#feed .card [data-r23detail]');
  if(link){await link.click();await page.waitForTimeout(900);}
  out.detailAudio = await page.evaluate(()=>!!document.querySelector('#r23Detail.open .r23-dvoice.real audio'));
  await page.screenshot({path:'E:/育人帮/temp/v4_detail.png'});

  out.errors=errors;
  console.log(JSON.stringify(out,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
