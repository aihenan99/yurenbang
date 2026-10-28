// 生产环境全量冒烟：各功能层标记 + 家教chip + 答谢按钮 + 语音按钮 + 无报错
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async()=>{
  const b = await chromium.launch({ executablePath:"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport:{width:412,height:900} });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message));
  await p.goto("https://xn--gmqq09al6z.cn/?smoke="+Date.now(),{waitUntil:"load",timeout:60000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>({
    marks: {
      APP: typeof window.YRB_APP !== "undefined",
      R23: typeof window.YRB_R23 !== "undefined",
      JJ: typeof window.YRB_JJ !== "undefined",
      GATE: typeof window.YRB_GATE !== "undefined",
      MYLIST: typeof window.YRB_MYLIST !== "undefined",
      CLOUD: typeof window.YRB_CLOUD !== "undefined",
      FOOD: typeof window.YRB_FOOD !== "undefined",
    },
    jjChip: !!document.querySelector(".jj-chip, [data-jj], .chip-jiaojiao, #jiaojiao-chip"),
    hasVoice: !!document.querySelector("#cmVoice, [data-voice], #voiceBtn"),
    splashGone: !document.querySelector(".s-show, .splash:not([style*='display: none'])"),
  }));
  console.log("MARKS:", JSON.stringify(r.marks));
  console.log("家教chip:", r.jjChip, "| 语音按钮:", r.hasVoice, "| 启动屏已退出:", r.splashGone);
  // 家教chip 兜底：列出顶部chip文本
  const chips = await p.$$eval(".chip, .jj-chip, [class*='chip']", els=>els.slice(0,8).map(e=>e.textContent.trim()).filter(Boolean));
  console.log("CHIPS:", JSON.stringify(chips));
  console.log("PAGEERRORS:", errs.length ? errs.join(" | ").slice(0,300) : "无");
  await p.screenshot({path:"E:/育人帮/temp/shot-prod-smoke.png"});
  await b.close();
})();
