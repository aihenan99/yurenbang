const { chromium } = require("./pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block"});
  const p=await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/?m="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(1200);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.evaluate(()=>{
    S.cases=[{t:"自己的孩子自己爱",by:"x",ava:"rabbit",type:"img",helps:0,likes:0,favs:0,
      content_html:"<h2>自己的孩子自己爱</h2><p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。</p><p>先把自己安顿好，才有余力接住孩子的情绪。</p><p>第三段内容在这里继续。</p>",media:[]}];
    try{switchTab("cases")}catch(e){}; try{renderCases()}catch(e){}
  });
  await p.waitForTimeout(800);
  const r=await p.evaluate(()=>{
    const q=s=>document.querySelector(s);
    const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {t:+r.top.toFixed(1),b:+r.bottom.toFixed(1),h:+r.height.toFixed(1)};};
    const paper=q(".c-paper"),type=q(".case-card .c-type"),thumb=q(".case-card .c-thumb"),first=q(".c-paper-t");
    return {thumb:rect(thumb),type:rect(type),paper:rect(paper),first:rect(first),
      paperPad:paper?getComputedStyle(paper).paddingTop:null,
      firstMt:first?getComputedStyle(first).marginTop:null,
      typeFs:type?getComputedStyle(type).fontSize:null};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})();
