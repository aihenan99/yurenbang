/* 线上验收：PPT 全屏阅读 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = "https://xn--gmqq09al6z.cn/";
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:410,height:880},serviceWorkers:"block",
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"});
  const p=await ctx.newPage(); const errs=[];
  p.on("pageerror",e=>errs.push(String(e.message).slice(0,140)));
  await p.goto(SITE+"?pl="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(1200);
  /* 找线上真实的 PPT 案例 */
  const found=await p.evaluate(()=>{
    const cs=(window.S&&S.cases||[]).filter(c=>String(c.type).toLowerCase()==="ppt"&&(c.media||[]).some(m=>/\.pptx?$/i.test(m.url||"")));
    if(!cs.length)return {none:true, types:(window.S&&S.cases||[]).map(c=>c.type).slice(0,10)};
    const c=cs[0];
    try{openViewer(c);}catch(e){return {err:String(e.message)};}
    return {name:(c.media.find(m=>/\.pptx?$/i.test(m.url))||{}).name, url:(c.media.find(m=>/\.pptx?$/i.test(m.url))||{}).url.slice(0,60)};
  });
  console.log("PPT案例:", JSON.stringify(found));
  if(found.none){console.log("线上暂无 PPT 案例，仅验证工具栏可用性后结束");await b.close();return;}
  await p.waitForSelector(".vp-tools [data-a='full']",{timeout:30000}).catch(()=>{});
  await p.waitForTimeout(2500);
  const t1=await p.evaluate(()=>({
    full:!!document.querySelector(".vp-tools [data-a='full']"),
    zoom:!!document.querySelector(".vp-tools [data-a='zoom']"),
    rendered:!!document.querySelector(".vp-scroll .vp-fit"),
    num:(document.querySelector(".vp-num")||{}).textContent||""
  }));
  console.log("卡片视图:", JSON.stringify(t1));
  await p.evaluate(()=>{document.querySelector(".vp-tools [data-a='full']").click();});
  await p.waitForTimeout(3000);
  const t2=await p.evaluate(()=>({
    layer:!!document.getElementById("vpFull"),
    fit:!!document.querySelector("#vpFull .vf-fit"),
    fitW:(document.querySelector("#vpFull .vf-fit")||{}).clientWidth||0,
    num:(document.querySelector("#vpFull .vf-num")||{}).textContent||""
  }));
  console.log("全屏层:", JSON.stringify(t2));
  console.log("pageerrors:", errs.length?errs.join(" | "):"无");
  await b.close();
})();
