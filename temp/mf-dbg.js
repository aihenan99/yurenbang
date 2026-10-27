const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?dbg="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(600);
  const r=await p.evaluate(()=>{
    const post={id:8901,mine:false,type:"video",cat:"学习",by:"测试家长",ava:"bear",
      title:"视频全屏测试帖",text:"用于验证视频全屏按钮",time:"刚刚",
      likes:0,favs:0,helps:0,comments:[],
      media:[{kind:"video",url:"assets/icon-192.png"}],rm:[{url:"assets/icon-192.png"}]};
    S.posts.unshift(post);
    try{YRB_CLOUD.signedIn=()=>true}catch(e){}
    renderFeed();
    const card=document.querySelector('#feed .card[data-id="8901"]');
    return {card:!!card, html:(card?card.className:""), 
      videoInCard:!!(card&&card.querySelector("video"))};
  });
  console.log("prep:",JSON.stringify(r));
  await p.evaluate(()=>{const c=document.querySelector('#feed .card[data-id="8901"]');c&&c.click();});
  await p.waitForTimeout(900);
  const r2=await p.evaluate(()=>({
    open:document.getElementById("r23Detail").classList.contains("open"),
    detailHtml:document.getElementById("r23Detail").innerHTML.slice(0,200),
    hasV:!!document.querySelector("#r23Detail video"),
    dhead:!!document.querySelector(".r23-dhead")
  }));
  console.log("after click:",JSON.stringify(r2));
  await b.close();
})();
