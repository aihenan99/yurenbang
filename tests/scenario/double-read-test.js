/* double-read-test：语音链路竞态修复验证（单发终结守卫 + 失败转本机不叠声 + 防抖）
   每个场景独立加载页面（cloudOk 是会话级，场景间不能污染） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
const LONG = ("孩子最近特别挑食，每顿饭都要追着喂，说了很多遍也没有用。".repeat(8)).slice(0, 420);
const INIT = (LONG) => {
  window.__plays = []; window.__tts = []; window.__ttsReq = 0; window.__failMode = "";
  const origFetch = window.fetch.bind(window);
  window.fetch = function (u, o) {
    if (String(u).indexOf("/yrbtts") === 0) {
      window.__ttsReq++;
      return Promise.resolve(new Response(new Blob(["ID3x"], { type: "audio/mpeg" })));
    }
    return origFetch(u, o);
  };
  window.Audio = function (src) {
    const a = new (class extends EventTarget {
      constructor(){ super(); this.paused = false; }
      pause(){ this.paused = true; }
    })();
    let idx = -1;
    a.play = function () {
      if (idx < 0) { idx = window.__plays.filter(x => typeof x === "number").length; }
      window.__plays.push(idx);
      const mode = window.__failMode;
      if (mode === "err+catch" && idx === 0) {
        setTimeout(() => { try { a.onerror && a.onerror(); } catch (e) {} }, 30);   /* 手机竞态：onerror 与 catch 齐发 */
        return Promise.reject(new Error("NotAllowedError(模拟)"));
      }
      if (mode === "mid-err" && idx === 1) {
        setTimeout(() => { try { a.onerror && a.onerror(); } catch (e) {} }, 30);
        return Promise.resolve();
      }
      setTimeout(() => { try { a.onended && a.onended(); } catch (e) {} }, 60);
      return Promise.resolve();
    };
    return a;
  };
  if ("speechSynthesis" in window) {
    speechSynthesis.speak = function (u) {
      window.__tts.push(String(u.text).slice(0, 60));
      setTimeout(() => { try { u.onend && u.onend(); } catch (e) {} }, 40);   /* 替身必须异步触发 onend，链式分段才能继续 */
    };
  }
  window.__LONG = LONG;
};
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const mkCtx = () => b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });

  async function boot(mode) {
    const ctx = await mkCtx();
    await ctx.addInitScript(INIT, LONG);
    const p = await ctx.newPage();
    p.on("pageerror", e => console.log("[pageerror]", String(e.message).slice(0, 100)));
    await p.goto("http://127.0.0.1:8793/deploy-cn/?drt=" + Date.now(), { waitUntil: "load", timeout: 45000 });
    await p.waitForTimeout(2000);
    await p.evaluate(() => { try { enterApp(); } catch (e) {} });
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      S.posts.unshift({ id: 9801, user: "测试", flag: "🇨🇳", ava: "rabbit", type: "img", kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试",
        title: "朗读测试", text: window.__LONG, likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [] });
      renderFeed();
    });
    await p.waitForTimeout(300);
    if (mode) await p.evaluate(m => { window.__failMode = m; }, mode);
    return { ctx, p };
  }
  const TTS = "#feed .card[data-id='9801'] [data-tts]";
  const clickTts = p => p.evaluate(sel => document.querySelector(sel).click(), TTS);

  /* T1 正常链：每段只播一次，不进本机 */
  {
    const { ctx, p } = await boot("");
    await clickTts(p);
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({ plays: window.__plays, tts: window.__tts }));
    ck("正常链每段只播一次（" + r.plays.length + " 段）", r.plays.length >= 2 && new Set(r.plays).size === r.plays.length, JSON.stringify(r.plays));
    ck("正常链不触发本机朗读", r.tts.length === 0, JSON.stringify(r.tts));
    await ctx.close();
  }

  /* T2 手机竞态（onerror+catch 同段齐发）：云端不重复播，本机只补读一次、不从头叠声 */
  {
    const { ctx, p } = await boot("err+catch");
    await clickTts(p);
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({ plays: window.__plays, tts: window.__tts }));
    ck("竞态下云端段不重复播", new Set(r.plays).size === r.plays.length && r.plays.length === 1, JSON.stringify(r.plays));
    const joined = r.tts.join("");
    ck("本机兜底内容不重复（标题只读一遍=兜底只触发一次）", (joined.match(/朗读测试/g) || []).length === 1, "utterances=" + r.tts.length + " joined=" + joined.slice(0, 50));
    if (r.tts.length) ck("补读从第 1 段起（标题开头）", r.tts[0].startsWith("朗读测试"), r.tts[0].slice(0, 24));
    await ctx.close();
  }

  /* T3 中段失败：第 1 段云端播完，第 2 段起转本机（不跳段、不从头） */
  {
    const { ctx, p } = await boot("mid-err");
    await clickTts(p);
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => ({ plays: window.__plays, tts: window.__tts }));
    ck("中段失败云端每段只尝试一次", new Set(r.plays).size === r.plays.length, JSON.stringify(r.plays));
    const joined2 = r.tts.join("");
    ck("本机兜底不从头重复（标题只出现一次）", (joined2.match(/朗读测试/g) || []).length === 0, "utterances=" + r.tts.length);
    if (r.tts.length === 1) ck("本机从第 2 段起读（不从头重复）", !r.tts[0].startsWith("朗读测试") && !r.tts[0].startsWith("孩子最近"), r.tts[0].slice(0, 30));
    await ctx.close();
  }

  /* T4 快速双击：500ms 内第二击忽略，只起一条链 */
  {
    const { ctx, p } = await boot("");
    await p.evaluate(sel => { document.querySelector(sel).click(); setTimeout(() => document.querySelector(sel).click(), 60); }, TTS);
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({ req: window.__ttsReq, tts: window.__tts, plays: window.__plays }));
    ck("快速双击只起一条链（每段 1 次合成）", r.plays.length >= 2 && new Set(r.plays).size === r.plays.length, "plays=" + JSON.stringify(r.plays) + " tts=" + r.tts.length);
    ck("快速双击无本机叠声", r.tts.length === 0, JSON.stringify(r.tts.length));
    await ctx.close();
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
