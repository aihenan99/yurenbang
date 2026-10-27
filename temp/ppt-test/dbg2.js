const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8793/temp/ppt-test/test.html",{waitUntil:"load"});
  await p.waitForTimeout(2000);
  const out = await p.evaluate(async()=>{
    const pv=window.__pv; const buf=await (await fetch("sample.pptx")).arrayBuffer();
    await pv.load(buf);
    const x=pv.pptx; const files=x._zipContents.files; const missing=[];
    const prox=new Proxy(files,{get(t,k){ const v=t[k]; if(v===undefined && typeof k==="string") missing.push(k); return v; }});
    x._zipContents.files=prox;
    try{ await x._loadContentTypes(); }catch(e){}
    return {missing, slides:(x.slides||[]).length, layouts:(x.slideLayouts||[]).length};
  });
  console.log(JSON.stringify(out,null,1));
  await b.close();
})();
