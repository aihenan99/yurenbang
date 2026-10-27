const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?cvd2="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2400);
  const r=await p.evaluate(()=>{
    return new Promise(res=>{
      const bufP=fetch("http://127.0.0.1:8793/temp/ppt-test/sample_fixed.pptx").then(r=>r.arrayBuffer());
      /* 先手动触发 loadLib：通过 YRB_PPT.thumb 前缀逻辑不行，这里直接借用 mount 不合适；
         pptview 的 loadLib 是私有的——但 thumb 调用链里会加载。这里手动注库等同：
         用一次 thumb 失败也没关系，主要看库加载后的渲染结构 */
      const LIB=(window.pptxPreview?null:"?");
      bufP.then(async buf=>{
        /* 引擎脚本地址与 pptview 一致：从 deploy-cn 直接引 */
        if(!window.pptxPreview){
          await new Promise((rs,rj)=>{const s=document.createElement("script");s.src="/deploy-cn/assets/vendor/pptx-preview.min.js";s.onload=rs;s.onerror=rj;document.head.appendChild(s);}).catch(()=>{});
          if(!window.pptxPreview){ /* 尝试另一个常见路径 */
            await new Promise((rs)=>{const s=document.createElement("script");s.src="/deploy-cn/assets/pptx-preview.min.js";s.onload=rs;s.onerror=rs;document.head.appendChild(s);});
          }
        }
        if(!window.pptxPreview){res({err:"引擎路径未知，看 deploy-cn 里的库文件"});return;}
        const host=document.createElement("div");
        host.style.cssText="position:fixed;left:-9999px;top:0;width:360px";
        document.body.appendChild(host);
        const pv=pptxPreview.init(host,{width:360,height:202,mode:"slide"});
        await pv.preview(buf);
        await new Promise(r=>setTimeout(r,800));
        res({kids:host.children.length, html:host.innerHTML.slice(0,400),
             canvases:host.querySelectorAll("canvas").length,
             imgs:host.querySelectorAll("img").length,
             svg:host.querySelectorAll("svg").length});
      });
    });
  });
  console.log(JSON.stringify(r,null,1).slice(0,900));
  await b.close();
})();
