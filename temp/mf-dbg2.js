const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("console",m=>{ if(/mediafull/.test(m.text())) console.log("[page]",m.text()); });
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?dbg2="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(600);
  await p.evaluate(()=>{
    const post={id:8901,mine:false,type:"video",cat:"学习",by:"测试家长",ava:"bear",
      title:"视频全屏测试帖",text:"用于验证",time:"刚刚",
      likes:0,favs:0,helps:0,comments:[],media:[],rm:[]};
    S.posts.unshift(post);
    try{YRB_CLOUD.signedIn=()=>true}catch(e){}
    renderFeed();
  });
  await p.waitForTimeout(700);
  await p.evaluate(()=>{const l=document.querySelector('#feed [data-r23detail="8901"]');l&&l.click();});
  await p.waitForTimeout(800);
  const r=await p.evaluate(()=>{
    const btn=document.querySelector(".r23-dhead .mf-tts");
    const out={btn:!!btn, curPost:window.S&&S.curPost,
      postFound:(S.posts.filter(x=>x.id===S.curPost)[0]||{}).title,
      tts: typeof speechSynthesis!=="undefined"};
    btn&&btn.click();
    return out;
  });
  console.log("pre:",JSON.stringify(r));
  await p.waitForTimeout(500);
  console.log("btn after:", await p.evaluate(()=>(document.querySelector(".r23-dhead .mf-tts")||{}).textContent));
  await b.close();
})();
