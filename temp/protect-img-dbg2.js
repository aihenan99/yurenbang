const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?img2="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(600);
  const prep=await p.evaluate(()=>{
    const p0=S.posts[0];
    p0.type="img"; p0.media=[{kind:"img",url:"assets/icon-192.png"}];
    p0.rm=[{url:"assets/icon-192.png"}];
    try{ renderFeed(); }catch(e){ return {err:String(e.message)}; }
    return {id:p0.id, type:p0.type};
  });
  console.log("准备:", JSON.stringify(prep));
  await p.waitForTimeout(700);
  const open=await p.evaluate(()=>{
    const c=document.querySelector('#feed .card[data-id="'+S.posts[0].id+'"]')||document.querySelector("#feed .card");
    if(!c) return {noCard:true};
    c.click(); return {clicked:true};
  });
  await p.waitForTimeout(1000);
  const dom=await p.evaluate(()=>{
    const d=document.getElementById("r23Detail");
    const di=document.querySelector("#r23Detail .di");
    const im=document.querySelector("#r23Detail img");
    const r=di?di.getBoundingClientRect():null;
    return {open:d?d.classList.contains("open"):null, di:!!di, img:!!im,
      pe: im?getComputedStyle(im).pointerEvents:"", 
      box:r?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)}:null};
  });
  console.log("详情:", JSON.stringify(dom), "open:", JSON.stringify(open));
  if(dom.box && dom.box.w>0){
    await p.mouse.click(dom.box.x, dom.box.y);
    await p.waitForTimeout(700);
    const v=await p.evaluate(()=>({viewer:document.getElementById("r23Viewer").classList.contains("open"), big:!!document.querySelector("#r23Big img")}));
    console.log("点图后:", JSON.stringify(v));
  }
  await b.close();
})();
