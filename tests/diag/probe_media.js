/* 诊断：headless 环境下 getUserMedia 是否可用 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const ARGS=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'];
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true,args:ARGS});
  const ctx=await b.newContext({viewport:{width:430,height:900},permissions:['camera','microphone']});
  const page=await ctx.newPage();
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(1000);
  const probe=await page.evaluate(async()=>{
    const r={};
    r.secure=window.isSecureContext;
    r.hasMD=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
    r.hasMR=typeof window.MediaRecorder!=='undefined';
    try{
      const s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640}},audio:true});
      r.video=true;s.getTracks().forEach(t=>t.stop());
    }catch(e){r.video=false;r.videoErr=(e&&e.name||'')+':'+(e&&e.message||'');}
    try{
      const s=await navigator.mediaDevices.getUserMedia({audio:true});
      r.audio=true;s.getTracks().forEach(t=>t.stop());
    }catch(e){r.audio=false;r.audioErr=(e&&e.name||'')+':'+(e&&e.message||'');}
    if(r.hasMR){
      r.mimes=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4","audio/webm;codecs=opus","audio/webm","audio/mp4"]
        .filter(m=>MediaRecorder.isTypeSupported(m));
    }
    return r;
  });
  console.log(JSON.stringify(probe,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
