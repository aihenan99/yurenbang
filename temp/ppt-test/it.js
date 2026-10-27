const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:410,height:880}, deviceScaleFactor:2 });
  const errs=[];
  p.on("pageerror",e=>errs.push("PAGEERR "+e.message));
  p.on("console",m=>{const t=m.text(); if(m.type()==="error"&&!/404/.test(t))errs.push(t.slice(0,200));});
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(1500);
  await p.evaluate(()=>{ if(!document.getElementById("app").classList.contains("hidden")===false) enterApp(); enterApp(); });
  await p.waitForTimeout(600);
  await p.evaluate(()=>{
    S.cases.unshift({t:"开学焦虑怎么办（PPT案例）",by:"周周老师",type:"ppt",kind:"study",
      media:[{kind:"file",url:"/temp/ppt-test/sample_fixed.pptx",name:"开学焦虑手册.pptx"}],
      helps:8,likes:12,favs:5});
    openViewer(S.cases[0]);
  });
  await p.waitForFunction(()=>document.querySelector(".vp-nav"),null,{timeout:30000}).catch(()=>{});
  await p.waitForTimeout(400);
  const r1 = await p.evaluate(()=>({
    nav:!!document.querySelector(".vp-nav"),
    num:(document.querySelector(".vp-num")||{}).textContent,
    fail:!!document.querySelector(".vp-fail"),
    load:!!document.querySelector(".vp-load")
  }));
  console.log("STATE1:",JSON.stringify(r1),"ERRS:",errs.join(" | "));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/i1.png"});
  await p.click(".vp-nav [data-a='next']");
  await p.waitForTimeout(700);
  await p.click(".vp-nav [data-a='next']");
  await p.waitForTimeout(700);
  console.log("NUM3:",await p.$eval(".vp-num",e=>e.textContent));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/i2.png"});
  // 放大
  await p.click(".vp-tools [data-a='zoom']");
  await p.waitForTimeout(400);
  console.log("ZOOM:",await p.$eval(".vp-scroll",e=>e.className));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/i3.png"});
  // 404 降级
  await p.evaluate(()=>{
    S.cases[0].media[0].url="/temp/ppt-test/none.pptx";
    openViewer(S.cases[0]);
  });
  await p.waitForSelector(".vp-fail",{timeout:30000}).catch(()=>{});
  console.log("FALLBACK:",await p.evaluate(()=>!!document.querySelector(".vp-fail")));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/i4.png"});
  await b.close();
})();
