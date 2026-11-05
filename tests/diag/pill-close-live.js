/* 跟读开关胶囊（#mfAuto）在详情/全屏里必须点得到（2026-11-03 用户反馈）
   现象：点进求助（推荐卡片 → 详情全屏）后「跟读中」像消失了，想关朗读点不到。
   原因：#mfAuto 原来 z-index 42，详情层 57 / 全屏详情 90 都盖在它上面。
   断言：
   P1 首页信息流：胶囊可见且命中自身
   P2 进详情全屏：胶囊仍可见、命中自身（不被 .mf-fs 盖住）
   P3 全屏里点胶囊 → 关跟读（文案变「跟读关」+ localStorage=0）
   P4 关闭后朗读真的停了（页面里没有在播放的 audio）
   P5 再点一下 → 恢复「跟读中」+ localStorage=1
   P6 退出全屏 / 关闭详情 后胶囊仍在首页可见可点 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const LONG = "每天晚上写作业都要拖到十点，一说就哭。我试过陪着写、也试过定闹钟，都不太管用。" +
  "后来又试了番茄钟，前两天有点用，第三天就完全失效了。求有经验的家长指点一下。";
const POSTS = [
  { id: 9101, user: "测试家长", title: "孩子写作业拖拉", text: LONG,
    likes: 3, favs: 1, helps: 2, time: "10 分钟前", ava: "rabbit", tag: "求助",
    comments: [], roses: [], vis: 0, urg: 1 }
];

const STUB = () => {
  function makeWav() {
    const sr = 8000, n = sr * 8;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: "audio/wav" });
  }
  window.__tts = [];
  const orig = window.fetch;
  window.fetch = function (u) {
    const url = String(u);
    if (url.indexOf("/yrbtts") > -1) {
      window.__tts.push(decodeURIComponent((url.match(/t=([^&]*)/) || ["", "?"])[1]).slice(0, 16));
      return Promise.resolve(new Response(makeWav(), { status: 200 }));
    }
    return orig ? orig.apply(this, arguments) : Promise.reject(new Error("no fetch"));
  };
};

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','1');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));

  await p.goto("http://127.0.0.1:8794/index.html?pill=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(l => { S.posts = l; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POSTS);
  await p.waitForTimeout(900);

  const stat = () => p.evaluate(() => {
    const el = document.getElementById("mfAuto");
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const auds = [...document.querySelectorAll("audio")];
    return {
      exists: !!el, text: el ? el.textContent.trim() : "",
      clickable: !!(el && hit && (hit === el || el.contains(hit))),
      inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0,
      z: el ? getComputedStyle(el).zIndex : "",
      playing: auds.filter(a => !a.paused).length,
      ls: (function () { try { return localStorage.getItem("yrb_autospeak"); } catch (e) { return "?"; } })(),
      tts: (window.__tts || []).length,
      fs: document.getElementById("r23Detail").classList.contains("mf-fs"),
      open: document.getElementById("r23Detail").classList.contains("open")
    };
  });

  const s1 = await stat();
  ck("P1 首页：胶囊可见可点", s1.exists && s1.inView && s1.clickable && /跟读中/.test(s1.text), JSON.stringify(s1));

  /* 进详情全屏（朗读进行中） */
  await p.evaluate(() => {
    const l = document.querySelector('#feed .card[data-id="9101"] [data-r23detail]');
    if (l) l.click();
  });
  await p.waitForTimeout(1300);
  const s2 = await stat();
  ck("P2 全屏详情：胶囊仍可点（原先被详情层盖住）",
    s2.open && s2.fs && s2.inView && s2.clickable, JSON.stringify(s2));

  /* 点胶囊 → 关跟读 + 停声 */
  await p.click("#mfAuto");
  await p.waitForTimeout(800);
  const s3 = await stat();
  ck("P3 全屏里点胶囊 → 关跟读", /跟读关/.test(s3.text) && s3.ls === "0", JSON.stringify(s3));
  ck("P4 关掉后没有在播放的音频", s3.playing === 0, "playing=" + s3.playing);

  /* 再点 → 恢复 */
  await p.click("#mfAuto");
  await p.waitForTimeout(600);
  const s4 = await stat();
  ck("P5 再点恢复跟读", /跟读中/.test(s4.text) && s4.ls === "1", JSON.stringify(s4));

  /* 退出全屏、关详情，胶囊回到首页仍可点 */
  await p.evaluate(() => { document.getElementById("r23DBack").click(); });
  await p.waitForTimeout(700);
  const s5 = await stat();
  ck("P6 关闭详情后胶囊仍在首页可点", !s5.open && !s5.fs && s5.inView && s5.clickable, JSON.stringify(s5));

  ck("P7 无脚本错误", errs.length === 0, errs.join(" | "));

  console.log("\n" + pass + "/" + (pass + fail) + " 通过");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
