const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?dbg5="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const post={id:8901,mine:false,type:"video",by:"测试家长",ava:"bear",
      title:"视频全屏测试帖",text:"用于验证",time:"刚刚",likes:0,favs:0,helps:0,comments:[],media:[]};
    S.posts.unshift(post);
    try{YRB_CLOUD.signedIn=()=>true}catch(e){}
    renderFeed();
  });
  await p.waitForTimeout(700);
  await p.evaluate(()=>{const l=document.querySelector('#feed [data-r23detail="8901"]');l&&l.click();});
  await p.waitForTimeout(800);
  const r=await p.evaluate(()=>{
    const btn=document.querySelector(".r23-dhead .mf-tts");
    const out={exists:!!btn};
    if(!btn)return out;
    /* 事件流探测 */
    out.capDoc=false; out.bubBtn=false;
    document.addEventListener("click",e=>{ if(e.target.closest&&e.target.closest(".r23-dhead .mf-tts"))out.capDoc=true; },true);
    btn.addEventListener("click",()=>{out.bubBtn=true;});
    btn.click();
    out.after=btn.textContent;
    /* 按钮是否还是当初注入的那个（outerHTML 特征） */
    out.html=btn.outerHTML.slice(0,80);
    out.listeners="无法枚举";
    /* 直接用 speak 通道验证按钮对象身份 */
    out.who=btn.parentNode.className;
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})();
