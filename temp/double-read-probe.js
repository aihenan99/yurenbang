/* double-read-probe：点一次卡片 🔊，统计云端音频段播放次数与本机语音调用次数 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    /* 1px 静音 mp3 帧（足够短） */
    window.__plays = []; window.__tts = []; window.__ttsReq = 0;
    const RealAudio = window.Audio;
    window.Audio = function (src) {
      const a = new RealAudio(src);
      const origPlay = a.play.bind(a);
      a.play = function () {
        window.__plays.push((a.src || "").slice(0, 60));
        /* 立即触发 ended，模拟极短音频 */
        setTimeout(() => { try { a.onended && a.onended(); } catch (e) {} }, 120);
        return Promise.resolve();
      };
      return a;
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = function (u, o) {
      if (String(u).startsWith("/yrbtts")) {
        window.__ttsReq++;
        return origFetch(u, o).catch(e => { throw e; });
      }
      return origFetch(u, o);
    };
    if ("speechSynthesis" in window) {
      const origSpeak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function (u) { window.__tts.push(String(u.text).slice(0, 40)); return origSpeak(u); };
    }
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("https://xn--gmqq09al6z.cn/?dr=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(900);
  /* 注入短文本卡（约两句话，对齐用户场景） */
  await p.evaluate(() => {
    S.posts.unshift({ id: 9801, user: "测试", flag: "🇨🇳", ava: "rabbit", type: "img", kinds: ["study"], time: "刚刚", tag: "测试", tagFull: "测试",
      title: "想带娃去坐船", text: "我觉得危险并且价格比较高，请问大家我该怎么办？", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [] });
    renderFeed();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector("#feed .card[data-id='9801'] [data-tts]").click());
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => ({ plays: window.__plays.length, ttsReq: window.__ttsReq, localTts: window.__tts }));
  console.log("点击 1 次 →", JSON.stringify(r));
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  await b.close();
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
