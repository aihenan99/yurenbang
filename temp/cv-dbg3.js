const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?cvd3="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2400);
  const r=await p.evaluate(()=>{
    return new Promise(res=>{
      fetch("http://127.0.0.1:8793/temp/ppt-test/sample_fixed.pptx").then(r=>r.arrayBuffer()).then(async buf=>{
        await new Promise((rs,rj)=>{const s=document.createElement("script");s.src="/deploy-cn/assets/vendor/pptx-preview.umd.js";s.onload=rs;s.onerror=rj;document.head.appendChild(s);}).catch(()=>{});
        if(!window.pptxPreview){res({err:"no engine"});return;}
        const host=document.createElement("div");
        host.style.cssText="position:fixed;left:-9999px;top:0;width:360px";
        document.body.appendChild(host);
        const pv=pptxPreview.init(host,{width:360,height:202,mode:"slide"});
        await pv.preview(buf);
        await new Promise(r=>setTimeout(r,1000));
        res({slideCount:pv.slideCount, kids:host.children.length,
             html:host.innerHTML.replace(/\s+/g," ").slice(0,500),
             canvas:host.querySelectorAll("canvas").length,
             img:host.querySelectorAll("img").length,
             svg:host.querySelectorAll("svg").length});
      }).catch(e=>res({err:String(e.message)}));
    });
  });
  console.log(JSON.stringify(r,null,1).slice(0,900));
  await b.close();
})();
