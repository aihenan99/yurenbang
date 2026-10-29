const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("console",m=>{const t=m.text(); if(/pptview|cover|pptx/i.test(t)) console.log("[page]",t.slice(0,120));});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?cvd="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2400);
  const r=await p.evaluate(()=>{
    return new Promise(res=>{
      const out={engine:!!window.pptxPreview,zip:!!window.JSZip};
      YRB_PPT.thumb({url:"http://127.0.0.1:8793/temp/ppt-test/sample_fixed.pptx",name:"sample_fixed.pptx"})
        .then(d=>{out.ok=true;out.len=d.length;out.head=d.slice(0,30);res(out);})
        .catch(e=>{out.ok=false;out.err=String(e&&(e.message||e));res(out);});
      setTimeout(()=>{if(!("ok" in out)){out.ok=false;out.err="12s 无响应(挂起)";res(out);}},12000);
    });
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
