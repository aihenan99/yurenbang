const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:410,height:880} });
  const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://127.0.0.1:8793/deploy-cn/index.html",{waitUntil:"load"});
  await p.waitForTimeout(1500);
  await p.evaluate(()=>enterApp());
  await p.waitForTimeout(500);
  await p.evaluate(()=>{
    S.cases.unshift({t:"部署包冒烟",type:"ppt",kind:"study",
      media:[{kind:"file",url:"/temp/ppt-test/sample_fixed.pptx",name:"smoke.pptx"}],helps:1,likes:1,favs:1});
    openViewer(S.cases[0]);
  });
  await p.waitForSelector(".vp-nav",{timeout:30000}).catch(()=>{});
  const st = await p.evaluate(()=>({
    nav:!!document.querySelector(".vp-nav"),
    num:(document.querySelector(".vp-num")||{}).textContent||"",
    fail:!!document.querySelector(".vp-fail")}));
  console.log("SMOKE:",JSON.stringify(st),"ERRS:",errs.join("|").slice(0,200));
  await b.close();
})();
