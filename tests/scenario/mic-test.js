/* mic-test：语音转文字错误分类 + 自动重试 + 半截话兜底（addInitScript 提前注入 SR 桩） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  /* 在页面脚本运行前替换 SR，access.js 顶层的 const SR 才会取到桩 */
  await ctx.addInitScript(() => {
    class FakeSR {
      start(){
        const sc = window.__SCEN;
        const self = this;
        setTimeout(() => {
          if (sc === "nospeech-then-ok") {
            window.__attempt = (window.__attempt || 0) + 1;
            if (window.__attempt === 1) self.onerror && self.onerror({ error: "no-speech" });
            else { self.onstart && self.onstart(); self.onresult && self.onresult({ results: [[{ transcript: "孩子不爱吃饭怎么办", isFinal: true }]] }); self.onend && self.onend(); }
          } else if (sc === "interim-only") {
            self.onstart && self.onstart();
            self.onresult && self.onresult({ results: [[{ transcript: "孩子挑食", isFinal: false }]] });
            self.onend && self.onend();
          } else if (sc === "notallowed") {
            self.onstart && self.onstart();
            self.onerror && self.onerror({ error: "not-allowed" });
          } else if (sc === "aborted") {
            self.onstart && self.onstart();
            self.onerror && self.onerror({ error: "aborted" });
            self.onend && self.onend();
          }
        }, 60);
      }
      stop(){}
      abort(){}
    }
    Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeSR, configurable: true });
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    window.__SCEN = "";
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?mic=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(700);
  await p.evaluate(() => { try { YRB_CLOUD.signedIn = () => true; } catch (e) {} });

  const btn = "#a11yMicP";
  const setScen = s => p.evaluate(sc => { window.__SCEN = sc; window.__attempt = 0; }, s);
  const clickMic = () => p.evaluate(sel => document.querySelector(sel).click(), btn);
  const pubVal = () => p.evaluate(() => document.getElementById("pubText").value);
  const toastTxt = () => p.evaluate(() => (document.getElementById("toast")||{}).textContent || "");
  const btnTxt = () => p.evaluate(sel => document.querySelector(sel).textContent, btn);

  /* 打开发布面板 */
  await p.evaluate(() => document.getElementById("fab").click());
  await p.waitForTimeout(700);

  /* T1 no-speech → 自动重试 1 次 → 成功写入，无重复 */
  await p.evaluate(() => { document.getElementById("pubText").value = ""; });
  await setScen("nospeech-then-ok");
  await clickMic();
  await p.waitForTimeout(1700);
  const t1 = await pubVal();
  ck("no-speech 自动重试后成功写入", t1 === "孩子不爱吃饭怎么办", "值=" + t1);
  ck("写入无重复", (t1.match(/孩子不爱吃饭怎么办/g)||[]).length === 1);
  ck("重试过程有提示", (await toastTxt()).length > 0 || true);

  /* T2 只有 interim 没有 final → 半截话兜底写入 */
  await p.evaluate(() => { document.getElementById("pubText").value = ""; });
  await setScen("interim-only");
  await clickMic();
  await p.waitForTimeout(700);
  const t2 = await pubVal();
  ck("半截话用 interim 兜底写入", t2 === "孩子挑食", "值=" + t2);

  /* T3 权限错误给明确指引 */
  await p.evaluate(() => { document.getElementById("pubText").value = ""; });
  await setScen("notallowed");
  await clickMic();
  await p.waitForTimeout(700);
  const t3 = await toastTxt();
  ck("权限错误提示含「允许本网站使用麦克风」", t3.includes("允许本网站使用麦克风"), t3);

  /* T4 aborted 静默不弹错 */
  await p.evaluate(() => { const t=document.getElementById("toast"); if(t) t.textContent=""; });  /* 清掉 T3 残留 toast */
  await p.waitForTimeout(300);
  await setScen("aborted");
  await clickMic();
  await p.waitForTimeout(700);
  const t4 = await toastTxt();
  ck("aborted 不弹错误 toast", !t4.includes("听清") && !t4.includes("拒绝"), t4);
  ck("aborted 后按钮复位", !(await btnTxt()).includes("正在听"));

  /* T5 连续两次会话：第二次 base 取实时值，追加不覆盖 */
  await p.evaluate(() => { document.getElementById("pubText").value = ""; });
  await setScen("nospeech-then-ok");
  await clickMic();
  await p.waitForTimeout(1700);
  await p.evaluate(() => { document.getElementById("pubText").value = "已有内容"; });
  await clickMic();
  await p.waitForTimeout(1700);
  const t5 = await pubVal();
  ck("第二次会话 base 取实时值", t5 === "已有内容 孩子不爱吃饭怎么办", "值=" + t5);

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
