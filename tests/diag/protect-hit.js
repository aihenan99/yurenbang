/* 验证：img 被 pointer-events:none 后，点击是否穿透到父容器（详情页看大图依赖此行为） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  await p.goto("http://127.0.0.1:8794/?hit="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2000);
  await p.evaluate(()=>{try{enterApp()}catch(e){}});
  await p.waitForTimeout(500);
  const r=await p.evaluate(()=>{
    // 复刻详情页图片结构：<div class="di"><img></div>
    const wrap=document.createElement("div");
    wrap.id="hitTest";
    wrap.style.cssText="position:fixed;left:20px;top:120px;width:200px;height:120px;z-index:9999";
    wrap.innerHTML='<div class="di" id="hitDi" style="width:100%;height:100%;background:#eee"><img id="hitImg" src="assets/icon-192.png" style="width:100%;height:100%;display:block"></div>';
    document.body.appendChild(wrap);
    const img=document.getElementById("hitImg");
    const di=document.getElementById("hitDi");
    const box=di.getBoundingClientRect();
    const hit=document.elementFromPoint(box.x+box.width/2, box.y+box.height/2);
    const out={
      imgPE:getComputedStyle(img).pointerEvents,
      imgDrag:getComputedStyle(img).webkitUserDrag,
      jjqrPE:(function(){var q=document.querySelector(".jj-qr");return q?getComputedStyle(q).pointerEvents:"none-el";})(),
      hitTag:hit?hit.tagName:"",
      hitId:hit?hit.id:"",
      hitClosestDi:!!(hit&&hit.closest&&hit.closest(".di")),
      guard:document.documentElement.classList.contains("yrb-guard")
    };
    wrap.remove();
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})();
