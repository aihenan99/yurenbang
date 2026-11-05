/* 系统返回（手机侧滑 / 返回键）接管：返回上一级，而不是退出应用（mediafull 第 7 节 pfHistPush）
   用户反馈：全屏里左右滑，整个 APP 直接退出了。
   断言：
   K1 进全屏 → 历史栈里押了占位记录（history.state.yrbFull=1）
   K2 系统返回 → 只退出全屏（详情仍在、页面没走、地址没变）
   K3 再进全屏仍能押上垫片
   K4 页面自己左右滑退出 → 全屏收回、详情仍在
   K5 之后系统返回 → 关详情（再上一级），页面依旧没走
   K6 详情用返回按钮正常关闭 → 垫片被还回去（state 不再是占位）
   K7 全程无脚本错误 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const LONG = "每天晚上写作业都要拖到十点，一说就哭。我试过陪着写、也试过定闹钟，都不太管用。" +
  "后来又试了番茄钟，前两天有点用，第三天就完全失效了。孩子在学校上课也坐不住，老师反映说小动作特别多。" +
  "求有经验的家长指点一下，到底应该怎么引导，还是需要去测一下注意力？";
const POSTS = [
  { id: 9101, user: "测试家长", title: "孩子写作业拖拉怎么办", text: LONG,
    likes: 3, favs: 1, helps: 2, time: "10 分钟前", ava: "rabbit", tag: "求助",
    comments: [{ user: "家长A", text: "先陪他做十分钟", likes: 1, liked: false }],
    roses: ["家长A"], vis: 0, urg: 1 },
  { id: 9102, user: "另一位家长", title: "孩子不肯自己睡", text: "五岁了还要大人陪睡，一关灯就哭，怎么办？",
    likes: 0, favs: 0, helps: 0, time: "刚刚", ava: "rabbit", tag: "求助",
    comments: [], roses: [], vis: 0, urg: 1 }
];

const STUB = () => {
  function makeWav() {
    const sr = 8000, n = sr * 6;
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
      window.__tts.push(1);
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
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});(" + STUB.toString() + ")();"
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => { errs.push(e.message); console.log("PAGEERR", e.message); });
  p.on("framenavigated", f => { if (f === p.mainFrame()) console.log("NAV", f.url()); });

  await p.goto("http://127.0.0.1:8794/index.html?back=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(list => {
    S.posts = list;
    try { switchTab("home"); } catch (e) {}
    try { renderFeed(); } catch (e) {}
  }, POSTS);
  await p.waitForTimeout(700);

  const url0 = p.url();
  const st = () => p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    return {
      open: d.classList.contains("open"), fs: d.classList.contains("mf-fs"),
      state: JSON.stringify(history.state || null),
      url: location.href,
      alive: !!document.getElementById("feed"),
      hlen: history.length
    };
  });

  /* —— K1 进全屏 → 押垫片 —— */
  await p.locator('#feed .card[data-id="9101"] .p-text').first().click();
  await p.waitForTimeout(1000);
  const s1 = await st();
  ck("K1 进全屏且历史栈押了占位记录", s1.open && s1.fs && /yrbFull/.test(s1.state), JSON.stringify(s1));

  /* —— K2 系统返回 → 只退全屏，不离开页面 —— */
  await p.evaluate(() => history.back());
  await p.waitForTimeout(700);
  const s2 = await st();
  ck("K2 系统返回 → 退出全屏但详情仍在", s2.fs === false && s2.open === true, JSON.stringify(s2));
  ck("K2b 页面没被退走（网址不变 + 信息流还在）", s2.url === url0 && s2.alive, JSON.stringify({ u: s2.url, v: url0, alive: s2.alive }));
  ck("K2c 垫片已被消耗", !/yrbFull/.test(s2.state), s2.state);

  /* —— K3 关掉详情重新进：垫片重新押上 —— */
  await p.evaluate(() => { const b = document.getElementById("r23DBack"); if (b) b.click(); });
  await p.waitForTimeout(700);
  await p.locator('#feed .card[data-id="9101"] .p-text').first().click();
  await p.waitForTimeout(900);
  const s3 = await st();
  ck("K3 再进全屏仍押上垫片", s3.open && s3.fs && /yrbFull/.test(s3.state), JSON.stringify(s3));

  /* —— K4 页面自己的左右滑 → 退全屏，详情还在 —— */
  await p.evaluate(() => {
    const el = document.querySelector("#r23Detail .r23-dcard .p-text");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x - 130, y + 4));
  });
  await p.waitForTimeout(600);
  const s4 = await st();
  ck("K4 左右滑 → 退出全屏、详情仍在", s4.open && !s4.fs, JSON.stringify(s4));

  /* —— K5 随后的系统返回 → 关详情（上一级），页面依旧没走 —— */
  await p.evaluate(() => history.back());
  await p.waitForTimeout(800);
  const s5 = await st();
  ck("K5 系统返回 → 关详情而非退出应用", s5.open === false && s5.url === url0 && s5.alive, JSON.stringify(s5));

  /* —— K6 正常关闭详情时把垫片还回去 —— */
  await p.locator('#feed .card[data-id="9101"] .p-text').first().click();
  await p.waitForTimeout(900);
  await p.evaluate(() => { const b = document.getElementById("r23DBack"); if (b) b.click(); });
  await p.waitForTimeout(900);
  const s6 = await st();
  ck("K6 详情正常关闭后垫片已还回（不会按了没反应）", !s6.open && !/yrbFull/.test(s6.state) && s6.url === url0,
    JSON.stringify(s6));

  ck("K7 全程无脚本错误", errs.length === 0, errs.join(" | "));

  console.log("\n" + (fail === 0 ? "全部通过" : "失败 " + fail + " 项") + "：" + pass + "/" + (pass + fail));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
