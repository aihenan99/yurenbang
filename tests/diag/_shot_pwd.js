const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
(async () => {
  const user = "示例" + Date.now().toString(36).slice(-4);
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true,
    serviceWorkers:"block", userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"});
  const p = await ctx.newPage();
  await p.goto("https://xn--gmqq09al6z.cn/",{waitUntil:"domcontentloaded",timeout:45000});
  await p.waitForTimeout(5000);
  await p.evaluate(()=>YRB_CLOUD.openLogin());
  await p.waitForTimeout(600);
  await p.fill("#lgAcct",user); await p.fill("#lgPwd2","Test12345");
  await p.evaluate(()=>document.getElementById("lgToReg").click());
  await p.waitForTimeout(300);
  await p.evaluate(()=>{const c=document.getElementById("lgCk"); if(c&&c.getAttribute("aria-checked")!=="true")c.click();});
  await p.waitForTimeout(200);
  await p.evaluate(()=>document.getElementById("lgPwdSubmit").click());
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{try{switchTab("me")}catch(e){}});
  await p.waitForTimeout(800);
  await p.evaluate(()=>document.getElementById("clAcct").click());
  await p.waitForTimeout(600);
  await p.screenshot({path:"temp/shot-account-modal.png"});
  await p.evaluate(()=>document.getElementById("clPwd").click());
  await p.waitForTimeout(600);
  await p.screenshot({path:"temp/shot-change-pwd.png"});
  await p.evaluate(async()=>{
    const c=YRB_CLOUD.client, s=await c.auth.getSession();
    const uid=s&&s.data&&s.data.user&&s.data.user.id;
    if(uid)await c.database.from("yb_profiles").delete().eq("user_id",uid);
  });
  console.log("截图完成 | 测试账号:", user);
  await b.close();
})();
