/* 线上验收：内容保护层是否真的在生效 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const SITE = "https://xn--gmqq09al6z.cn/";
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",
    userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"});
  const p=await ctx.newPage(); const errs=[];
  p.on("pageerror",e=>errs.push(String(e.message).slice(0,120)));
  await p.goto(SITE+"?live="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(1200);
  const r=await p.evaluate(()=>{
    const feed=document.querySelector("#feed");
    const menu=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});
    feed.dispatchEvent(menu);
    const cp=new ClipboardEvent("copy",{bubbles:true,cancelable:true});
    feed.dispatchEvent(cp);
    const kd=new KeyboardEvent("keydown",{key:"s",ctrlKey:true,bubbles:true,cancelable:true});
    document.dispatchEvent(kd);
    const img=document.querySelector("#feed img");
    return {
      build:(window.YRB_UPGRADE&&YRB_UPGRADE.build)||"",
      layer:!!window.YRB_PROTECT,
      guard:document.documentElement.classList.contains("yrb-guard"),
      menu:menu.defaultPrevented, copy:cp.defaultPrevented, save:kd.defaultPrevented,
      sel:getComputedStyle(document.querySelector("#feed .card")||document.body).userSelect,
      imgPE: img?getComputedStyle(img).pointerEvents:"无图",
      ok:(window.YRB_HEALTH&&YRB_HEALTH.status().ok)||0,
      total:(window.YRB_HEALTH&&YRB_HEALTH.status().total)||0
    };
  });
  console.log("线上状态:", JSON.stringify(r));
  /* 管理员豁免 */
  const adm=await p.evaluate(()=>{
    try{ YRB_CONSOLE.isAdmin=function(){return true;}; }catch(e){}
    YRB_PROTECT.refresh();
    const menu=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});
    document.querySelector("#feed").dispatchEvent(menu);
    return {guard:document.documentElement.classList.contains("yrb-guard"),
      menu:menu.defaultPrevented,
      sel:getComputedStyle(document.querySelector("#feed .card")||document.body).userSelect};
  });
  console.log("管理员豁免:", JSON.stringify(adm));
  /* 分享面板 */
  const sh=await p.evaluate(()=>{
    try{ YRB_CONSOLE.isAdmin=function(){return false;}; }catch(e){}
    YRB_PROTECT.refresh();
    try{ YRB_CONSOLE.openShare(); }catch(e){}
    const u=document.getElementById("slUrl");
    if(!u) return {no:true};
    const cp=new ClipboardEvent("copy",{bubbles:true,cancelable:true});
    u.dispatchEvent(cp);
    return {open:document.getElementById("shareLayer").classList.contains("open"),
      copy:cp.defaultPrevented, sel:getComputedStyle(u).userSelect,
      link:(u.textContent||"").slice(0,40)};
  });
  console.log("分享面板:", JSON.stringify(sh));
  console.log("pageerrors:", errs.length?errs.join(" | "):"无");
  await b.close();
})();
