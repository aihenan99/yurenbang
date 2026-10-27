const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?img="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(600);
  const info=await p.evaluate(()=>{
    const all=[...document.querySelectorAll("img")].map(i=>({cls:i.className,src:(i.getAttribute("src")||"").slice(0,40),w:i.width}));
    return {n:all.length, list:all.slice(0,8)};
  });
  console.log("页面 img:", JSON.stringify(info));
  // 构造一条带图帖子，走真实 openDetail 渲染
  const built=await p.evaluate(()=>{
    try{
      const post={
        id:8801, mine:false, type:"img", cat:"学习", by:"测试家长", ava:"bear",
        t:"图片测试帖", body:"用于验证图片点击", time:"刚刚", likes:0, favs:0, helps:0,
        comments:[], media:[{kind:"img", url:"assets/icon-192.png"}],
        imgs:[{url:"assets/icon-192.png"}], rm:[{url:"assets/icon-192.png"}]
      };
      S.posts.unshift(post);
      openDetail(8801);
      return {ok:true};
    }catch(e){ return {ok:false, err:String(e.message)}; }
  });
  console.log("构造:", JSON.stringify(built));
  await p.waitForTimeout(1200);
  const dom=await p.evaluate(()=>{
    const d=document.getElementById("r23Detail");
    const di=document.querySelector("#r23Detail .di");
    const im=document.querySelector("#r23Detail img");
    const r=di?di.getBoundingClientRect():null;
    return {open:d.classList.contains("open"), di:!!di, img:!!im,
      pe: im?getComputedStyle(im).pointerEvents:"", box:r?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),h:Math.round(r.height)}:null,
      html:(d.innerText||"").slice(0,60)};
  });
  console.log("详情 DOM:", JSON.stringify(dom));
  if(dom.box){
    await p.mouse.click(dom.box.x, dom.box.y);
    await p.waitForTimeout(600);
    const v=await p.evaluate(()=>({viewer:document.getElementById("r23Viewer").classList.contains("open"), big:!!document.querySelector("#r23Big img")}));
    console.log("点图后:", JSON.stringify(v));
  }
  await b.close();
})();
