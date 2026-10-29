/* casedit-test v2：图文编辑器（本地源码直测，不走 bundle、不碰生产）
   覆盖：层注入 / 面板切换 / 粘贴白名单 / 图文混排保序 / 工具条 / 草稿 / 字数提示
         / 发布三态（有列·无列降级·空内容）/ 查看端正文渲染
   运行前：python -m http.server 8796 --bind 127.0.0.1 --directory yurenbang-app  */
const { chromium } = require("../helpers/pw.js").loadPlaywright();
const CHROME = require("../helpers/pw.js").chromePath();
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8796/yurenbang-app.html";
let pass = 0, fail = 0;
function T(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300)); }
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function openPage(b) {
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await p.goto(BASE + "?ce=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(1200);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.click("#splash"); await p.waitForTimeout(600); }
  return { p, errs };
}
async function openDoc(p) {
  await p.evaluate(() => document.querySelector('#cuTypes .seg-btn[data-t="doc"]').click());
  await p.waitForTimeout(250);
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });

  /* ================= A. 基础与清洗 ================= */
  const { p, errs } = await openPage(b);

  T("图文按钮已注入", await p.evaluate(() => !!document.querySelector('#cuTypes .seg-btn[data-t="doc"]')));
  T("编辑面板已注入", await p.evaluate(() => !!document.querySelector("#cePanel")));
  T("面板默认隐藏", await p.evaluate(() => document.querySelector("#cePanel").hidden === true));

  await openDoc(p);
  T("激活：面板显示", await p.evaluate(() => document.querySelector("#cePanel").hidden === false));
  T("激活：媒体格隐藏", await p.evaluate(() => document.querySelector("#cuGrid").style.display === "none"));
  T("激活：提示语已替换", await p.evaluate(() => /粘贴/.test(document.querySelector("#cuNote").textContent)));
  T("激活：字数提示已初始化", await p.evaluate(() => /已写 0 字/.test(document.querySelector("#ceTip").textContent)));

  /* 脏 HTML 清洗 */
  await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    paper.innerHTML = "";
    paper.focus();
    const dt = new DataTransfer();
    dt.setData("text/html",
      '<div style="color:red;font-size:40px" class="x"><p style="text-align:center">你好<b>世界</b></p>' +
      '<script>window.__xss=1<\/script>' +
      '<img src="https://evil.example/x.jpg"><img src="data:image/png;base64,' + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" + '">' +
      '<span style="color:blue">尾随文字</span></div>');
    paper.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(300);
  const cl = await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    return {
      text: paper.textContent.replace(/\s+/g, ""),
      script: !!paper.querySelector("script"),
      evilImg: !!paper.querySelector('img[src^="http"]'),
      dataImg: !!paper.querySelector('img[src^="data:image/"]'),
      center: !!paper.querySelector('p[style*="center"]'),
      attrs: (paper.querySelector("p[style*='center']") || {}).outerHTML || ""
    };
  });
  T("粘贴：文字保留", /你好世界尾随文字/.test(cl.text), cl.text);
  T("粘贴：script 被剥（不执行）", !cl.script && (await p.evaluate(() => !window.__xss)));
  T("粘贴：外链图丢弃", !cl.evilImg);
  T("粘贴：data: 图保留", cl.dataImg);
  T("粘贴：居中样式保留", cl.center, cl.attrs);
  T("粘贴：无残留 class/style 垃圾", !/class=|font-size/.test(cl.attrs), cl.attrs);

  /* 工具条 */
  await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    paper.innerHTML = "<p>标题文字</p><p>正文内容</p>";
    paper.focus();
    const h = paper.querySelector("p");
    const r = document.createRange(); r.selectNodeContents(h);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await p.evaluate(() => document.querySelector('#ceBar [data-ce="h3"]').click());
  await p.waitForTimeout(120);
  T("小标题：P → H3", await p.evaluate(() => !!document.querySelector("#cePaper h3")));
  await p.evaluate(() => document.querySelector('#ceBar [data-ce="center"]').click());
  await p.waitForTimeout(120);
  T("居中：text-align 生效", await p.evaluate(() => /center/i.test((document.querySelector("#cePaper h3") || {}).getAttribute("style") || "")));
  await p.evaluate(() => {
    const ps = document.querySelectorAll("#cePaper p");
    const target = ps[ps.length - 1];
    const paper = document.querySelector("#cePaper");
    paper.focus();
    const r = document.createRange(); r.selectNodeContents(target);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await p.evaluate(() => document.querySelector('#ceBar [data-ce="bold"]').click());
  await p.waitForTimeout(120);
  T("加粗：p 内 b/strong 出现", await p.evaluate(() => {
    const ps = document.querySelectorAll("#cePaper p");
    const last = ps[ps.length - 1];
    return !!(last && last.querySelector("b, strong"));
  }));

  /* 字数提示 */
  await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    paper.innerHTML = "<p>" + "字".repeat(123) + "</p>";
    paper.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await p.waitForTimeout(150);
  T("字数提示：实时统计", await p.evaluate(() => /已写 123 字/.test(document.querySelector("#ceTip").textContent)),
    await p.evaluate(() => document.querySelector("#ceTip").textContent));

  /* 草稿 */
  await p.waitForTimeout(1000);
  T("草稿已存 localStorage", await p.evaluate(() => /字{20}/.test(localStorage.getItem("yrb_casedit_draft_v1") || "")));

  await p.evaluate(() => document.querySelector('#cuTypes .seg-btn[data-t="img"]').click());
  await p.waitForTimeout(200);
  T("停用：面板隐藏", await p.evaluate(() => document.querySelector("#cePanel").hidden === true));
  T("停用：格线恢复", await p.evaluate(() => document.querySelector("#cuGrid").style.display !== "none"));

  /* ================= B. 图文混排粘贴（v2 修复点） ================= */
  await openDoc(p);
  await p.evaluate(() => {
    document.querySelector("#cePaper").innerHTML = "";
    const paper = document.querySelector("#cePaper");
    paper.focus();
    const bin = atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const f = new File([u8], "shot.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(f);
    dt.setData("text/html", "<p>第一段文字</p><img src=\"https://evil.example/a.png\"><p>第二段文字</p>");
    dt.setData("text/plain", "第一段文字\n第二段文字");
    paper.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(1200);
  const mix = await p.evaluate(() => {
    const paper = document.querySelector("#cePaper");
    return {
      text: paper.textContent.replace(/\s+/g, ""),
      imgN: paper.querySelectorAll("img[data-ce-ph]").length,
      evil: !!paper.querySelector('img[src^="http"]')
    };
  });
  T("混排：文本没被丢（v2 修复）", /第一段文字第二段文字/.test(mix.text), mix);
  T("混排：剪贴板图片顶替外链图", mix.imgN === 1 && !mix.evil, mix);

  T("全程无 pageerror", errs.length === 0, errs.join(" | "));
  await p.close();

  /* ================= C. 发布：列缺失 → 降级但绝不丢文字 ================= */
  {
    const { p: p2, errs: e2 } = await openPage(b);
    await openDoc(p2);
    const r = await p2.evaluate(async () => {
      const C = window.YRB_CLOUD;
      window.__pub = [];
      C.signedIn = () => true;
      C.retryCases = () => {};
      // 探测：模拟 content_html 列不存在
      const origFrom = C.client.database.from;
      C.client.database.from = () => ({
        select: () => ({ limit: () => Promise.resolve({ data: [], error: { code: "42703", message: 'column "content_html" does not exist' } }) })
      });
      C.publishCase = function (payload) {
        window.__pub.push(JSON.parse(JSON.stringify(payload)));
        return Promise.resolve({ ok: true, cloudId: 1 });
      };
      document.querySelector("#cuTitle").value = "降级测试";
      document.querySelector("#cePaper").innerHTML = "<p>这段文字很重要不能丢</p>";
      document.querySelector("#cuGo").click();
      await new Promise(r => setTimeout(r, 2500));
      C.client.database.from = origFrom;
      return {
        pubs: window.__pub,
        paperText: document.querySelector("#cePaper").textContent.replace(/\s+/g, ""),
        tip: document.querySelector("#ceTip").textContent,
        draft: localStorage.getItem("yrb_casedit_draft_v1") || "",
        busy: document.querySelector("#cuGo").disabled
      };
    });
    T("降级：只发了一次图片版（无 content_html）", r.pubs.length === 1 && !("content_html" in r.pubs[0]), r.pubs);
    T("降级：正文文字仍留在编辑器", /这段文字很重要不能丢/.test(r.paperText), r.paperText);
    T("降级：明确告知正文没保存", /正文没能保存/.test(r.tip), r.tip);
    T("降级：草稿仍在本地", /这段文字很重要不能丢/.test(r.draft));
    T("降级：按钮已恢复可用", r.busy === false);
    T("降级：无 pageerror", e2.length === 0, e2.join("|"));
    await p2.close();
  }

  /* ================= D. 发布：列存在 → 带正文 + 清空编辑器 ================= */
  {
    const { p: p3, errs: e3 } = await openPage(b);
    await openDoc(p3);
    const r = await p3.evaluate(async () => {
      const C = window.YRB_CLOUD;
      window.__pub = [];
      C.signedIn = () => true;
      C.retryCases = () => {};
      const origFrom = C.client.database.from;
      C.client.database.from = () => ({
        select: () => ({ limit: () => Promise.resolve({ data: [{ content_html: "" }], error: null }) })
      });
      C.publishCase = function (payload) {
        window.__pub.push(JSON.parse(JSON.stringify(payload)));
        return Promise.resolve({ ok: true, cloudId: 2 });
      };
      document.querySelector("#cuTitle").value = "正常测试";
      document.querySelector("#cePaper").innerHTML = "<p>正常正文</p><h3>小标题</h3>";
      document.querySelector("#cuGo").click();
      await new Promise(r => setTimeout(r, 2500));
      C.client.database.from = origFrom;
      return {
        pubs: window.__pub,
        paperEmpty: document.querySelector("#cePaper").innerHTML.trim() === "",
        titleEmpty: document.querySelector("#cuTitle").value === "",
        draft: localStorage.getItem("yrb_casedit_draft_v1"),
        busy: document.querySelector("#cuGo").disabled
      };
    });
    T("正常：带 content_html 发布", r.pubs.length === 1 && /正常正文/.test(r.pubs[0].content_html || ""), r.pubs);
    T("正常：正文里 img 已换成 data-yrb-media 契约", !/data-ce-ph/.test((r.pubs[0] || {}).content_html || ""));
    T("正常：发布后清空编辑器", r.paperEmpty && r.titleEmpty);
    T("正常：草稿已清除", r.draft === null);
    T("正常：按钮已恢复可用", r.busy === false);
    T("正常：无 pageerror", e3.length === 0, e3.join("|"));
    await p3.close();
  }

  /* ================= E. 空内容发布被拦截 ================= */
  {
    const { p: p4 } = await openPage(b);
    await openDoc(p4);
    const r = await p4.evaluate(async () => {
      const C = window.YRB_CLOUD;
      window.__pub = [];
      C.signedIn = () => true;
      C.publishCase = function (payload) { window.__pub.push(payload); return Promise.resolve({ ok: true }); };
      document.querySelector("#cuTitle").value = "空内容";
      document.querySelector("#cePaper").innerHTML = "";
      document.querySelector("#cuGo").click();
      await new Promise(r => setTimeout(r, 1200));
      return { pubs: window.__pub.length, busy: document.querySelector("#cuGo").disabled };
    });
    T("空内容：不发起发布", r.pubs === 0, r);
    T("空内容：按钮未被卡住", r.busy === false);
    await p4.close();
  }

  /* ================= F. 查看端：图文案例正文渲染（v2 新增） ================= */
  {
    const { p: p5, errs: e5 } = await openPage(b);
    const r = await p5.evaluate(async () => {
      const url = "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      S.cases.unshift({
        t: "图文查看测试", by: "家长", ava: "animal", type: "img", kind: "study",
        media: [{ kind: "img", path: "a.png", url }],
        content_html: '<p>查看端正文第一段</p><h3>小标题在这</h3><img data-yrb-media="0">' +
                      '<script>window.__vw=1<\/script><p style="text-align:center">居中段落</p>',
        helps: 3, likes: 4, favs: 5
      });
      renderCases();
      const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
      if (!card) return { err: "no-card" };
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      const body = document.querySelector("#vwBody");
      const doc = body.querySelector(".yrb-doc-body");
      return {
        open: document.querySelector("#viewer").classList.contains("open"),
        hasDoc: !!doc,
        text: doc ? doc.textContent.replace(/\s+/g, "") : "",
        imgSrc: doc && doc.querySelector("img") ? doc.querySelector("img").getAttribute("src") : "",
        imgLeftSeq: doc ? doc.querySelectorAll("img[data-yrb-media]").length : -1,
        center: doc ? !!doc.querySelector('p[style*="center"]') : false,
        script: doc ? !!doc.querySelector("script") : true,
        vwXss: !!window.__vw,
        stats: body.textContent.indexOf("3") > -1 && body.textContent.indexOf("5") > -1
      };
    });
    T("查看端：查看器已打开", r.open, r);
    T("查看端：正文块已渲染", r.hasDoc, r);
    T("查看端：正文文字可见", /查看端正文第一段小标题在这居中段落/.test(r.text), r.text);
    T("查看端：图片已填签名地址", /^data:image\//.test(r.imgSrc), r.imgSrc.slice(0, 40));
    T("查看端：契约属性已清除", r.imgLeftSeq === 0);
    T("查看端：居中样式保留", r.center);
    T("查看端：script 被剥（不执行）", !r.script && !r.vwXss);
    T("查看端：互动数据仍显示", r.stats, r);
    T("查看端：无 pageerror", e5.length === 0, e5.join("|"));
    await p5.close();
  }

  /* ================= G. 查看端：非图文案例不被接管 ================= */
  {
    const { p: p6 } = await openPage(b);
    const r = await p6.evaluate(async () => {
      S.cases.unshift({
        t: "普通图片案例", by: "家长", ava: "animal", type: "img", kind: "study",
        media: [{ kind: "img", path: "b.png", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }],
        helps: 0, likes: 0, favs: 0
      });
      renderCases();
      const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return {
        hasDoc: !!document.querySelector("#vwBody .yrb-doc-body"),
        hasImgs: !!document.querySelector("#vwBody .vw-imgs"),
        open: document.querySelector("#viewer").classList.contains("open")
      };
    });
    T("非图文：不插正文块", !r.hasDoc, r);
    T("非图文：原有图片墙正常", r.hasImgs && r.open, r);
    await p6.close();
  }

  /* ================= H. 本轮新增接线：探针 / 列表封面 / 纯文本兜底 ================= */
  {
    const { p: p7, errs: e7 } = await openPage(b);
    const r = await p7.evaluate(async () => {
      const out = {};
      out.flag = !!window.YRB_CASED;
      out.healthHasLayer = !!(window.YRB_HEALTH && YRB_HEALTH.layers && YRB_HEALTH.layers().indexOf("casedit") > -1);

      // 纯文字案例（无配图）应标「图文」而不是「图片」
      S.cases.unshift({
        t: "纯文字案例", by: "家长", ava: "animal", type: "img", kind: "study",
        media: [], content_html: "<p>只有字没有图</p>", helps: 0, likes: 0, favs: 0
      });
      renderCases();
      const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
      out.cardType = card ? (card.querySelector(".c-type") || {}).textContent || "" : "no-card";

      // 富文本清洗后为空（只有 script）→ 回退纯文本
      document.querySelector('#cuTypes .seg-btn[data-t="doc"]').click();
      await new Promise(r => setTimeout(r, 200));
      const paper = document.querySelector("#cePaper");
      paper.innerHTML = "";
      const dt = new DataTransfer();
      dt.setData("text/html", "<script>1<\/script><style>x{}</style>");
      dt.setData("text/plain", "兜底纯文本");
      paper.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      out.fallbackText = paper.textContent.replace(/\s+/g, "");
      return out;
    });
    T("接线：YRB_CASED 标志已暴露", r.flag);
    T("接线：health 探针已登记 casedit 层", r.healthHasLayer, r);
    T("列表：纯文字案例标「图文」", /图文/.test(r.cardType), r.cardType);
    T("粘贴：富文本被清空时回退纯文本", /兜底纯文本/.test(r.fallbackText), r.fallbackText);
    T("接线：无 pageerror", e7.length === 0, e7.join("|"));
    await p7.close();
  }

  /* ================= I. 查看器朗读接管：图文正文可听 ================= */
  {
    const { p: p8, errs: e8 } = await openPage(b);
    const r = await p8.evaluate(async () => {
      window.__tts = null;
      window.YRB_MEDIAFULL = {
        speak: function (text) { window.__tts = text; },
        stopSpeak: function () {}
      };
      S.cases.unshift({
        t: "朗读测试案例", by: "家长", ava: "animal", type: "img", kind: "study",
        media: [], content_html: "<p>朗读正文第一句。朗读正文第二句。</p>", helps: 0, likes: 0, favs: 0
      });
      renderCases();
      const card = document.querySelector('#caseGrid .case-card[data-i="0"]');
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      // mediafull 注入的朗读按钮：测试环境手动补一个等价按钮
      const vh = document.querySelector(".vw-head");
      if (!vh) return { err: "no-vw-head" };
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "mf-tts"; btn.innerHTML = "🔊 朗读";
      vh.appendChild(btn);
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 250));
      return { tts: window.__tts };
    });
    T("朗读：图文正文进入朗读文本（含标题）", /朗读测试案例。?朗读正文第一句。朗读正文第二句。/.test(r.tts || ""), r.tts);
    T("朗读：无 pageerror", e8.length === 0, e8.join("|"));
    await p8.close();
  }

  console.log("---- casedit-test v2: " + pass + " 通过 / " + fail + " 失败 ----");
  await b.close();
  process.exit(fail ? 2 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
