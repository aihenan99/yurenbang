/* mic-test：语音转文字（2026-11-02 改为连续识别）
   核心断言：说话中途停顿不会被切断（引擎 onend 后静默续听、文字累积），
             只有用户再点一次按钮（=说完了）才真正结束并弹「已转成文字」。
   另保留：no-speech 续听、权限错误指引、aborted 不挂起、两轮会话 base 取实时值。
   桩用「段队列」模型：每次 start() 消费一段脚本，可模拟 onend(stop) 与 error。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass = 0, fail = 0;
const ck = (n, c, d) => { if (c) { pass++; console.log("  ✅", n); } else { fail++; console.log("  ✗", n, d || ""); } };

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });

  await ctx.addInitScript(() => {
    /* 段模型：{interims:[], final:"", end:true, err:"", idle:true, delay}
       idle=true 表示这一段什么也不发（模拟用户在思考、引擎在听但没内容） */
    class FakeSR {
      constructor() { this._t = []; }
      start() {
        const seg = (window.__SEGS || []).shift() || { idle: true };
        window.__starts = (window.__starts || 0) + 1;
        const self = this;
        const fire = () => {
          if (seg.err) { self.onerror && self.onerror({ error: seg.err }); if (seg.end !== false) self.onend && self.onend(); return; }
          self.onstart && self.onstart();
          (seg.interims || []).forEach(t => self.onresult && self.onresult({ results: [[{ transcript: t, isFinal: false }]] }));
          if (seg.final) self.onresult && self.onresult({ results: [[{ transcript: seg.final, isFinal: true }]] });
          if (seg.end) self.onend && self.onend();
        };
        this._t.push(setTimeout(fire, seg.delay == null ? 40 : seg.delay));
      }
      stop() { this._clear(); this.onend && this.onend(); }   /* 真机 stop 会回调 onend */
      abort() { this._clear(); this.onerror && this.onerror({ error: "aborted" }); }
      _clear() { this._t.forEach(clearTimeout); this._t = []; }
    }
    Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeSR, configurable: true });
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    window.__SEGS = [];
    window.__starts = 0;
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
  const setSegs = arr => p.evaluate(a => { window.__SEGS = a; window.__starts = 0; }, arr);
  const clickMic = () => p.evaluate(sel => document.querySelector(sel).click(), btn);
  const pubVal = () => p.evaluate(() => document.getElementById("pubText").value);
  const clearPub = () => p.evaluate(() => { document.getElementById("pubText").value = ""; });
  const toastTxt = () => p.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
  const btnTxt = () => p.evaluate(sel => document.querySelector(sel).textContent, btn);
  const starts = () => p.evaluate(() => window.__starts || 0);

  await p.evaluate(() => document.getElementById("fab").click());
  await p.waitForTimeout(700);

  /* T1【核心】说一半停顿：第一段被引擎自己 end，第二段接着说 */
  await clearPub();
  await setSegs([
    { interims: ["孩子最近"], final: "孩子最近不爱吃饭", end: true },  /* 停顿 → onend */
    { final: "一到饭桌就哭", end: true },                              /* 续听后接着说 → onend */
    { idle: true }                                                     /* 说完后静等，不该自己结束 */
  ]);
  await clickMic();
  await p.waitForTimeout(1500);
  const t1 = await pubVal();
  ck("停顿不切断：两段话都保留", t1 === "孩子最近不爱吃饭 一到饭桌就哭", "值=" + t1);
  ck("停顿后续听了（start ≥ 2 次）", (await starts()) >= 2, "starts=" + (await starts()));
  ck("还在听（按钮未复位）", (await btnTxt()).includes("正在听"), await btnTxt());

  /* T2 点一次=说完了：结束并弹「已转成文字」，按钮复位 */
  await clickMic();
  await p.waitForTimeout(600);
  const t2toast = await toastTxt();
  ck("说完后弹「已转成文字」", /已转成文字/.test(t2toast), t2toast);
  ck("说完后按钮复位", !(await btnTxt()).includes("正在听"), await btnTxt());
  ck("说完后文字不重复", ((await pubVal()).match(/孩子最近不爱吃饭/g) || []).length === 1, await pubVal());

  /* T3 no-speech（静音超时）静默续听，不打断、不弹错 */
  await clearPub();
  await setSegs([
    { err: "no-speech" },
    { final: "孩子写作业太慢", end: true },
    { idle: true }
  ]);
  await clickMic();
  await p.waitForTimeout(1200);
  ck("静音超时后仍继续听并写入", (await pubVal()) === "孩子写作业太慢", await pubVal());
  ck("静音超时不弹错误提示", !/没有听清|没听清/.test(await toastTxt()), await toastTxt());
  await clickMic();  /* 收尾，避免影响下一例 */
  await p.waitForTimeout(500);

  /* T4 权限错误：给明确指引并复位 */
  await clearPub();
  await setSegs([{ err: "not-allowed" }]);
  await clickMic();
  await p.waitForTimeout(700);
  const t4 = await toastTxt();
  ck("权限错误提示含「允许本网站使用麦克风」", t4.includes("允许本网站使用麦克风"), t4);
  ck("权限错误后按钮复位", !(await btnTxt()).includes("正在听"), await btnTxt());

  /* T5 外部中断（aborted）不把按钮挂死：自动重起一轮 */
  await clearPub();
  await setSegs([
    { err: "aborted", end: false },
    { final: "孩子胆小不敢说话", end: true },
    { idle: true }
  ]);
  await clickMic();
  await p.waitForTimeout(1200);
  ck("中断后自动续听并写入", (await pubVal()) === "孩子胆小不敢说话", await pubVal());
  ck("中断后按钮仍在听（未挂死）", (await btnTxt()).includes("正在听"), await btnTxt());
  await clickMic();
  await p.waitForTimeout(500);

  /* T6 两轮会话：第二次 base 取实时值，追加不覆盖 */
  await clearPub();
  await setSegs([{ final: "第一轮内容", end: true }, { idle: true }]);
  await clickMic();
  await p.waitForTimeout(900);
  await clickMic();
  await p.waitForTimeout(400);
  await p.evaluate(() => { document.getElementById("pubText").value = "已有内容"; });
  await setSegs([{ final: "第二轮内容", end: true }, { idle: true }]);
  await clickMic();
  await p.waitForTimeout(900);
  await clickMic();
  await p.waitForTimeout(400);
  const t6 = await pubVal();
  ck("第二次会话 base 取实时值", t6 === "已有内容 第二轮内容", "值=" + t6);

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
