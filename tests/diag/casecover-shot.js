const { chromium } = require("./pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",deviceScaleFactor:3});
  const p=await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/?m="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(1200);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.evaluate(()=>{
    S.cases=[{t:"自己的孩子自己爱",by:"爱河南99",ava:"rabbit",type:"img",helps:0,likes:0,favs:0,
      content_html:"<h2>自己的孩子自己爱</h2><p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。</p><p>先把自己安顿好，才有余力接住孩子的情绪。可以从小事开始：每天留十分钟给自己。</p><p>第三段：长期的自我消耗会变成对孩子的隐性苛责。</p>",media:[]}];
    try{switchTab("cases")}catch(e){}; try{renderCases()}catch(e){}
  });
  await p.waitForTimeout(900);
  const el=await p.$("#caseGrid .case-card");
  await el.screenshot({path:"temp/casecard-zoom.png"});
  await b.close();
})();
