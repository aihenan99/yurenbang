/* 线上验收：视频全屏按钮 / 朗读按钮 / 案例图片放大 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = "https://xn--gmqq09al6z.cn/";
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"});
  const p=await ctx.newPage(); const errs=[];
  p.on("pageerror",e=>errs.push(String(e.message).slice(0,120)));
  await p.goto(SITE+"?mfl="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(1200);
  const base=await p.evaluate(()=>({
    layer:!!window.YRB_MEDIAFULL,
    ok:(YRB_HEALTH&&YRB_HEALTH.status().ok)||0,
    total:(YRB_HEALTH&&YRB_HEALTH.status().total)||0,
    guard:document.documentElement.classList.contains("yrb-guard")
  }));
  console.log("基础:",JSON.stringify(base));
  /* 案例查看器：打开一个案例 */
  const cs=await p.evaluate(()=>{
    const c=(S.cases||[])[1];
    try{openViewer(c);}catch(e){return{err:String(e.message)};}
    return {t:c.t};
  });
  await p.waitForTimeout(800);
  const vw=await p.evaluate(()=>{
    const tts=document.querySelector(".vw-head .mf-tts");
    let txt="";
    if(tts){tts.click();txt=tts.textContent;}
    return {tts:!!tts,txt,viewer:document.getElementById("viewer").classList.contains("open")};
  });
  console.log("案例朗读:",JSON.stringify(vw));
  await p.evaluate(()=>{YRB_MEDIAFULL&&YRB_MEDIAFULL.stopSpeak();document.getElementById("viewer").classList.remove("open");});
  console.log("pageerrors:",errs.length?errs.join(" | "):"无");
  await b.close();
})();
