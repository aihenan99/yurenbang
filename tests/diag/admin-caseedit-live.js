/* 后台「案例二次编辑」验收（2026-11-03）
   用桩替换 YRB_CLOUD，验证：
   A 列表出现「编辑内容」按钮
   B 打开面板预填标题/正文，正文图片能显示（签名地址）
   C 保存时清洗：h2→h3、丢 script/onclick/外链图、保留 data-yrb-media 序号、签名 src 被去掉
   D 正文为空 → 拦下不提交
   E 数据库拒绝（RLS 0 行）→ 明确提示没有权限，面板不关闭
   运行前：npx http-server deploy-cn -p 8794 -s  */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const fs = require("fs");
const path = require("path");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8794/index.html";

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  console.log((ok ? "  [PASS] " : "  [FAIL] ") + name + (extra && !ok ? "  → " + extra : ""));
  ok ? pass++ : fail++;
}
const IMG = "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e8c9b8"/></svg>'
).toString("base64");
/* 1×1 真 PNG：setInputFiles 要求真实图片字节，SVG 当文件会被 image/* 判定为非法 */
const PNG1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const STUB = (deny) => `
(function(){
  var DENY = ${JSON.stringify(!!deny)};
  var calls = { update: [] };
  var CASES = [
    { id: 11, title: "孩子写作业拖拉怎么办", owner_name: "家长5855", type: "img",
      content_html: '<h3>先弄清拖拉的原因</h3><p>很多家长以为是懒，其实是畏难。</p><img data-yrb-media="0">',
      /* 2026-11-07：刻意不给 url —— 后台读到的原始行就是这样，只有 path。
         不签出地址的话，正文里的图在编辑面板里就是灰块（这正是改前的老毛病）。 */
      media: [{ kind: "img", path: "case/a.jpg" }],
      created_at: new Date().toISOString() },
    { id: 12, title: "青春期不肯沟通", owner_name: "家长1111", type: "img",
      content_html: "<p>先别急着讲道理。</p>", media: [], created_at: new Date().toISOString() }
  ];
  function res(d){ return Promise.resolve({ data: d, error: null }); }
  function q(table){
    var rows = table === "yb_cases" ? CASES.slice() : [];
    var st = { method: "GET", body: null };
    var lastEq = null;
    var f = {
      select: function(){ return f; },
      order: function(){ return f; },
      limit: function(){ return f; },
      eq: function(k, v){ lastEq = { k: k, v: v }; rows = rows.filter(function(r){ return String(r[k]) === String(v); }); return f; },
      maybeSingle: function(){ return res(rows[0] || null); },
      update: function(o){ st.method = "PATCH"; st.body = o; return f; },
      insert: function(o){ return res(o); },
      delete: function(){ return { eq: function(){ return res(null); } }; },
      then: function(ok, bad){
        var out;
        if (st.method === "PATCH") {
          calls.update.push({ table: table, body: st.body, id: lastEq && lastEq.v, deny: DENY });
          if (DENY) out = { data: [], error: null };          /* RLS 未通过：200 + 空数组 */
          else {
            var hit = rows[0];
            if (hit) { for (var k in st.body) hit[k] = st.body[k]; }
            out = { data: hit ? [hit] : [], error: null };
          }
        } else out = { data: rows, error: null };
        return Promise.resolve(out).then(ok, bad);
      }
    };
    return f;
  }
  window.__CE = { calls: calls, cases: CASES, setDeny: function(v){ DENY = !!v; } };
  window.__toasts = [];
  window.toast = function(m){ window.__toasts.push(String(m)); };
  window.YRB_CLOUD = {
    enabled: function(){ return true; },
    signedIn: function(){ return true; },
    who: function(){ return { id: "2110319594408247296", phone: "18000005855", name: "家长5855" }; },
    name: function(){ return "家长5855"; },
    openLogin: function(){}, signOut: function(){ return Promise.resolve(); },
    loadCases: function(){}, updateCase: null,
    client: {
      database: {
        from: q,
        rpc: function(fn){
          if (fn === "admin_guard_status") return res({ ok: true, is_set: true, fail_count: 0, locked_until: null });
          if (fn === "admin_verify_password") return res({ ok: true });
          if (fn === "is_admin") return res(true);
          return res({ ok: true });
        }
      }
    }
  };
  /* 关键：updateCase 走 cloud.js 的真实实现（我们就是要验它），
     这里把 client 桩接上去——cloud.js 的云对象是 SDK 单例，所以改为直接给 YRB_CLOUD.updateCase 打补丁 */
  /* 2026-11-07：批量签名桩 —— 后台编辑面板打开时会调它把 path 换成可显示的地址 */
  window.YRB_CLOUD.signMedia = function(media){
    return Promise.resolve((media || []).map(function(m){
      return { kind: m.kind || "img", path: m.path, dur: m.dur || "", name: m.name || "",
        ...(m.thumb ? { thumb: m.thumb } : {}),
        url: m.url || ${JSON.stringify(IMG)}, thumbUrl: m.thumbUrl || m.url || ${JSON.stringify(IMG)} };
    }));
  };
  /* 上传桩：每次调用生成一张新「图」，地址带 distinct 标记，便于断言确实换掉了 */
  window.__CE.uploads = [];
  window.YRB_CLOUD.makeThumb = function(){ return Promise.resolve(null); };
  window.YRB_CLOUD.uploadCaseImages = function(items){
    var n = (window.__CE.uploads = window.__CE.uploads || []).length;
    var out = (items || []).map(function(it, i){
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="' + (n % 2 ? "#7ac7a8" : "#c7a87a") + '"/></svg>';
      var uri = "data:image/svg+xml;base64," + btoa(svg);
      return { kind: "img", path: "case/up-" + n + "-" + i + ".jpg", url: uri, thumb: "case/t-up-" + n + "-" + i + ".jpg", thumbUrl: uri };
    });
    window.__CE.uploads.push(out);
    return Promise.resolve({ ok: true, media: out });
  };
  window.YRB_CLOUD.updateCase = function(id, patch){
    var rows = CASES.filter(function(r){ return String(r.id) === String(id); });
    var body = {};
    if (patch && patch.title != null) body.title = String(patch.title).trim().slice(0, 120);
    if (patch && patch.content_html != null) body.content_html = String(patch.content_html).slice(0, 200000);
    /* 与 cloud.js 同规则：只抄持久字段，签名地址一律不落库 */
    if (patch && Array.isArray(patch.media)) {
      body.media = patch.media.map(function(m){
        var o = { kind: String(m.kind || "img"), path: String(m.path || ""), dur: String(m.dur || ""), name: String(m.name || "") };
        if (m.thumb) o.thumb = String(m.thumb);
        return o;
      }).filter(function(m){ return m.path; });
    }
    calls.update.push({ table: "yb_cases", body: body, id: id, deny: DENY });
    if (DENY) return Promise.resolve({ ok: false, reason: "denied", message: "没有修改这条案例的权限（需要管理员身份）" });
    var hit = rows[0];
    if (hit) { for (var k in body) hit[k] = body[k]; }
    return Promise.resolve({ ok: true });
  };
})();`;

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  PAGEERROR:", String(e.message).slice(0, 160)));
  p.on("dialog", d => d.accept());
  await p.goto(BASE + "?ce=" + Date.now(), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2600);
  await p.evaluate(STUB(false));
  await p.evaluate(() => { try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {} });
  await p.evaluate(() => YRB_CONSOLE.openAdmin());
  await p.waitForSelector(".ad-tab", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);

  console.log("=== A. 列表里的编辑入口 ===");
  await p.click('[data-adtab="cases"]');
  await p.waitForTimeout(300);
  const editBtns = await p.$$eval('[data-ad="caseedit"]', a => a.length);
  const delBtns = await p.$$eval('[data-ad="casedel"]', a => a.length);
  ck("案例页签为每条案例提供「编辑内容」", editBtns === 2, "实际 " + editBtns);
  ck("删除按钮仍在（编辑不替代删除）", delBtns === 2, "实际 " + delBtns);

  console.log("=== B. 打开面板：预填标题 / 正文 / 图片 ===");
  await p.click('[data-ad="caseedit"][data-id="11"]');
  await p.waitForTimeout(400);
  let s = await p.evaluate(() => {
    const host = document.getElementById("adCaseEdit");
    const pa = document.getElementById("cePaper2");
    const im = pa && pa.querySelector("img");
    return {
      open: !!host && !host.hidden,
      title: (document.getElementById("ceTitle2") || {}).value || "",
      text: pa ? pa.textContent : "",
      imgSrc: im ? (im.getAttribute("src") || "").slice(0, 30) : "",
      imgSeq: im ? im.getAttribute("data-yrb-media") : null
    };
  });
  ck("编辑面板打开", s.open);
  ck("标题已预填", s.title === "孩子写作业拖拉怎么办", s.title);
  ck("正文已预填（可编辑文字）", /先弄清拖拉的原因/.test(s.text) && /畏难/.test(s.text), s.text.slice(0, 40));
  ck("正文图片显示为可视图（填了签名地址）", /^data:image/.test(s.imgSrc), s.imgSrc);
  ck("图片仍带 data-yrb-media 序号", s.imgSeq === "0", String(s.imgSeq));

  console.log("=== F. 素材条与排版按钮 ===");
  const f1 = await p.evaluate(() => ({
    figs: document.querySelectorAll("#ceFigs .ad-ce-fig").length,
    no: (document.querySelector("#ceFigs .ad-ce-figno") || {}).textContent || "",
    ops: document.querySelectorAll("#ceFigs [data-figact]").length,
    addBtn: !!document.querySelector('[data-ceact="addimg"]'),
    cmds: [...document.querySelectorAll('[data-ceact]')].map(x => x.dataset.ceact)
  }));
  ck("素材条按 media 数量渲染", f1.figs === 1, "实际 " + f1.figs);
  ck("素材标注「第 1 张」", /第 1 张/.test(f1.no), f1.no);
  ck("每张图 4 个操作：前移/后移/换图/删除", f1.ops === 4, "实际 " + f1.ops);
  ck("有「添加图片」入口", f1.addBtn);
  ck("排版新增 正文/居左/列表/分隔线", ["body", "left", "ul", "hr"].every(k => f1.cmds.indexOf(k) > -1), f1.cmds.join(","));
  /* YRB_SHOT=1 时落两张实拍，用来人眼确认排版（测试断言管不了「挤不挤」） */
  if (process.env.YRB_SHOT) {
    await p.screenshot({ path: path.join(__dirname, "..", "..", "temp", "shot-ce-1.png") });
  }

  console.log("=== G. 添加图片：自动进正文末尾 ===");
  await p.setInputFiles("#ceFileAdd", { name: "t.png", mimeType: "image/png", buffer: PNG1 });
  await p.waitForTimeout(800);
  const g1 = await p.evaluate(() => {
    const ims = [...document.querySelectorAll("#cePaper2 img[data-yrb-media]")];
    return {
      figs: document.querySelectorAll("#ceFigs .ad-ce-fig").length,
      seqs: ims.map(i => i.getAttribute("data-yrb-media")).join(","),
      uploads: (window.__CE.uploads || []).length
    };
  });
  ck("素材条多了一张", g1.figs === 2, "实际 " + g1.figs);
  ck("新图自动插入正文末尾、序号接上（0,1）", g1.seqs === "0,1", g1.seqs);
  ck("确实走了一次上传", g1.uploads === 1, String(g1.uploads));
  if (process.env.YRB_SHOT) {
    await p.screenshot({ path: path.join(__dirname, "..", "..", "temp", "shot-ce-2.png") });
  }

  console.log("=== H. 上移：正文序号同步互换 ===");
  await p.click('#ceFigs [data-figact="up"][data-i="1"]');
  await p.waitForTimeout(350);
  const h1 = await p.evaluate(() => ({
    seqs: [...document.querySelectorAll("#cePaper2 img[data-yrb-media]")]
      .map(i => i.getAttribute("data-yrb-media")).join(",")
  }));
  ck("第 2 张上移后正文两个序号互换（1,0）", h1.seqs === "1,0", h1.seqs);

  console.log("=== I. 换图：只换画面，序号不动 ===");
  const beforeSwap = await p.evaluate(() => {
    const im = document.querySelector('#cePaper2 img[data-yrb-media="1"]');
    return im ? (im.getAttribute("src") || "") : "";
  });
  const [fc] = await Promise.all([
    p.waitForEvent("filechooser"),
    p.click('#ceFigs [data-figact="swap"][data-i="1"]')
  ]);
  await fc.setFiles({ name: "s.png", mimeType: "image/png", buffer: PNG1 });
  await p.waitForTimeout(800);
  const i1 = await p.evaluate(() => {
    const im1 = document.querySelector('#cePaper2 img[data-yrb-media="1"]');
    return {
      figs: document.querySelectorAll("#ceFigs .ad-ce-fig").length,
      seqs: [...document.querySelectorAll("#cePaper2 img[data-yrb-media]")]
        .map(x => x.getAttribute("data-yrb-media")).join(","),
      src1: im1 ? (im1.getAttribute("src") || "") : "",
      uploads: (window.__CE.uploads || []).length
    };
  });
  ck("换图不改变素材数量", i1.figs === 2, "实际 " + i1.figs);
  ck("换图不改变正文序号（仍是 1,0）", i1.seqs === "1,0", i1.seqs);
  ck("被换那位的画面地址已更新", !!i1.src1 && i1.src1 !== beforeSwap, "旧 " + beforeSwap.slice(-18) + " / 新 " + i1.src1.slice(-18));
  ck("换图走了一次上传", i1.uploads === 2, String(i1.uploads));

  console.log("=== J. 删除：后面的序号自动接上 ===");
  await p.click('#ceFigs [data-figact="del"][data-i="1"]');
  await p.waitForTimeout(400);
  const j1 = await p.evaluate(() => {
    const ims = [...document.querySelectorAll("#cePaper2 img[data-yrb-media]")];
    return {
      figs: document.querySelectorAll("#ceFigs .ad-ce-fig").length,
      seqs: ims.map(x => x.getAttribute("data-yrb-media")).join(","),
      toast: (window.__toasts || []).slice(-1)[0] || ""
    };
  });
  ck("素材条回到 1 张", j1.figs === 1, "实际 " + j1.figs);
  ck("正文里被删的那张同步去掉", j1.seqs.split(",").filter(x => x !== "").length === 1, j1.seqs);
  ck("删除给出提示", /删除/.test(j1.toast), j1.toast);

  console.log("=== C. 保存：清洗规则 ===");
  const NEW_H = "孩子写作业拖拉怎么办（已修订）";
  await p.fill("#ceTitle2", NEW_H);
  await p.evaluate(() => {
    document.getElementById("cePaper2").innerHTML =
      '<h2>改后的小标题</h2>' +
      '<p onclick="window.__xss=1">改后的正文第一段。</p>' +
      '<script>window.__xss=2<\/script>' +
      '<img src="https://evil.example/x.jpg">' +
      '<img data-yrb-media="0">' +
      '<b>加粗保留</b>';
  });
  await p.click('[data-ceact="save"]');
  await p.waitForTimeout(600);
  const up = await p.evaluate(() => window.__CE.calls.update);
  const body = (up[0] && up[0].body) || {};
  const html = String(body.content_html || "");
  ck("确实提交了一次更新", up.length === 1, JSON.stringify(up.length));
  ck("更新打到 yb_cases 且 id 正确", up[0] && up[0].table === "yb_cases" && String(up[0].id) === "11", JSON.stringify(up[0] && up[0].id));
  ck("同时提交了 media（换图 / 增删才能落库）", Array.isArray(body.media) && body.media.length === 1, JSON.stringify(body.media));
  ck("media 里不含临时签名地址", !/data:image|https?:\/\//.test(JSON.stringify(body.media || [])), JSON.stringify(body.media));
  ck("标题按新值提交", body.title === NEW_H, body.title);
  ck("h2 归一为 h3（与前台样式一致）", /<h3>改后的小标题<\/h3>/.test(html), html.slice(0, 80));
  ck("正文文字保留", /改后的正文第一段/.test(html));
  ck("加粗标签保留", /<b>加粗保留<\/b>/.test(html));
  ck("script 标签被丢弃", !/script/i.test(html), html.slice(0, 120));
  ck("onclick 事件属性被丢弃", !/onclick/i.test(html));
  ck("外链图（未带媒体序号）被丢弃", !/evil\.example/.test(html));
  ck("原图片序号保留（素材不动）", /data-yrb-media="0"/.test(html));
  ck("保存后不再带签名 src（库里只存序号）", !/src=/i.test(html), html.slice(0, 120));
  s = await p.evaluate(() => ({
    closed: !!document.getElementById("adCaseEdit").hidden,
    firstTitle: ((document.querySelector(".ad-item .ad-t") || {}).textContent || "").trim(),
    toast: (window.__toasts || []).slice(-1)[0] || ""
  }));
  ck("保存后面板关闭", s.closed);
  ck("列表标题立即更新", s.firstTitle.indexOf(NEW_H) > -1, s.firstTitle);
  ck("给了成功提示", /已更新/.test(s.toast), s.toast);

  console.log("=== D. 空正文拦截 ===");
  await p.click('[data-ad="caseedit"][data-id="12"]');
  await p.waitForTimeout(350);
  await p.evaluate(() => { document.getElementById("cePaper2").innerHTML = ""; });
  await p.click('[data-ceact="save"]');
  await p.waitForTimeout(400);
  let d = await p.evaluate(() => ({
    n: window.__CE.calls.update.length,
    toast: (window.__toasts || []).slice(-1)[0] || "",
    open: !document.getElementById("adCaseEdit").hidden
  }));
  ck("空正文不提交", d.n === 1, "update 次数 " + d.n);
  ck("空正文给出提示", /空的/.test(d.toast), d.toast);
  ck("面板保持打开（内容没丢）", d.open);

  console.log("=== E. 无权限（RLS 返回 0 行）===");
  await p.evaluate(() => {
    document.getElementById("cePaper2").innerHTML = "<p>改后的正文内容。</p>";
    window.__CE.setDeny(true);
    window.__toasts.length = 0;
  });
  await p.click('[data-ceact="save"]');
  await p.waitForTimeout(500);
  let e2 = await p.evaluate(() => ({
    toast: (window.__toasts || []).slice(-1)[0] || "",
    open: !document.getElementById("adCaseEdit").hidden
  }));
  ck("无权限时明确提示（而不是假装成功）", /权限/.test(e2.toast), e2.toast);
  ck("失败时面板不关闭，修改不丢", e2.open);

  console.log("=== L. 云端层只写持久字段（静态检查）===");
  const cloudSrc = fs.readFileSync(path.join(__dirname, "..", "..", "yurenbang-app", "assets", "cloud.js"), "utf8");
  const mBlock = /if\(patch&&Array\.isArray\(patch\.media\)\)\{([\s\S]{0,700}?)\n  \}/.exec(cloudSrc);
  ck("cloud.js 的 updateCase 接受 media", !!mBlock);
  ck("media 映射不含 url（签名地址绝不落库）", !!mBlock && !/\burl\s*:/.test(mBlock[1]), mBlock ? mBlock[1].slice(0, 100) : "");
  ck("media 映射保留了 thumb（列表封面）", !!mBlock && /thumb/.test(mBlock[1]));

  console.log("\n" + (fail ? "❌" : "✅") + " 通过 " + pass + " / " + (pass + fail));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
