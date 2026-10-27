const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8793/temp/ppt-test/test.html",{waitUntil:"load"});
  await p.waitForTimeout(2500);
  const info = await p.evaluate(async()=>{
    const pv=window.__pv; if(!pv) return "no pv";
    const buf=await (await fetch("sample.pptx")).arrayBuffer();
    let out={};
    try{
      await pv.load(buf);
      const x=pv.pptx||{};
      out.keys=Object.keys(x);
      out.slideCount = (x.slideList||[]).length;
      out.slidesLen = (x.slides||[]).length;
      out.first = x.slideList && x.slideList[0] ? Object.keys(x.slideList[0]) : null;
      out.masters = (x.slideMasters||[]).length;
      out.layouts = (x.slideLayouts||[]).length;
    }catch(e){ out.err=e.message+"\n"+e.stack; }
    return out;
  });
  console.log(JSON.stringify(info,null,1).slice(0,2500));
  await b.close();
})();
