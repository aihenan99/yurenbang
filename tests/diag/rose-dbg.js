const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("console",m=>{ if(/rose|ROSE/.test(m.text())) console.log("[page]",m.text()); });
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?tc="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2000);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(600);
  const r=await p.evaluate(()=>{
    const post=S.posts.find(x=>x.comments&&x.comments.length);
    S.curPost=post.id;
    try{YRB_CLOUD.signedIn=()=>true}catch(e){}
    renderComments(); openSheet("commentSheet");
    const btn=document.querySelector("#cmList .clike");
    return {pid:post.id, hasBtn:!!btn, cls:btn?btn.className:"", on:btn?btn.classList.contains("on"):null,
      item: btn?!!btn.closest(".cm-item"):null, locked:document.getElementById("cmList").classList.contains("cm-locked"),
      user:post.comments[0].user, owner:post.comments[0].owner||"", me:post.mine};
  });
  console.log("setup:",JSON.stringify(r));
  await p.waitForTimeout(300);
  const r2=await p.evaluate(()=>{
    // 直接调 give 验证记账
    const ok=YRB_ROSE.give({id:"",name:"测试家长",postId:null,key:"dbg1"},"手工验证");
    return {ok, out:YRB_ROSE.out().length};
  });
  console.log("direct give:",JSON.stringify(r2));
  await p.waitForTimeout(200);
  const r3=await p.evaluate(()=>{
    document.querySelectorAll("#gift .yr-roses").forEach(e=>e.remove());
    const before=YRB_ROSE.out().length;
    const btn=document.querySelector("#cmList .clike");
    btn && btn.click();
    return {before};
  });
  await p.waitForTimeout(900);
  const r4=await p.evaluate(()=>({
    out:YRB_ROSE.out().length,
    reasons:YRB_ROSE.out().slice(0,3).map(x=>x.reason),
    open:document.getElementById("gift").classList.contains("open"),
    roses:document.querySelectorAll("#gift .yr-roses .yr-r").length,
    rw:document.querySelectorAll("#gift .rw-roses span").length,
    liked:(document.querySelector("#cmList .clike")||{}).className
  }));
  console.log("after click:",JSON.stringify(r4));
  await b.close();
})();
