/* 线上验收：封面层在线 + 案例网格封面形态 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const SITE = "https://xn--gmqq09al6z.cn/";
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"});
  const p=await ctx.newPage(); const errs=[];
  p.on("pageerror",e=>errs.push(String(e.message).slice(0,120)));
  await p.goto(SITE+"?cvl="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>{
    const th=[...(window.S&&S.cases||[])].slice(0,8).map(c=>{
      const m=(c.media||[])[0]||{};
      return {t:c.t.slice(0,12), type:c.type, kind:m.kind, hasUrl:!!m.url};
    });
    return {
      layer:!!window.YRB_COVER, pptThumb:!!(window.YRB_PPT&&YRB_PPT.thumb),
      ok:(YRB_HEALTH&&YRB_HEALTH.status().ok)||0, total:(YRB_HEALTH&&YRB_HEALTH.status().total)||0,
      cached:Object.keys(JSON.parse(localStorage.getItem("yrb_pptcover_v1")||"{}")).length,
      caseMedia:th,
      gridThumbs:[...document.querySelectorAll("#caseGrid .c-thumb")].slice(0,4).map(t=>({
        img:!!t.querySelector("img.c-photo"), video:!!t.querySelector("video.c-photo"), doc:!!t.querySelector(".c-doc")}))
    };
  });
  console.log(JSON.stringify(r,null,1).slice(0,1200));
  console.log("pageerrors:",errs.length?errs.join(" | "):"无");
  await b.close();
})();
