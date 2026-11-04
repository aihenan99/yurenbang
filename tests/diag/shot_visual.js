const { chromium } = require("./pw/node_modules/playwright-core");
function feedData(n){const t=["孩子不爱写作业怎么办","两岁孩子挑食怎么破","幼儿园分离焦虑","二宝抢玩具打架"];const o=[];
for(let i=0;i<n;i++)o.push({id:95000+i,title:t[i%4],text:"试了好多办法都没用，请有经验的家长支支招。孩子今年刚上幼儿园，每天回家都闷闷不乐，问他也不说。",type:"text",user:"家长"+(i+1),tag:"求助",likes:3+i,helps:i,comments:i%5,time:"1小时前"});return o;}
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p=await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/?s="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(1500);
  await p.evaluate(()=>{try{enterApp();}catch(e){}});
  await p.waitForTimeout(400);
  await p.evaluate(d=>{try{S.posts=d;renderFeed();}catch(e){}},feedData(6));
  await p.waitForTimeout(700);
  await p.screenshot({path:"temp/shot-home.png"});
  await p.evaluate(()=>{document.getElementById("phone").dataset.theme="dark";});
  await p.waitForTimeout(400);
  await p.screenshot({path:"temp/shot-dark.png"});
  await p.evaluate(()=>{document.getElementById("phone").dataset.theme="";});
  await p.evaluate(()=>{document.getElementById("page-home").scrollTo(0,700);});
  await p.waitForTimeout(500);
  await p.screenshot({path:"temp/shot-scrolled.png"});
  console.log("ok");
  await b.close();
})();
