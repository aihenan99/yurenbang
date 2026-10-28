const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  await p.goto("http://127.0.0.1:8794/?d="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  const r=await p.evaluate(()=>{
    return {
      typeofRemember: typeof rememberPhone,
      typeofForgot: typeof forgotPhone,
      typeofSessionPhone: typeof sessionPhone,
      acctBlk: !!document.getElementById("acctBlk"),
      acSetName: !!document.getElementById("acSetPwd"),
      meTab: !!document.querySelector('[data-p="me"]')
    };
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
