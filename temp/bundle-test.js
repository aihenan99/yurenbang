const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  const reqs=[];
  p.on("request",r=>{ const u=new URL(r.url()); if(u.pathname.startsWith("/assets/")||u.pathname.endsWith(".html")) reqs.push(u.pathname); });
  const errs=[];
  p.on("pageerror",e=>errs.push("PAGEERR "+e.message.slice(0,150)));
  p.on("console",m=>{const t=m.text(); if(m.type()==="error"&&!/net::|404|favicon/.test(t))errs.push("ERR "+t.slice(0,120));});
  await p.goto("http://127.0.0.1:8793/deploy-cn/index.html",{waitUntil:"load"});
  await p.waitForTimeout(2500);
  const s1 = await p.evaluate(()=>({
    markers:{app:!!window.YRB_APP,r23:!!window.YRB_R23,jj:!!window.YRB_JJ,gate:!!window.YRB_GATE,cloud:!!window.YRB_CLOUD,food:!!window.YRB_FOOD,access:!!window.YRB_MYLIST,ppt:!!window.YRB_PPT},
    heal:document.querySelectorAll("script[data-heal]").length
  }));
  await p.mouse.click(206,450);
  await p.waitForTimeout(1500);
  const s2 = await p.evaluate(()=>({
    splashHidden:document.getElementById("splash").classList.contains("hidden"),
    chips:[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()),
    thank:!!document.querySelector(".p-thank")
  }));
  const assetReqs = reqs.filter(x=>x.startsWith("/assets/"));
  console.log("功能层标记:",JSON.stringify(s1));
  console.log("点按进入:",JSON.stringify(s2));
  console.log("assets 请求数:",assetReqs.length,"→",assetReqs.join(", "));
  console.log("errs:",errs.join("|").slice(0,300));
  await p.screenshot({path:"E:/育人帮/temp/bundle-home.png"});
  await b.close();
})();
