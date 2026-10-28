const { chromium } = require("../../temp/pw/node_modules/playwright-core");
async function probe(url, label){
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  const errs=[];
  p.on("pageerror",e=>errs.push("PAGEERR "+e.message.slice(0,150)));
  p.on("console",m=>{const t=m.text(); if(m.type()==="error"&&!/net::|404|favicon/.test(t))errs.push("ERR "+t.slice(0,120));});
  await p.goto(url,{waitUntil:"load",timeout:60000});
  await p.waitForTimeout(2500);
  const before = await p.evaluate(()=>({
    splashVisible:(s=>s?getComputedStyle(s).display:"none")(document.querySelector("#splash")),
    appHidden:(s=>s?s.classList.contains("hidden"):"nosplash")(document.querySelector("#app")),
    markers:{app:!!window.YRB_APP,r23:!!window.YRB_R23,jj:!!window.YRB_JJ,cloud:!!window.YRB_CLOUD},
    heal:[...document.querySelectorAll("script[data-heal]")].map(s=>s.dataset.heal)
  }));
  console.log(label,"点按前:",JSON.stringify(before));
  await p.mouse.click(206,450);
  await p.waitForTimeout(1500);
  const after = await p.evaluate(()=>({
    splash:(s=>s?getComputedStyle(s).display:"none")(document.querySelector("#splash")),
    appHidden:(s=>s?s.classList.contains("hidden"):"nosplash")(document.querySelector("#app")),
    chips:[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()).slice(0,3)
  }));
  console.log(label,"点按后:",JSON.stringify(after),"| errs:",errs.join("|").slice(0,300));
  await b.close();
}
(async()=>{
  await probe("http://127.0.0.1:8793/yurenbang-app/yurenbang-app.html","LOCAL");
  await probe("https://xn--gmqq09al6z.cn/","PROD");
})();
