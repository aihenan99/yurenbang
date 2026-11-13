"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
let pass=0,fail=0;
function ok(name,cond,extra){cond?pass++:fail++;console.log((cond?"  ✓ ":"  ✗ ")+name+(extra?"  "+JSON.stringify(extra):""));}
(async()=>{
const {chromium}=require(path.join(__dirname,"..","..","temp","pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
const p=await c.newPage();
const errs=[];
p.on("pageerror",e=>errs.push(String(e.stack||e.message).slice(0,300)));
await p.goto("http://127.0.0.1:8796/yurenbang-app.html",{waitUntil:"domcontentloaded"}).catch(()=>{});
await p.waitForTimeout(7000);

// 注入一张卡，并把它的操作行精确滚到跟读胶囊正下方（模拟用户撞上的场景）
await p.evaluate(()=>{
  const f=document.querySelector("#feed");
  const sp=document.createElement("div"); sp.style.height="420px"; sp.id="spacer9900"; f.appendChild(sp);
  const d=document.createElement("div"); d.className="card"; d.dataset.id="9901";
  d.innerHTML='<div class="p-text">测试求助正文，点这里本来是进详情。</div>'+
    '<div class="p-acts"><button class="pa-btn like" data-act="like">♥ <span class="n">1</span></button>'+
    '<button class="pa-btn fav" data-act="fav">⭐ <span class="n">2</span></button>'+
    '<span class="helps-pill" data-act="cm">🤝 3 个帮忙</span></div>';
  f.appendChild(d);
  const pill=document.querySelector("#mfAuto");
  const pr=pill.getBoundingClientRect();
  const acts=d.querySelector(".p-acts");
  // 滚动 page-home 使 .p-acts 的中心落在胶囊中心
  const ph=document.querySelector("#page-home");
  const ar=acts.getBoundingClientRect();
  const targetCenter=(pr.top+pr.bottom)/2;
  ph.scrollTop = Math.max(0, ar.top+ar.height/2-targetCenter);
});
await p.waitForTimeout(400); // 等 rAF 判定
const st1=await p.evaluate(()=>({
  blocked:document.querySelector("#mfAuto").classList.contains("mf-blocked"),
  pe:getComputedStyle(document.querySelector("#mfAuto")).pointerEvents,
  pillTop:Math.round(document.querySelector("#mfAuto").getBoundingClientRect().top),
  actsTop:Math.round(document.querySelector("#feed .card[data-id='9901'] .p-acts").getBoundingClientRect().top)
}));
ok("操作行滚入胶囊带区 → 胶囊淡出让路",st1.blocked&&st1.pe==="none",st1);
const appst=await p.evaluate(()=>({app:(document.querySelector("#app")||{}).className,splash:(document.querySelector("#splash")||{}).className,home:(document.querySelector("#page-home")||{}).className}));
ok("应用已进入首页（splash 关、home 激活）",/hidden/.test(appst.splash)&&/active/.test(appst.home),appst);

// 真触摸点胶囊位置：应命中下层 helps-pill，打开帮忙面板
const pr=await p.evaluate(()=>{const r=document.querySelector("#feed .card[data-id='9901'] .helps-pill").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
await p.evaluate(()=>{window.__pillClicks=0;window.__ev=[];
  document.addEventListener("click",function(e){if(e.target.closest&&e.target.closest(".helps-pill"))window.__pillClicks++;},true);
  ["pointerdown","touchstart","click"].forEach(n=>{document.addEventListener(n,e=>{window.__ev.push(n+"->"+String((e.target.className||e.target.tagName)).slice(0,22));},true);});});
await p.touchscreen.tap(pr.x,pr.y);
await p.waitForTimeout(1200);
const st2=await p.evaluate(()=>({
  ev:window.__ev,
  blockedNow:document.querySelector("#mfAuto").className,
  pillClicks:window.__pillClicks,
  detailOpen:!!(document.querySelector("#r23Detail")&&document.querySelector("#r23Detail").classList.contains("open")),
  viewerOpen:!!(document.querySelector("#r23Viewer")&&document.querySelector("#r23Viewer").classList.contains("open"))
}));
ok("点🤝帮忙胶囊 → click 送达胶囊本体（不被悬浮胶囊截走、不误开详情）",st2.pillClicks>=1&&!st2.detailOpen&&!st2.viewerOpen,st2);

// 关面板；把卡片滚开 → 胶囊应回来
await p.evaluate(()=>{const s=document.querySelector("#commentSheet");s.classList.remove("open");const ph=document.querySelector("#page-home");ph.scrollTop-=160;});
await p.waitForTimeout(450);
const st3=await p.evaluate(()=>({
  blocked:document.querySelector("#mfAuto").classList.contains("mf-blocked"),
  pe:getComputedStyle(document.querySelector("#mfAuto")).pointerEvents
}));
ok("错开后胶囊自动回来（可点）",!st3.blocked&&st3.pe!=="none",st3);

// 详情开着时不让路（全屏阅读要靠胶囊停朗读）
await p.evaluate(()=>{
  const ph=document.querySelector("#page-home");
  ph.scrollTop-=160;  // 再滚回遮挡位置
  document.querySelector("#r23Detail").classList.add("open");
});
await p.waitForTimeout(450);
const st4=await p.evaluate(()=>({
  blocked:document.querySelector("#mfAuto").classList.contains("mf-blocked"),
  pe:getComputedStyle(document.querySelector("#mfAuto")).pointerEvents
}));
ok("详情/浮层打开时不让路（胶囊保持可点）",!st4.blocked,st4);

console.log("errors:",errs.length?errs.slice(0,5):"none");
console.log("==== "+pass+" 通过 / "+fail+" 失败 ====");
await b.close();
process.exit(fail?1:0);
})();
