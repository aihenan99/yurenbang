/* layering-test：层叠顺序回归（提示必须永远看得见）
   背景（2026-10-30）：#toast 一直是 z-index 75，而 PPT 全屏层 #vpFull 是 200。
   #phone 没有 transform/filter，不形成层叠上下文，所以两者在根上下文里直接比大小——
   结果是全屏阅读里任何提示都被整块盖住：「点了没反应，也看不到为什么」，
   对长辈用户尤其致命。本用例锁三件事：
     1. 提示层（toast / 满屏感谢）在全屏媒体层之上
     2. 强制升级提示仍然高于提示层（升级时不许被遮）
     3. 普通面板 #modal 仍在全屏媒体层之下（全屏就是要独占屏幕）
   层级契约本身由 scripts/zindex-audit.mjs 静态守卫，这里量的是运行时真实绘制顺序。
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
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e && e.message || e)));
  await p.goto(BASE + "?layering=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1200);

  /* 用真实选择器造三层：#vpFull（PPT 全屏，CSS 里 200）与 #yrbUpg（升级面板，99997）。
     样式全部来自生产样式表 / 脚本，不是测试里另写的近似值 */
  const r = await p.evaluate(async () => {
    /* 只造 #vpFull（样式表里就有那条 200 的规则）；#yrbUpg 的样式是 upgrade.js 按需注入的，
       加载时不存在，它的层级关系由 scripts/zindex-audit.mjs 静态守卫 */
    const vp = document.createElement("div"); vp.id = "vpFull"; document.body.appendChild(vp);
    const t = document.getElementById("toast");
    const gf = document.getElementById("gift");
    const md = document.getElementById("modal");
    const z = (el) => el ? parseInt(getComputedStyle(el).zIndex, 10) : null;

    toast("全屏阅读里的提示看得见吗", 4000);
    await new Promise((res) => setTimeout(res, 350));

    /* 命中测试反映真实绘制顺序；toast 平时 pointer-events:none，临时打开只为能测到它 */
    const prevPE = t.style.pointerEvents;
    t.style.pointerEvents = "auto";
    const box = t.getBoundingClientRect();
    const hit = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      .map((e) => e.id || e.className || e.tagName);
    t.style.pointerEvents = prevPE;

    const out = {
      z: { toast: z(t), gift: z(gf), vpFull: z(vp), modal: z(md), viewer: z(document.getElementById("r23Viewer")) },
      toastOnTop: hit.indexOf("toast") === 0,
      stack: hit.slice(0, 4),
      toastShown: t.classList.contains("show")
    };
    vp.remove();
    return out;
  });

  T("toast 层高于 PPT 全屏层", r.z.toast > r.z.vpFull, r.z);
  T("满屏感谢层高于 PPT 全屏层", r.z.gift > r.z.vpFull, r.z);
  T("toast 实际绘制在全屏层之上（命中测试）", r.toastOnTop, r.stack);
  T("提示确实处于显示态", r.toastShown, r);
  T("toast 高于大图查看器", r.z.viewer === null || r.z.toast > r.z.viewer, r.z);
  T("#modal 仍在全屏媒体层之下", r.z.modal < r.z.vpFull, r.z);
  T("层级都落在合理区间（不是随手写的巨数）", r.z.toast >= 90000 && r.z.toast <= 99996 && r.z.vpFull >= 97 && r.z.vpFull <= 999, r.z);

  /* 大图查看器（#r23Viewer，66）打开时提示也要在上面——顺手锁住日常路径 */
  const v = await p.evaluate(async () => {
    const w = document.getElementById("r23Viewer");
    if (!w) return { skip: true };
    w.classList.add("open");
    toast("大图查看中的提示", 3000);
    await new Promise((res) => setTimeout(res, 320));
    const t = document.getElementById("toast");
    const box = t.getBoundingClientRect();
    const prevPE = t.style.pointerEvents;
    t.style.pointerEvents = "auto";
    const hit = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2).map((e) => e.id || e.className);
    t.style.pointerEvents = prevPE;
    w.classList.remove("open");
    return { onTop: hit.indexOf("toast") === 0, stack: hit.slice(0, 3) };
  });
  T("大图查看器打开时提示在最上层", v.skip || v.onTop, v.stack);

  T("页面零脚本错误", errs.length === 0, errs.slice(0, 3));

  await b.close();
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS", e); process.exit(1); });
