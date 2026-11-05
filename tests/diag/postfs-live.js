/* 求助全屏阅读新交互：点一下全屏 / 左右滑退出 / 上下滑换一条（mediafull 第 7 节）
   断言：
   B0 卡片带「查看完整求助」入口
   B1 单击卡片文字 → 详情打开 + 全屏 + 自动朗读
   B2 全屏版式生效 + 新提示文案
   B3 全屏中左右滑 → 退出全屏，朗读继续（不新增请求）
   B4 全屏中点一下正文 → 重新进全屏并从头重读（新请求）
   B5 正文滚到中部时上滑 → 不换条（防滚动误触锚定）
   B6 正文滚到底部后上滑 → 换到下一条，自动朗读新条
   B7 在顶部下滑 → 换回上一条
   B8 点 ♥ 按钮不进全屏（按钮自己处理）
   B9 关闭详情 → 全屏类收回，不残留 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const LONG = "每天晚上写作业都要拖到十点，一说就哭。我试过陪着写、也试过定闹钟，都不太管用。" +
  "后来又试了番茄钟，前两天有点用，第三天就完全失效了。孩子在学校上课也坐不住，老师反映说小动作特别多。" +
  "家里老人说是缺微量元素，带去查了又都正常。求有经验的家长指点一下，到底应该怎么引导，还是需要去测一下注意力？" +
  "补充一下：他写作业的时候总要先玩橡皮，提醒一次能好两分钟，之后又开始走神。" +
  "老师说他上课听讲还行，就是做题慢，考试经常写不完，我们也不想给他太大压力，" +
  "但看到别的孩子半小时就写完，心里还是着急。有没有家长用过计时器或者作业清单的办法？";
const POSTS = [
  { id: 9101, user: "测试家长", title: "孩子写作业拖拉怎么办", text: LONG,
    likes: 3, favs: 1, helps: 2, time: "10 分钟前", ava: "rabbit", tag: "求助",
    comments: [
      { user: "家长A", text: "先陪他做十分钟，做完就夸一句", likes: 1, liked: false },
      { user: "家长B", text: "我们家是把作业拆成小段，每段之间休息两分钟", likes: 0, liked: false },
      { user: "家长C", text: "别在边上盯着，越盯越慢，可以先约定完成后的奖励", likes: 2, liked: false },
      { user: "家长D", text: "检查一下书桌周围有没有玩具和手机，环境太容易分心", likes: 0, liked: false }
    ],
    roses: ["家长A"], vis: 0, urg: 1 },
  { id: 9102, user: "另一位家长", title: "孩子不肯自己睡", text: "五岁了还要大人陪睡，一关灯就哭，怎么办？",
    likes: 0, favs: 0, helps: 0, time: "刚刚", ava: "rabbit", tag: "求助",
    comments: [], roses: [], vis: 0, urg: 1 },
  { id: 9103, user: "第三位家长", title: "挑食严重怎么破", text: "孩子只吃白米饭，青菜肉都不碰。",
    likes: 1, favs: 0, helps: 0, time: "5 分钟前", ava: "rabbit", tag: "求助",
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
      window.__tts.push(decodeURIComponent((url.match(/t=([^&]*)/) || ["", "?"])[1]).slice(0, 24));
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
  p.on("pageerror", e => console.log("PAGEERR", e.message));

  await p.goto("http://127.0.0.1:8794/index.html?pf=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(list => {
    S.posts = list;
    try { switchTab("home"); } catch (e) {}
    try { renderFeed(); } catch (e) {}
  }, POSTS);
  await p.waitForTimeout(700);

  const hasLink = await p.evaluate(() => !!document.querySelector('#feed .card[data-id="9101"] [data-r23detail]'));
  ck("B0 卡片已带「查看完整求助」入口", hasLink);

  const st = () => p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    const btn = d.querySelector(".r23-dhead .mf-tts");
    return {
      open: d.classList.contains("open"), fs: d.classList.contains("mf-fs"),
      btnOn: !!(btn && btn.classList.contains("on")),
      tts: (window.__tts || []).length, last: (window.__tts || []).slice(-1)[0] || "",
      cur: (function () { try { return String(S.curPost || ""); } catch (e) { return "?"; } })()
    };
  });

  /* —— B1 单击卡片文字 → 全屏 + 朗读 —— */
  await p.locator('#feed .card[data-id="9101"] .p-text').first().click();
  await p.waitForTimeout(1100);
  const s1 = await st();
  const card1 = await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    const c = d.querySelector(".r23-dcard");
    const ts = d.querySelectorAll(".r23-dcard .p-text");
    const t = ts[ts.length - 1];              /* 正文段（第一段是标题，带内联 16px 样式） */
    return { radius: c ? getComputedStyle(c).borderRadius : null, size: t ? getComputedStyle(t).fontSize : null };
  });
  ck("B1 单击卡片 → 详情打开且全屏", s1.open && s1.fs && s1.cur === "9101", JSON.stringify(s1));
  /* 2026-11-03 晚：全屏改为「图大、字小」——正文 14.5px（普通详情 16px），卡片圆角为 0 */
  ck("B2 全屏版式生效 + 自动朗读", s1.tts >= 1 && s1.btnOn && card1.radius === "0px" &&
    parseFloat(card1.size) >= 13.5 && parseFloat(card1.size) <= 15,
    JSON.stringify({ tts: s1.tts, btnOn: s1.btnOn, card: card1 }));
  ck("B2b 提示气泡为新文案", await p.evaluate(() => {
    const t = document.getElementById("mfFsTip");
    return !t || /左右滑返回上一步/.test(t.textContent);
  }));

  /* —— B3 全屏中左右滑 → 退出全屏，朗读继续 —— */
  const t3 = await p.evaluate(() => (window.__tts || []).length);
  await p.evaluate(() => {
    const el = document.querySelector("#r23Detail .r23-dcard .p-text");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x - 120, y));
  });
  await p.waitForTimeout(600);
  const s3 = await st();
  ck("B3 左滑 → 退出全屏但详情还在", s3.open && !s3.fs, JSON.stringify(s3));
  ck("B3b 退出后朗读继续（不新增请求）", s3.btnOn && s3.tts === t3, "before=" + t3 + " after=" + s3.tts);

  /* —— B4 全屏中点一下正文 → 重新全屏 + 从头重读（force：首段可能被顶栏遮住） —— */
  await p.locator("#r23Detail .r23-dcard .p-text").nth(1).click({ force: true });
  await p.waitForTimeout(900);
  const s4 = await st();
  ck("B4 再点一下正文 → 重新全屏 + 从头重读", s4.fs && s4.tts > t3, "tts " + t3 + "→" + s4.tts);

  /* —— B5 滚到中部上滑：不换条（防误触锚定） —— */
  const canScroll = await p.evaluate(() => {
    const bd = document.querySelector("#r23Detail .r23-dbody");
    const range = bd.scrollHeight - bd.clientHeight;
    bd.scrollTop = range / 2;
    return { range: range, top: bd.scrollTop };
  });
  ck("B5a 正文可滚动（锚定断言的前提）", canScroll.range > 40, JSON.stringify(canScroll));
  await p.evaluate(() => {
    const el = document.querySelector("#r23Detail .r23-dcard .p-text");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = Math.min(r.top + 40, innerHeight - 60);
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x, y - 120));
  });
  await p.waitForTimeout(700);
  const s5 = await st();
  ck("B5 中部上滑不换条", s5.cur === "9101", JSON.stringify({ cur: s5.cur, tts: s5.tts }));

  /* —— B6 滚到底部上滑 → 下一条 9102，自动朗读 —— */
  await p.evaluate(() => {
    const bd = document.querySelector("#r23Detail .r23-dbody");
    bd.scrollTop = bd.scrollHeight;
  });
  const t6 = s5.tts;
  await p.evaluate(() => {
    const el = document.querySelector("#r23Detail .r23-dcard .p-text");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = Math.min(r.top + 40, innerHeight - 60);
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x, y - 130));
  });
  await p.waitForTimeout(1000);
  const s6 = await st();
  ck("B6 底部上滑 → 下一条", s6.cur === "9102" && s6.tts > t6, JSON.stringify(s6));

  /* —— B7 在顶部下滑 → 上一条 9101 —— */
  await p.evaluate(() => {
    const el = document.querySelector("#r23Detail .r23-dcard .p-text");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = Math.min(r.top + 40, innerHeight - 60);
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })] });
    el.dispatchEvent(mk("touchstart", x, y));
    el.dispatchEvent(mk("touchend", x, y + 130));
  });
  await p.waitForTimeout(1000);
  const s7 = await st();
  ck("B7 顶部下滑 → 上一条", s7.cur === "9101", JSON.stringify({ cur: s7.cur }));

  /* —— B8 点 ♥ 按钮：不进全屏（先关掉盖着信息流的详情） —— */
  await p.evaluate(() => { document.getElementById("r23DBack").click(); });
  await p.waitForTimeout(600);
  await p.locator('#feed .card[data-id="9101"] .pa-btn.like').first().click();
  await p.waitForTimeout(700);
  const s8 = await st();
  ck("B8 点♥按钮不进全屏", !s8.open && !s8.fs, JSON.stringify({ open: s8.open, fs: s8.fs }));

  /* —— B9 关闭详情：全屏类收回 —— */
  await p.locator('#feed .card[data-id="9102"] .p-text').first().click();
  await p.waitForTimeout(900);
  await p.evaluate(() => { document.getElementById("r23DBack").click(); });
  await p.waitForTimeout(600);
  const s9 = await st();
  ck("B9 关闭详情后全屏类自动收回", !s9.open && !s9.fs, JSON.stringify({ open: s9.open, fs: s9.fs }));

  console.log("\n" + pass + "/" + (pass + fail) + " 通过");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
