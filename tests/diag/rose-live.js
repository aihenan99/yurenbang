/* 线上玫瑰层验收：真实站点上点赞是否送玫瑰 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = "https://xn--gmqq09al6z.cn/";
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"});
  const p=await ctx.newPage();
  const errs=[]; p.on("pageerror",e=>errs.push(String(e.message).slice(0,120)));
  await p.goto(SITE+"?live="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(1200);
  const base=await p.evaluate(()=>({
    rose:!!window.YRB_ROSE, build:(YRB_UPGRADE&&YRB_UPGRADE.build)||"",
    layers:YRB_HEALTH?YRB_HEALTH.status().total:0, ok:YRB_HEALTH?YRB_HEALTH.status().ok:0
  }));
  console.log("基础:", JSON.stringify(base));
  await p.evaluate(()=>{document.getElementById("gift").classList.remove("open");});
  await p.evaluate(()=>{ const c=document.querySelector("#feed .card"); const b=c&&c.querySelector('[data-act="like"]'); if(b)b.click(); });
  await p.waitForTimeout(600);
  const r=await p.evaluate(()=>({
    open:document.getElementById("gift").classList.contains("open"),
    n:document.querySelectorAll("#gift .yr-roses .yr-r").length,
    sub:(document.getElementById("gSub")||{}).textContent||"",
    out:YRB_ROSE?YRB_ROSE.out().length:0
  }));
  console.log("点赞后:", JSON.stringify(r));
  console.log("pageerrors:", errs.length?errs.join(" | "):"无");
  await b.close();
})();
