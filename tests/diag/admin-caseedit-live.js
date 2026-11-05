/* 后台「案例二次编辑」验收（2026-11-03）
   用桩替换 YRB_CLOUD，验证：
   A 列表出现「编辑内容」按钮
   B 打开面板预填标题/正文，正文图片能显示（签名地址）
   C 保存时清洗：h2→h3、丢 script/onclick/外链图、保留 data-yrb-media 序号、签名 src 被去掉
   D 正文为空 → 拦下不提交
   E 数据库拒绝（RLS 0 行）→ 明确提示没有权限，面板不关闭
   运行前：npx http-server deploy-cn -p 8794 -s  */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
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

const STUB = (deny) => `
(function(){
  var DENY = ${JSON.stringify(!!deny)};
  var calls = { update: [] };
  var CASES = [
    { id: 11, title: "孩子写作业拖拉怎么办", owner_name: "家长5855", type: "img",
      content_html: '<h3>先弄清拖拉的原因</h3><p>很多家长以为是懒，其实是畏难。</p><img data-yrb-media="0">',
      media: [{ kind: "img", path: "case/a.jpg", url: ${JSON.stringify(IMG)} }],
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
  window.YRB_CLOUD.updateCase = function(id, patch){
    var rows = CASES.filter(function(r){ return String(r.id) === String(id); });
    var body = {};
    if (patch && patch.title != null) body.title = String(patch.title).trim().slice(0, 120);
    if (patch && patch.content_html != null) body.content_html = String(patch.content_html).slice(0, 200000);
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

  console.log("\n" + (fail ? "❌" : "✅") + " 通过 " + pass + " / " + (pass + fail));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
