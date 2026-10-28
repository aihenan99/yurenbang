/* 诊断4：本地直连云数据库（匿名公开读） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME='C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,headless:true});
  const page=await b.newPage({viewport:{width:430,height:900}});
  const logs=[];
  page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await page.goto('http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html',{waitUntil:'load'});
  await page.waitForTimeout(6500);
  const out=await page.evaluate(async()=>{
    const c=window.YRB_CLOUD.client;
    const r={};
    try{
      const q=await c.database.from('yb_posts').select('id,title,tag,owner_name,created_at').order('created_at',{ascending:false}).limit(5);
      r.dbRead={ok:!q.error,count:(q.data||[]).length,err:q.error?(q.error.message||'').slice(0,120):null,rows:q.data||[]};
    }catch(e){r.dbRead={ok:false,err:(e&&e.message||'').slice(0,120)};}
    try{
      /* 匿名写应被 RLS 拒绝（owner_id 无法等于 anon 身份） */
      const w=await c.database.from('yb_posts').insert({title:'__probe__',body:'x'}).select();
      r.anonWrite={ok:false,blocked:!!(w&&w.error)||(Array.isArray(w.data)&&w.data.length===0),err:w.error?(w.error.message||'').slice(0,80):null};
    }catch(e){r.anonWrite={blocked:true,err:(e&&e.message||'').slice(0,80)};}
    return r;
  });
  console.log(JSON.stringify(out,null,1));
  console.log('PAGEERRORS:',JSON.stringify(logs));
  await b.close();
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
