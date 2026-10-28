const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  await page.goto('https://yurenbang.app.workbuddy.host/',{waitUntil:'load'});
  await page.waitForTimeout(8000);
  const out = await page.evaluate(async ()=>{
    const srcs=[...document.querySelectorAll('script[src]')].map(s=>s.src);
    const sdk=srcs.find(s=>/workbuddy-cloud-sdk/.test(s));
    const info={sdk:!!sdk, srcs};
    if(sdk){
      try{
        const t=await (await fetch(sdk)).text();
        info.len=t.length;
        const ctx=[];
        for(const k of ['phone_number','phoneNumber','phone']){
          const re=new RegExp('.{90}'+k+'.{90}','g');
          let m,n=0;
          while((m=re.exec(t))&&n<6){ctx.push(k+' >> '+m[0].replace(/\s+/g,' '));n++;}
        }
        info.ctx=ctx;
      }catch(e){info.err=e.message;}
    }
    return info;
  });
  console.log(JSON.stringify(out,null,1).slice(0,6000));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
