const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b=await chromium.launch({executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"});
  const p=await b.newPage({viewport:{width:412,height:900}});
  p.on("pageerror",e=>console.log("[err]",e.message));
  await p.goto("http://127.0.0.1:8794/?dbg3="+Date.now(),{waitUntil:"load"});
  await p.waitForTimeout(2200);
  const r=await p.evaluate(()=>{
    const out={};
    try{
      const btn=document.createElement("button");
      document.body.appendChild(btn);
      YRB_MEDIAFULL.speak("你好世界，测试朗读", btn);
      out.txt=btn.textContent;
      out.speaking=(window.speechSynthesis&&speechSynthesis.speaking)||false;
      out.pending=(window.speechSynthesis&&speechSynthesis.pending)||false;
    }catch(e){ out.err=String(e.message||e); }
    /* toast 出现了吗（speak 内部空文本/不支持都会 toast） */
    const t=document.querySelector("#toast");
    out.toast=t?(t.textContent||"")+"|"+getComputedStyle(t).opacity:"无";
    return out;
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
