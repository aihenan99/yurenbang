/* 纯渲染负载：不用 CDP 注入触摸（排除工具开销），只在 rAF 里推进 scrollTop */
const { chromium } = require("./pw/node_modules/playwright-core");
const SITE = process.argv[2] || "http://127.0.0.1:8794/";
function feedData(n){const t=["孩子不爱写作业怎么办","两岁孩子挑食怎么破","幼儿园分离焦虑","二宝抢玩具打架"];const o=[];
for(let i=0;i<n;i++)o.push({id:95000+i,title:t[i%4],text:"试了好多办法都没用，请有经验的家长支支招。孩子今年刚上幼儿园，每天回家都闷闷不乐，问他也不说。",type:"img",user:"家长"+(i+1),tag:"求助",likes:3+i,helps:i,comments:i%5,time:"1小时前"});return o;}
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const ctx=await b.newContext({viewport:{width:412,height:900},serviceWorkers:"block",isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p=await ctx.newPage();
  await p.goto(SITE+"?pp="+Date.now(),{waitUntil:"load",timeout:45000});
  await p.waitForTimeout(1500);
  await p.evaluate(()=>{try{enterApp();}catch(e){}});
  await p.waitForTimeout(500);
  await p.evaluate(d=>{try{S.posts=d;renderFeed();}catch(e){}},feedData(20));
  await p.waitForTimeout(900);
  const cdp=await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate",{rate:8});
  console.log("CPU 8x，20 卡，纯 rAF 推进 scrollTop\n");
  const setCSS=css=>p.evaluate(c=>{let s=document.getElementById("perf-probe");if(!s){s=document.createElement("style");s.id="perf-probe";document.head.appendChild(s);}s.textContent=c;},css);
  async function run(tag,css){
    await setCSS(css||"");
    const r=await p.evaluate(()=>new Promise(res=>{
      const ph=document.getElementById("page-home");ph.scrollTop=0;
      const gaps=[];let last=performance.now(),y=0,dir=1,n=0;
      function loop(){
        const now=performance.now();gaps.push(now-last);last=now;
        y+=dir*12;
        if(y>2200||y<0)dir=-dir;
        ph.scrollTop=y;
        if(++n<220)requestAnimationFrame(loop);
        else{const g=gaps.slice(2).sort((a,b)=>a-b);const q=t=>g[Math.floor(g.length*t)];
          res({p50:+q(.5).toFixed(1),p90:+q(.9).toFixed(1),p95:+q(.95).toFixed(1),max:+g[g.length-1].toFixed(1),drop:+(g.filter(x=>x>25).length/g.length*100).toFixed(1),n:g.length});}
      }
      requestAnimationFrame(loop);
    }));
    console.log(tag.padEnd(26)+`p50 ${String(r.p50).padStart(5)} p90 ${String(r.p90).padStart(5)} p95 ${String(r.p95).padStart(5)} max ${String(r.max).padStart(5)} 掉帧 ${String(r.drop).padStart(4)}%  (${r.n}帧)`);
  }
  await run("① 现状");
  await run("② 关常驻模糊","#funcrow,#topbar,#tabbar{backdrop-filter:none!important}");
  await run("③ 关阴影","*{box-shadow:none!important}");
  await run("④ 卡片 content-visibility",".card{content-visibility:auto;contain-intrinsic-size:auto 420px}");
  await run("⑤ 全部叠上",`#funcrow,#topbar,#tabbar{backdrop-filter:none!important}*{box-shadow:none!important}.card{content-visibility:auto;contain-intrinsic-size:auto 420px}`);
  await b.close();
})();
