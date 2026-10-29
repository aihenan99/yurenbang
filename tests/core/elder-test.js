/* elder-test：长辈模式在三层（mediafull / casedit / pptview）的适老适配回归
   背景：审核记录「长辈模式 mediafull/casedit/pptview 三层零适配」。2026-10-29 补齐后
         用真实浏览器量计算样式，防止以后改样式时又把长辈档弄丢。
   关键点：pptview 的全屏阅读层 #vpFull 是 document.body.appendChild 创建的，不在 #phone 内，
         所以这层必须靠 access.js 同步的 html[data-elder="1"] 命中——本用例专门锁这条。
   运行前：python -m http.server 8793 --bind 127.0.0.1（项目根，测 /deploy-cn/ 产物） */
const { chromium } = require("../helpers/pw.js").loadPlaywright();
const CHROME = require("../helpers/pw.js").chromePath();
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8793/deploy-cn/";
let pass = 0, fail = 0;
function T(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  /* 长辈设置走持久化恢复（真实用户路径：上次开着，下次打开还是开着）。
     必须在 addInitScript 里写：reload 时 pagehide/visibilitychange 会触发 access.js 的
     save()，把内存里的 elder="0" 写回，evaluate 后再刷新会被覆盖 */
  await ctx.addInitScript(() => {
    try {
      const d = JSON.parse(localStorage.getItem("yrb_state_v1") || "{}") || {};
      d.elder = "1";
      localStorage.setItem("yrb_state_v1", JSON.stringify(d));
    } catch (e) {}
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await p.goto(BASE + "?elder=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1600);

  /* ================= A. 标记同步 ================= */
  const mark = await p.evaluate(() => ({
    html: document.documentElement.getAttribute("data-elder"),
    phone: document.getElementById("phone").getAttribute("data-elder"),
    cePanel: !!document.getElementById("cePanel")
  }));
  T("长辈模式开启后 html 与 #phone 标记同步为 1", mark.html === "1" && mark.phone === "1", mark);
  T("图文编辑器面板已注入（#cuTypes 存在即建，供后续量测）", mark.cePanel === true, mark);

  /* ================= B~D. 三层量测（真实类名、真实挂载点） ================= */
  const m = await p.evaluate(() => {
    const out = {};
    const phone = document.getElementById("phone");
    /* mediafull：朗读胶囊注入在 .r23-dhead（详情页头部），这里等价还原它的位置 */
    if (!document.querySelector(".r23-dhead")) {
      const d = document.createElement("div");
      d.className = "r23-dhead";
      d.style.cssText = "display:flex;align-items:center;position:relative;z-index:1";
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "mf-tts"; btn.textContent = "🔊 朗读";
      d.appendChild(btn);
      (document.getElementById("r23Detail") || phone).appendChild(d);
    }
    const tts = document.querySelector(".r23-dhead .mf-tts");
    if (tts) {
      const cs = getComputedStyle(tts), r = tts.getBoundingClientRect();
      out.tts = { fs: parseFloat(cs.fontSize), h: Math.round(r.height) };
    }
    /* casedit：面板默认 hidden，展开才量得到按钮高度 */
    const pan = document.getElementById("cePanel");
    if (pan) pan.hidden = false;
    const ceB = document.querySelector("#ceBar button[data-ce='h3']");
    const ceP = document.getElementById("cePaper");
    if (ceB) { const cs = getComputedStyle(ceB), r = ceB.getBoundingClientRect(); out.ceBar = { fs: parseFloat(cs.fontSize), h: Math.round(r.height) }; }
    if (ceP) { const cs = getComputedStyle(ceP); out.cePaper = { fs: parseFloat(cs.fontSize), lh: +(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2) }; }
    /* pptview 非全屏：查看器里的翻页条 */
    if (!document.querySelector(".vp-nav")) {
      const nav = document.createElement("div");
      nav.className = "vp-nav";
      nav.innerHTML = '<button class="vp-btn">← 上一页</button><span class="vp-num">1 / 12</span><button class="vp-btn">下一页 →</button>';
      phone.appendChild(nav);
    }
    const vpB = document.querySelector(".vp-nav .vp-btn");
    const vpN = document.querySelector(".vp-nav .vp-num");
    if (vpB) { const cs = getComputedStyle(vpB); out.vpBtn = { fs: parseFloat(cs.fontSize), pad: parseFloat(cs.paddingTop) }; }
    if (vpN) out.vpNum = { fs: parseFloat(getComputedStyle(vpN).fontSize) };
    /* pptview 全屏层：body 直属（这是本用例的核心断言） */
    if (!document.getElementById("vpFull")) {
      const lay = document.createElement("div");
      lay.id = "vpFull";
      lay.style.display = "block";
      lay.innerHTML =
        '<div class="vf-head"><b class="vf-name">长辈模式测试.pptx</b><button class="vf-x">✕</button></div>' +
        '<div class="vf-body"></div>' +
        '<div class="vf-foot"><button class="vf-btn">← 上一页</button><span class="vf-num">1 / 12</span><button class="vf-btn">下一页 →</button></div>';
      document.body.appendChild(lay);
    }
    const fx = document.querySelector("#vpFull .vf-x");
    const fb = document.querySelector("#vpFull .vf-btn");
    const fn = document.querySelector("#vpFull .vf-num");
    if (fx) { const r = fx.getBoundingClientRect(); out.vfX = { w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(getComputedStyle(fx).fontSize) }; }
    if (fb) out.vfBtn = { fs: parseFloat(getComputedStyle(fb).fontSize) };
    if (fn) out.vfNum = { fs: parseFloat(getComputedStyle(fn).fontSize) };
    out.vfInPhone = !!(document.getElementById("vpFull") || {}).closest && !!document.getElementById("vpFull").closest("#phone");
    return out;
  });

  T("mediafull 朗读按钮：≥15px 且 ≥40px 高（点得中）", m.tts && m.tts.fs >= 15 && m.tts.h >= 40, m.tts);
  T("casedit 工具条：≥17px 且 ≥47px 触点", m.ceBar && m.ceBar.fs >= 17 && m.ceBar.h >= 47, m.ceBar);
  T("casedit 正文：≥19px 且行高 ≥1.9", m.cePaper && m.cePaper.fs >= 19 && m.cePaper.lh >= 1.9, m.cePaper);
  T("pptview 翻页按钮（查看器内）：≥17px", m.vpBtn && m.vpBtn.fs >= 17, m.vpBtn);
  T("pptview 页码（查看器内）：≥14.5px", m.vpNum && m.vpNum.fs >= 14.5, m.vpNum);
  T("pptview 全屏层确实挂在 body 下（不在 #phone 内，只能靠 html 标记）", m.vfInPhone === false, m.vfInPhone);
  T("pptview 全屏层关闭按钮：≥52px（html[data-elder] 前缀生效）", m.vfX && m.vfX.w >= 52, m.vfX);
  T("pptview 全屏层翻页按钮：≥18px", m.vfBtn && m.vfBtn.fs >= 18, m.vfBtn);
  T("pptview 全屏层页码：≥15px", m.vfNum && m.vfNum.fs >= 15, m.vfNum);

  /* ================= E. 关闭后回落（不留残余放大） =================
     以 S 为唯一真源：只改 DOM 属性会被 access.js 的 observer 按 S.elder 拉回。
     .mf-tts 带 transition:all .15s，立刻读会拿到过渡起点，必须等过渡结束 */
  await p.evaluate(() => {
    try { S.elder = "0"; } catch (e) {}
    document.getElementById("phone").dataset.elder = "0";
  });
  await p.waitForTimeout(420);
  const off = await p.evaluate(() => {
    const g = s => {
      const el = document.querySelector(s);
      return el ? { fs: parseFloat(getComputedStyle(el).fontSize), h: Math.round(el.getBoundingClientRect().height) } : null;
    };
    return {
      html: document.documentElement.getAttribute("data-elder"),
      tts: g(".r23-dhead .mf-tts"), ceBar: g("#ceBar button[data-ce='h3']"),
      vfX: g("#vpFull .vf-x"), cePaper: g("#cePaper")
    };
  });
  T("关闭后 html 标记按 S.elder 归零", off.html === "0", off);
  T("关闭后 mediafull 朗读按钮回落（≤13px）", off.tts && off.tts.fs <= 13.5, off.tts);
  T("关闭后 casedit 工具条回落（≤16px）", off.ceBar && off.ceBar.fs <= 16.5, off.ceBar);
  T("关闭后 casedit 正文回落（≤18px）", off.cePaper && off.cePaper.fs <= 18, off.cePaper);
  T("关闭后 pptview 关闭按钮回落（≤44px）", off.vfX && off.vfX.h <= 44, off.vfX);

  T("页面零脚本错误", errs.length === 0, errs.slice(0, 3));

  await b.close();
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS", e); process.exit(1); });
