/* 诊断：语音转文字连续识别的状态时序（临时） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    class FakeSR {
      constructor() { this._t = []; }
      start() {
        const seg = (window.__SEGS || []).shift() || { idle: true };
        window.__starts = (window.__starts || 0) + 1;
        window.__log = window.__log || [];
        window.__log.push("start#" + window.__starts + " seg=" + JSON.stringify(seg));
        const self = this;
        const fire = () => {
          if (seg.err) { self.onerror && self.onerror({ error: seg.err }); if (seg.end !== false) self.onend && self.onend(); return; }
          self.onstart && self.onstart();
          (seg.interims || []).forEach(t => self.onresult && self.onresult({ results: [[{ transcript: t, isFinal: false }]] }));
          if (seg.final) self.onresult && self.onresult({ results: [[{ transcript: seg.final, isFinal: true }]] });
          if (seg.end) self.onend && self.onend();
        };
        this._t.push(setTimeout(fire, 40));
      }
      stop() { this._clear(); window.__log.push("stop"); this.onend && this.onend(); }
      abort() { this._clear(); window.__log.push("abort"); this.onerror && this.onerror({ error: "aborted" }); }
      _clear() { this._t.forEach(clearTimeout); this._t = []; }
    }
    Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeSR, configurable: true });
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    window.__SEGS = []; window.__starts = 0; window.__log = [];
  });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8793/deploy-cn/?dbg=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(700);
  await p.evaluate(() => { try { YRB_CLOUD.signedIn = () => true; } catch (e) {} });
  await p.evaluate(() => document.getElementById("fab").click());
  await p.waitForTimeout(700);

  const snap = (tag) => p.evaluate((t) => ({
    tag: t,
    btn: (document.querySelector("#a11yMicP") || {}).textContent,
    txt: (document.getElementById("pubText") || {}).value,
    toast: (document.getElementById("toast") || {}).textContent,
    starts: window.__starts, log: (window.__log || []).slice(-6), mic: (window.__MICLOG || [])
  }), tag);

  const setSegs = a => p.evaluate(x => { window.__SEGS = x; window.__starts = 0; window.__log = []; }, a);
  const click = () => p.evaluate(() => document.querySelector("#a11yMicP").click());
  const dump = async (t) => console.log(JSON.stringify(await snap(t)));

  console.log("=== A: 停顿续听 ===");
  await setSegs([{ final: "第一段", end: true }, { final: "第二段", end: true }, { idle: true }]);
  await click();
  await p.waitForTimeout(1200);
  await dump("A1 续听后");
  await click();
  await p.waitForTimeout(400);
  await dump("A2 说完后");

  console.log("=== B: 权限错误 ===");
  await p.evaluate(() => { document.getElementById("pubText").value = ""; });
  await setSegs([{ err: "not-allowed" }]);
  await click();
  await p.waitForTimeout(600);
  await dump("B1 报错后");

  console.log("=== C: 中断续听 ===");
  await p.evaluate(() => { document.getElementById("pubText").value = ""; });
  await setSegs([{ err: "aborted", end: false }, { final: "第三段", end: true }, { idle: true }]);
  await click();
  await p.waitForTimeout(1200);
  await dump("C1 中断后");
  await click();
  await p.waitForTimeout(400);
  await dump("C2 说完后");

  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
