const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, serviceWorkers:"block" ,
    userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"});
  const p = await ctx.newPage();
  const errs=[]; p.on("pageerror",e=>errs.push(String(e).slice(0,120)));
  await p.goto("https://xn--gmqq09al6z.cn/",{waitUntil:"domcontentloaded",timeout:45000});
  await p.waitForTimeout(6000);
  const s1 = await p.evaluate(()=>({hasSheet:!!document.getElementById("loginSheet"),hasCloud:!!window.YRB_CLOUD, sig: !!(window.YRB_YRB), openLoginType: window.YRB_CLOUD&&typeof YRB_CLOUD.openLogin}));
  await p.evaluate(()=>{try{YRB_CLOUD.openLogin()}catch(e){window.__e=e.message}});
  await p.waitForTimeout(900);
  const s2 = await p.evaluate(()=>({
    sheet: !!document.getElementById("loginSheet"),
    sheetOpen: (document.getElementById("loginSheet")||{}).className,
    ids: ["lgAcct","lgPwd2","lgToReg","lgPwdSubmit","lgSubmit","lgPhone"].map(id=>id+":"+!!document.getElementById(id)),
    err: window.__e||"",
  }));
  console.log(JSON.stringify({s1,s2,errs},null,1));
  await p.screenshot({path:"temp/_dbg_login.png"});
  await b.close();
})();
