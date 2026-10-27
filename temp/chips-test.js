/* 首页栏目配置层回归测试：
   1) 默认首页 chips = 推荐+案例（无爆火/成长录）
   2) YRB_CHIPS 就绪、extraAvail()=[]（默认未开放任何拓展）
   3) 模拟后台配置下发（yrb-chips 事件）→ chips 即时变化
   4) ＋面板只列后台开放的模块
   5) 爆火被移除时 hotMode 自动退出
   6) 无 pageerror */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?tc="+Date.now(),{waitUntil:"load",timeout:30000});
  await p.waitForTimeout(2000);
  await p.evaluate(()=>{ try{enterApp();}catch(e){} });
  await p.waitForTimeout(800);

  const r1 = await p.evaluate(()=>({
    chips:[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()),
    marks:{CHIPS:!!window.YRB_CHIPS},
    extraAvail: window.YRB_CHIPS?YRB_CHIPS.extraAvail():null
  }));
  console.log("T1 默认chips:", JSON.stringify(r1.chips), "| YRB_CHIPS:", r1.marks.CHIPS, "| extraAvail:", JSON.stringify(r1.extraAvail));

  // T2: 模拟后台下发配置（爆火+案例+成长录，开放名师课堂/爱心集市）
  const r2 = await p.evaluate(()=>{
    window.dispatchEvent(new CustomEvent("yrb-chips",{detail:{funcs:["foryou","hot","cases","growth"],extra:["名师课堂","爱心集市"]}}));
    return {
      chips:[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()),
      extraAvail: YRB_CHIPS.extraAvail()
    };
  });
  await p.waitForTimeout(300);
  console.log("T2 下发后chips:", JSON.stringify(r2.chips), "| extraAvail:", JSON.stringify(r2.extraAvail));

  // T3: ＋面板只列开放模块
  await p.evaluate(()=>{ document.querySelector('#funcrow [data-f="add"]') && document.querySelector('#funcrow [data-f="add"]').click(); });
  await p.waitForTimeout(400);
  const r3 = await p.evaluate(()=>[...document.querySelectorAll(".fa-item")].map(e=>e.textContent.trim()));
  console.log("T3 ＋面板模块:", JSON.stringify(r3));
  await p.evaluate(()=>{ const btn=document.querySelector("#funcAddSheet .close, [data-close]"); if(btn)btn.click(); closeSheet&&closeSheet("funcAddSheet"); });
  await p.waitForTimeout(300);

  // T4: 爆火在列时点爆火 → hotMode；下发移除爆火 → hotMode 自动退出
  const r4 = await p.evaluate(async ()=>{
    document.querySelector('#funcrow [data-f="hot"]').click();
    const hotOn = S.hotMode;
    window.dispatchEvent(new CustomEvent("yrb-chips",{detail:{funcs:["foryou","cases"],extra:[]}}));
    await new Promise(r=>setTimeout(r,200));
    return { hotOn, hotAfter: S.hotMode, chips:[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()) };
  });
  console.log("T4 hotMode 点击后:", r4.hotOn, "| 移除爆火后:", r4.hotAfter, "| chips:", JSON.stringify(r4.chips));

  // T5: 离线缓存兜底——localStorage 有缓存时刷新页面直接生效
  await p.evaluate(()=>{ localStorage.setItem("yrb_chips_v1", JSON.stringify({funcs:["foryou","hot"],extra:[]})); });
  await p.reload({waitUntil:"load"});
  await p.waitForTimeout(1800);
  const r5 = await p.evaluate(()=>[...document.querySelectorAll("#funcrow .f-chip")].map(e=>e.textContent.trim()));
  console.log("T5 缓存生效(刷新后):", JSON.stringify(r5));

  console.log("PAGEERRORS:", errs.length?errs.join(" | ").slice(0,300):"无");
  await p.screenshot({path:"E:/育人帮/temp/shot-chips.png"});
  await b.close();
})();
