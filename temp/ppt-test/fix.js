const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const open = (p,url,path,name)=>p.evaluate(a=>{
  S.cases.unshift({t:"测试",type:"ppt",kind:"study",helps:1,likes:1,favs:1,
    media:[{kind:"file",url:a.url,path:a.path,name:a.name}]});
  openViewer(S.cases[0]);
},{url,path,name});
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:410,height:900} });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  p.on("console",m=>{const t=m.text(); if(t.includes("[pptview]")) console.log("  [console]",t.slice(0,220));});
  await p.goto("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html",{waitUntil:"load"});
  await p.waitForTimeout(1200);
  await p.evaluate(()=>enterApp());
  await p.waitForTimeout(300);

  // 1) 带"幽灵声明"的问题文件（模拟 WPS/工具导出）——清洗后应能渲染
  await open(p,"/temp/ppt-test/sample.pptx","case/1-幽灵声明.pptx","");
  await p.waitForSelector(".vp-nav",{timeout:15000}).catch(()=>{});
  console.log("1 幽灵声明文件:", await p.evaluate(()=>({
    nav:!!document.querySelector(".vp-nav"),
    num:(document.querySelector(".vp-num")||{}).textContent,
    title:(document.querySelector(".vp-fail span")||{}).textContent})));
  await p.screenshot({path:"E:/育人帮/temp/ppt-test/f1.png"});

  // 2) 正常文件不受影响
  await open(p,"/temp/ppt-test/sample_fixed.pptx","case/2-正常.pptx","");
  await p.waitForSelector(".vp-nav",{timeout:15000}).catch(()=>{});
  console.log("2 正常文件:", await p.evaluate(()=>({nav:!!document.querySelector(".vp-nav"),num:(document.querySelector(".vp-num")||{}).textContent})));

  // 3) 假 pptx（不是 zip）→ 明确提示
  await open(p,"/temp/ppt-test/fake.pptx","case/3-假文件.pptx","");
  await p.waitForSelector(".vp-fail",{timeout:15000}).catch(()=>{});
  await p.waitForTimeout(300);
  console.log("3 假文件提示:", await p.evaluate(()=>(document.querySelector(".vp-fail i")||{}).textContent));

  // 4) 旧版 .ppt 命名 → 专用提示
  await open(p,"/temp/ppt-test/fake.pptx","case/4-旧版.ppt","");
  await p.waitForTimeout(400);
  console.log("4 旧版ppt提示:", await p.evaluate(()=>(document.querySelector(".vp-fail i")||{}).textContent));

  // 5) 自动播放仍然工作
  await open(p,"/temp/ppt-test/sample_fixed.pptx","case/5-播放.pptx","");
  await p.waitForSelector(".vp-nav",{timeout:15000}).catch(()=>{});
  await p.waitForTimeout(7000);
  console.log("5 自动播放 7s 后:", await p.evaluate(()=>({num:(document.querySelector(".vp-num")||{}).textContent,btn:(document.querySelector("[data-a='play']")||{}).textContent})));
  console.log("ERRS:", errs.join("|").slice(0,200));
  await b.close();
})();
