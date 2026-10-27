const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?dbg6="+Date.now(),{waitUntil:"load"});
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
  await p.waitForTimeout(600);
  const r=await p.evaluate(()=>{
    const out={};
    /* 补回帖子（云端状态恢复可能清掉） */
    if(!S.posts.some(x=>x.id===8901)){
      S.posts.unshift({id:8901,mine:false,type:"video",by:"t",ava:"bear",title:"t2",text:"x",time:"",likes:0,favs:0,helps:0,comments:[],media:[]});
    }
    S.curPost=8901;
    window.__spoke=[];
    const real=YRB_MEDIAFULL.speak;
    YRB_MEDIAFULL.speak=function(t,btn){window.__spoke.push(String(t).slice(0,30));return real.call(YRB_MEDIAFULL,t,btn);};
    const btn=document.querySelector(".r23-dhead .mf-tts");
    out.found=!!btn;
    if(btn){btn.click();out.after=btn.textContent;}
    out.spoke=window.__spoke;
    /* 同时检查处理函数闭包里的 id 逻辑 */
    out.curPostType=typeof S.curPost;
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})();
