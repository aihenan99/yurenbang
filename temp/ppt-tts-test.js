/* ppt-tts-test.js — PPT 全文朗读回归（2026-10-24）
   覆盖：pagesFor 全文提取（多页/页序/实体解码）/ 长文分段朗读 /
        案例查看器 🔊 降级兜底 / 页面无脚本错误 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const URL = "http://127.0.0.1:8794/?ptts=" + Date.now();

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + "  [" + (extra || "") + "]"); }
}

/* 用真实 sample_fixed.pptx（cover-test 同款，pptx-preview 引擎认它） */
const fs = require("fs");
const PPTX_FILE = "E:/育人帮/temp/ppt-test/sample_fixed.pptx";

(async () => {
  const pptxBuf = fs.readFileSync(PPTX_FILE);

  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  /* 拦截 test pptx 请求 */
  await ctx.route("**/t1.pptx", r => r.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", body: pptxBuf }));
  /* 无头 speechSynthesis 替身：捕获文本并自动触发 onend（链式分段才会继续） */
  await p.addInitScript(() => {
    const cap = []; window.__cap = cap;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: u => { cap.push(String(u.text || "")); setTimeout(() => { try { u.onend && u.onend(); } catch (e) {} }, 0); },
        cancel() { window.__cancelled = (window.__cancelled || 0) + 1; }
      }
    });
  });
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2400);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(700);

  /* T1 API 就绪 */
  const t1 = await p.evaluate(() => ({
    ppt: !!window.YRB_PPT && typeof YRB_PPT.pagesFor === "function",
    mf: !!window.YRB_MEDIAFULL
  }));
  ck("YRB_PPT.pagesFor API 就绪", t1.ppt);
  ck("mediafull 层就绪", t1.mf);

  /* T2 全文提取：真实 pptx → 至少 1 页、每页都有文字 */
  const t2 = await p.evaluate(async () => {
    try {
      const pages = await YRB_PPT.pagesFor(location.origin + "/t1.pptx");
      return { ok: true, pages: pages };
    } catch (e) { return { ok: false, err: String(e && e.message || e).slice(0, 80) }; }
  });
  ck("pagesFor 提取成功", t2.ok, t2.err || "");
  const pages = t2.pages || [];
  ck("提取出页面且每页有文字", pages.length >= 1 && pages.every(p => typeof p === "string" && p.length > 0), "pages=" + pages.length + " " + JSON.stringify(pages).slice(0, 100));

  /* T3 二次调用走缓存（不再发请求） */
  let reqs = 0;
  ctx.on("request", r => { if (r.url().endsWith("t1.pptx")) reqs++; });
  await p.evaluate(() => YRB_PPT.pagesFor(location.origin + "/t1.pptx"));
  ck("缓存命中不重复下载", reqs === 0, "reqs=" + reqs);

  /* T4 长文分段朗读：6000 字 → 多段顺序播、每段 ≤200 字、全文=原串前 3600 字 */
  await p.evaluate(() => {
    window.__cap.length = 0;
    const long = Array.from({ length: 600 }, (_, i) => "这是第" + (i + 1) + "句测试内容。").join("");
    window.__long = long;
    const btn = document.createElement("button");
    btn.id = "ttsProbe";
    document.body.appendChild(btn);
    YRB_MEDIAFULL.speak(long, btn);
  });
  await p.waitForTimeout(2500);
  const t4 = await p.evaluate(() => {
    const cap = window.__cap;
    const joined = cap.join("");
    return {
      n: cap.length,
      maxLen: Math.max.apply(null, cap.map(s => s.length)),
      exact: joined === window.__long.slice(0, 3600),
      joinedLen: joined.length,
      btnDone: document.getElementById("ttsProbe").textContent.indexOf("朗读") >= 0
    };
  });
  ck("长文切成多段朗读", t4.n > 10, "段数=" + t4.n);
  ck("每段 ≤200 字", t4.maxLen <= 200, "max=" + t4.maxLen);
  ck("分段拼回=原文前 3600 字（无丢字重字）", t4.exact, "len=" + t4.joinedLen);
  ck("播完按钮复位", t4.btnDone);

  /* T5 朗读中重复点击同一按钮 = 停止：旧链作废，只播新内容 */
  const t5 = await p.evaluate(() => {
    const btn = document.getElementById("ttsProbe");
    window.__cap.length = 0; window.__cancelled = 0;
    YRB_MEDIAFULL.speak("第一段很长的话。".repeat(30), btn);   /* 开始朗读 */
    YRB_MEDIAFULL.speak("再试一次", btn);                       /* 同按钮 → 停止 */
    YRB_MEDIAFULL.speak("重新开始朗读。", btn);                  /* 新链 */
    return { cancelled: window.__cancelled, capNow: window.__cap.length };
  });
  await p.waitForTimeout(600);
  const t5b = await p.evaluate(() => ({ cap: window.__cap.slice(), cancelled: window.__cancelled }));
  ck("停止后旧分段链作废（cancel 被调用）", t5.cancelled >= 2, "cancelled=" + t5.cancelled);
  ck("最终只播了新的内容", t5b.cap.length === 2 && t5b.cap[1] === "重新开始朗读。", JSON.stringify(t5b.cap));

  /* T6 案例查看器 🔊 注入 + 兜底朗读（状态里无此案例 → 只读标题） */
  const t6 = await p.evaluate(() => {
    window.__cap.length = 0;
    const viewer = document.getElementById("viewer");
    viewer.classList.add("open");
    document.getElementById("vwTitle").textContent = "无数据兜底案例";
    let head = viewer.querySelector(".vw-head");
    if (!head) {
      head = document.createElement("div");
      head.className = "vw-head";
      head.innerHTML = '<button id="vwX">✕</button>';
      viewer.insertBefore(head, viewer.firstChild);
    }
    return new Promise(res => setTimeout(() => {
      const tb = head.querySelector(".mf-tts");
      if (!tb) return res({ has: false });
      tb.click();
      setTimeout(() => res({ has: true, cap: window.__cap.slice() }), 300);
    }, 600));
  });
  ck("查看器头部注入 🔊 按钮", t6.has);
  ck("无案例数据时兜底朗读标题", (t6.cap || []).join("") === "无数据兜底案例", JSON.stringify(t6.cap));

  /* T7 内容保护：非管理员工具栏不出现「📂 打开文件」（原文件=可下载） */
  const t7 = await p.evaluate(async () => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:346px;height:260px;z-index:99999;background:#fff";
    document.body.appendChild(host);
    YRB_PPT.mount(host, { url: location.origin + "/t1.pptx", name: "保护测试.pptx" });
    const ok = await new Promise(res => {
      const t0 = Date.now();
      (function poll() {
        const tools = host.querySelector(".vp-tools");
        if (tools) return res(true);
        if (Date.now() - t0 > 20000) return res(false);
        setTimeout(poll, 300);
      })();
    });
    const tools = host.querySelector(".vp-tools");
    const r = {
      rendered: ok,
      noOpen: tools ? !tools.querySelector("a.vp-tool") : null,
      hasFull: tools ? !!tools.querySelector("[data-a='full']") : false,
      btns: tools ? tools.querySelectorAll("button.vp-tool,a.vp-tool").length : 0
    };
    host.remove();
    return r;
  });
  ck("非管理员 PPT 正常渲染", t7.rendered, JSON.stringify(t7));
  ck("非管理员工具栏无「打开文件」入口", t7.noOpen === true && t7.hasFull, JSON.stringify(t7));

  /* T8 管理员豁免：解锁后台后重新打开，工具栏保留「📂 打开文件」 */
  const t8 = await p.evaluate(async () => {
    window.YRB_ADMINGUARD = { unlocked: () => true };          /* 模拟后台已解锁 */
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:346px;height:260px;z-index:99999;background:#fff";
    document.body.appendChild(host);
    YRB_PPT.mount(host, { url: location.origin + "/t1.pptx", name: "管理员测试.pptx" });
    const tools = await new Promise(res => {
      const t0 = Date.now();
      (function poll() {
        const t = host.querySelector(".vp-tools");
        if (t) return res(t);
        if (Date.now() - t0 > 20000) return res(null);
        setTimeout(poll, 300);
      })();
    });
    const r = { open: tools ? !!tools.querySelector("a.vp-tool") : false };
    host.remove();
    delete window.YRB_ADMINGUARD;
    return r;
  });
  ck("管理员保留「打开文件」入口", t8.open === true, JSON.stringify(t8));

  /* T9 页面零脚本错误 */
  ck("无脚本错误", errs.length === 0, errs.join(" | "));

  await b.close();
  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试崩溃：", e); process.exit(2); });
