/* 视觉核验：求助全屏详情的比例（图占九成、字小）
   在真实 Chrome 里塞一条带 4:3 照片的桩帖，走「查看完整求助」入口进全屏，
   量出图片真宽 + 各段文字字号，并输出截图 temp/postfs-layout.png */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const PHOTO = "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
  '<rect width="800" height="600" fill="#8fb3c7"/>' +
  '<rect y="380" width="800" height="220" fill="#b9a68c"/>' +
  '<circle cx="200" cy="300" r="70" fill="#e8c9a0"/><circle cx="420" cy="290" r="70" fill="#e8c9a0"/>' +
  '<circle cx="640" cy="300" r="70" fill="#e8c9a0"/>' +
  '</svg>').toString("base64");

const POST = {
  id: 9401, user: "爱河南99", flag: "CN", ava: "rabbit", time: "3小时前",
  title: "", text: "看到孩子参加科技竞赛比赛，我感到非常欣慰。大家支持吗？",
  type: "img", urg: 0, helps: 3, likes: 0, favs: 0, vis: 0, roses: [], comments: [],
  media: [{ kind: "img", url: PHOTO, thumbUrl: PHOTO }]
};

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", deviceScaleFactor: 2 });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/index.html?lay=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate((post) => {
    S.posts = [post];
    try { switchTab("home"); } catch (e) {}
    try { renderFeed(); } catch (e) {}
  }, POST);
  await p.waitForTimeout(600);

  /* 走「查看完整求助」按钮（长辈最常用的入口）：应自动进全屏 */
  await p.locator('#feed .card[data-id="9401"] [data-r23detail]').first().click();
  await p.waitForTimeout(1200);

  const m = await p.evaluate(() => {
    const q = s => document.querySelector(s);
    const fs = document.getElementById("r23Detail").classList.contains("mf-fs");
    const img = q("#r23Detail .r23-dimgs .di img");
    const r = img ? img.getBoundingClientRect() : null;
    const cs = el => el ? getComputedStyle(el) : {};
    const head = q("#r23Detail .r23-dhead .sp-title");
    const name = q("#r23Detail .r23-dcard .p-name");
    const text = q("#r23Detail .r23-dcard .p-text:not([style])") || q("#r23Detail .r23-dcard .p-text");
    const status = q("#r23Detail .r23-dcard .r23-status");
    const meta = q("#r23Detail .r23-dcard:first-child > div:last-child");
    return {
      fs: fs,
      vw: innerWidth, vh: innerHeight,
      img: r ? { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(innerWidth - r.right), objFit: cs(img).objectFit } : null,
      fsHead: cs(head).fontSize, fsName: cs(name).fontSize, fsText: cs(text).fontSize,
      fsStatus: cs(status).fontSize, fsMeta: cs(meta).fontSize,
      cardPad: cs(q("#r23Detail .r23-dcard")).padding
    };
  });
  console.log(JSON.stringify(m, null, 1));

  const ok = [];
  ok.push(["全屏类已加", m.fs]);
  ok.push(["图片横向铺满（左右留白 ≤1px）", m.img && m.img.left <= 1 && m.img.right <= 1]);
  ok.push(["图片宽度 ≥ 视口 99%", m.img && m.img.w / m.vw >= 0.99]);
  ok.push(["图片高度 ≥ 视口 30%（4:3 满宽）", m.img && m.img.h / m.vh >= 0.30]);
  ok.push(["标题字号 ≤15px", parseFloat(m.fsHead) <= 15]);
  ok.push(["正文字号 ≤14.5px", parseFloat(m.fsText) <= 14.6]);
  ok.push(["作者名字号 ≤13px", parseFloat(m.fsName) <= 13]);
  ok.push(["可见范围 ≤10.5px", parseFloat(m.fsMeta) <= 10.6]);
  let bad = 0;
  ok.forEach(([n, v]) => { if (!v) bad++; console.log((v ? "✓ " : "✗ ") + n); });
  console.log(bad ? "失败 " + bad + " 项" : "全部通过");

  await p.screenshot({ path: "temp/postfs-layout.png" });
  await b.close();
  process.exit(bad ? 1 : 0);
})();
