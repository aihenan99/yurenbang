const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?dbg4="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
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
    const out={curPost:S.curPost};
    /* 复刻详情按钮内部取 id 逻辑 */
    let id=null;
    try{ id=(typeof curDetail!=="undefined"&&curDetail)||(window.S&&S.curPost); }catch(err){ out.idErr=String(err.message); }
    out.id=id;
    const posts=(window.S&&S.posts||[]);
    out.matched=posts.filter(x=>x.id===id).length;
    /* 顶层是否有全局 curDetail 干扰 */
    out.globalCurDetail=typeof window.curDetail!=="undefined"?window.curDetail:"无";
    /* 检查按钮监听是否被更换：重新触发一次并立即读文本 */
    const btn=document.querySelector(".r23-dhead .mf-tts");
    out.btnExists=!!btn;
    if(btn){ btn.click(); out.afterClick=btn.textContent; }
    /* speak 独立调用对照 */
    const btn2=document.createElement("button");
    document.body.appendChild(btn2);
    try{ YRB_MEDIAFULL.speak("独立调用", btn2); out.direct=btn2.textContent; }catch(e){ out.directErr=e.message; }
    return out;
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
