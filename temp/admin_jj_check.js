/* 管理后台「家教登记」页签 + 扫码卡二维码上传更换 集成测试
   用桩替换 YRB_CLOUD（who=管理员 / database.rpc / database.from 构建器），
   验证：页签切换、名单渲染、删除/复制操作、二维码上传→rpc→家教页立即换新、恢复默认、长辈模式 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";

let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? "  [PASS] " : "  [FAIL] ") + name + (extra && !ok ? "  → " + extra : ""));
  ok ? pass++ : fail++;
}

/* 桩：管理员身份 + rpc + from() 查询构建器（fixtures：2 条家教登记） */
const STUB = (qrValue) => `
(function(){
  var calls = { rpc: [], del: [], ins: [] };
  var DB = {
    yb_posts: [], yb_comments: [],
    yb_tutor_req: [
      { id: 101, name: "小明妈妈", contact: "wx-xiaoming", community: "阳光花园",
        grade: "三年级", subjects: "数学", other_subject: "", freq: "每周1~2次",
        teacher_types: "专职老师", online: "接受线上", goals: "补差巩固",
        owner_name: "家长5855", created_at: new Date().toISOString() },
      { id: 102, name: "", contact: "13800001111", community: "书香雅苑",
        grade: "幼儿", subjects: "拼音,识字", other_subject: "围棋", freq: "",
        teacher_types: "大学生", online: "优秀老师可线上", goals: "作业辅导",
        owner_name: "家长1111", created_at: new Date().toISOString() }
    ],
    yb_settings: [ { key: "jiaojiao_qr", value: ${JSON.stringify(qrValue || "")} } ]
  };
  function res(d){ return Promise.resolve({ data: d, error: null }); }
  function q(table){
    var rows = (DB[table] || []).slice();
    var f = {
      select: function(){ return f; },
      order: function(){ return f; },
      limit: function(){ return f; },
      eq: function(k, v){ rows = rows.filter(function(r){ return String(r[k]) === String(v); }); return f; },
      maybeSingle: function(){ return res(rows[0] || null); },
      delete: function(){ return { eq: function(k, v){
        calls.del.push({ table: table, id: v });
        DB[table] = (DB[table] || []).filter(function(r){ return String(r.id) !== String(v); });
        return res(null); } }; },
      insert: function(o){ calls.ins.push({ table: table, row: o }); return res(o); },
      /* 真 SDK 的查询构建器是 thenable：await 后得到 {data, error} */
      then: function(onF, onR){ return Promise.resolve({ data: rows, error: null }).then(onF, onR); }
    };
    return f;
  }
  window.__JJ = { calls: calls, db: DB };
  window.YRB_CLOUD = {
    enabled: function(){ return true; },
    signedIn: function(){ return true; },
    who: function(){ return { id: "2110319594408247296", phone: "18037345855", name: "家长5855" }; },
    openLogin: function(){}, signOut: function(){ return Promise.resolve(); },
    name: function(){ return "家长5855"; },
    client: {
      database: {
        rpc: function(fn, a){
          calls.rpc.push({ fn: fn, args: a });
          if (fn === "admin_guard_status") return res({ ok: true, is_set: true, fail_count: 0, locked_until: null });
          if (fn === "admin_verify_password") return res({ ok: true });
          if (fn === "admin_set_setting"){
            var row = DB.yb_settings[0];
            if (row) row.value = (a || {}).p_value || "";
            else DB.yb_settings.push({ key: (a || {}).p_key, value: (a || {}).p_value || "" });
            return res(null);
          }
          return res({ ok: false, reason: "unknown" });
        },
        from: q
      }
    }
  };
})();`;

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  PAGEERROR:", String(e.message).slice(0, 160)));
  page.on("dialog", d => d.accept());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3200);
  await page.evaluate(STUB(""));
  await page.evaluate(() => { try { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); } catch (e) {} });
  await page.evaluate(() => YRB_CONSOLE.openAdmin());
  await page.waitForTimeout(500);
  return { page, ctx };
}
const st = p => p.evaluate(() => ({
  tabs: [...document.querySelectorAll(".ad-tab")].map(t => t.textContent),
  on: ((document.querySelector(".ad-tab.on") || {}).textContent || ""),
  tutorCards: document.querySelectorAll(".jj-ad-item").length,
  firstT: ((document.querySelector(".jj-ad-item .ad-t") || {}).textContent || ""),
  hasRows: !!document.querySelector(".jj-ad-rows"),
  qrImg: (function () { const e = document.querySelector("#adQrImg"); return e ? e.getAttribute("src") : ""; })(),
  qrLabel: ((document.querySelector(".jj-ad-qr + .ad-sec .n, .ad-sec .n")) || {}).textContent || "",
  hasUp: !!document.querySelector("#adQrUp"),
  hasReset: !!document.querySelector("#adQrReset"),
  file: !!document.querySelector("#adQrFile"),
  empty: !!document.querySelector(".ad-empty"),
}));

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    console.log("=== A. 页签与家教名单渲染 ===");
    let { page } = await newPage(b);
    await page.waitForSelector(".ad-tab", { timeout: 8000 }).catch(() => {});
    let s = await st(page);
    check("后台出现三个页签（内容/家教/资质证照）", s.tabs.length === 3 && /社区内容/.test(s.tabs[0]) && /家教登记/.test(s.tabs[1]) && /资质证照/.test(s.tabs[2]), JSON.stringify(s.tabs));
    check("默认停留在社区内容页签", /社区内容/.test(s.on), s.on);
    await page.click('[data-adtab="tutor"]');
    await page.waitForTimeout(300);
    s = await st(page);
    check("切到家教登记页签", /家教登记/.test(s.on), s.on);
    check("渲染出 2 条家教登记", s.tutorCards === 2, `实际 ${s.tutorCards}`);
    check("卡片显示年级与科目摘要", /三年级/.test(s.firstT) && /数学/.test(s.firstT), s.firstT);
    check("登记详情有字段行（称呼/联系方式/小区…）", s.hasRows);
    check("提供「复制联系方式」与「删除登记」按钮",
      (await page.$$eval('[data-ad="jjcopy"]', a => a.length)) === 2 &&
      (await page.$$eval('[data-ad="jjdel"]', a => a.length)) === 2);

    console.log("=== B. 操作：复制联系方式 / 删除登记 ===");
    await page.click('[data-ad="jjcopy"]');
    await page.waitForTimeout(250);
    check("复制操作未报错", (await st(page)).tutorCards === 2);
    await page.click('[data-ad="jjdel"]');
    await page.waitForTimeout(400);
    s = await st(page);
    check("删除登记后名单刷新为 1 条", s.tutorCards === 1, `实际 ${s.tutorCards}`);
    const delLog = await page.evaluate(() => window.__JJ.calls.del);
    check("删除确实打到 yb_tutor_req 表", delLog.length === 1 && delLog[0].table === "yb_tutor_req", JSON.stringify(delLog));

    console.log("=== C. 二维码管理（默认态 → 上传 → 家教页立即换新） ===");
    s = await st(page);
    check("二维码区块出现（默认=指向首页）", s.hasUp && s.qrImg.includes("jiaojiao-qr.png"));
    check("默认态没有「恢复默认」按钮", !s.hasReset);
    check("隐藏的文件选择框存在", s.file);
    await page.setInputFiles("#adQrFile", { name: "qr.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
    await page.waitForTimeout(700);
    s = await st(page);
    const rpcLog = await page.evaluate(() => window.__JJ.calls.rpc.filter(r => r.fn === "admin_set_setting"));
    check("上传触发 admin_set_setting", rpcLog.length === 1, JSON.stringify(rpcLog).slice(0, 120));
    check("上传内容是 dataURL 图片", /^data:image\/png/.test((rpcLog[0] || {}).args ? rpcLog[0].args.p_value || "" : ""), (rpcLog[0] || {}).args && String(rpcLog[0].args.p_value).slice(0, 40));
    check("后台预览立即换成新二维码", s.qrImg.startsWith("data:image"), s.qrImg.slice(0, 40));
    check("自定义态出现「恢复默认」按钮", s.hasReset);
    const jjSrc = await page.$eval("#page-jiaojiao .jj-qr", e => e.getAttribute("src")).catch(() => "");
    check("★ 正开着的家教页扫码卡立即换新（事件联动）", jjSrc.startsWith("data:image"), jjSrc.slice(0, 40));
    const cached = await page.evaluate(() => { try { return localStorage.getItem("yrb_jj_qr") || ""; } catch (e) { return ""; } });
    check("本地缓存已更新（下次秒开新码）", cached.startsWith("data:image"));

    console.log("=== D. 恢复默认二维码 ===");
    await page.click("#adQrReset");
    await page.waitForTimeout(500);
    s = await st(page);
    const rpc2 = await page.evaluate(() => window.__JJ.calls.rpc.filter(r => r.fn === "admin_set_setting"));
    check("恢复默认写入空值", rpc2.length === 2 && rpc2[1].args.p_value === "");
    check("预览回到内置默认二维码", s.qrImg.includes("jiaojiao-qr.png"));
    check("恢复后「恢复默认」按钮消失", !s.hasReset);
    const jjSrc2 = await page.$eval("#page-jiaojiao .jj-qr", e => e.getAttribute("src")).catch(() => "");
    const cached2 = await page.evaluate(() => { try { return localStorage.getItem("yrb_jj_qr"); } catch (e) { return null; } });
    check("家教页扫码卡同步回默认", /jiaojiao-qr\.png/.test(jjSrc2 || ""), jjSrc2);
    check("本地缓存已清除", cached2 === null || cached2 === "");

    console.log("=== E. 家教页扫码卡读取云端设置（重进生效） ===");
    /* 新页面：桩里直接带自定义码，验证 loadQR 拉到设置后换图 */
    const p2 = await b.newPage({ viewport: { width: 390, height: 844 } });
    p2.on("dialog", d => d.accept());
    await p2.goto(BASE, { waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(2800);
    await p2.evaluate(STUB("data:image/png;base64,iVBORw0KGgo="));
    await p2.evaluate(() => window.dispatchEvent(new CustomEvent("yrb-jj-qr")));
    await p2.waitForTimeout(600);
    const jj3 = await p2.$eval("#page-jiaojiao .jj-qr", e => e.getAttribute("src")).catch(() => "");
    check("事件联动后扫码卡换成云端设置的自定义码", jj3.startsWith("data:image"), jj3.slice(0, 40));
    const cached3 = await p2.evaluate(() => { try { return localStorage.getItem("yrb_jj_qr") || ""; } catch (e) { return ""; } });
    check("重进页面有本地缓存可用（秒开）", cached3.startsWith("data:image"));
    await p2.close();

    console.log("=== F. 长辈模式放大 ===");
    await page.evaluate(() => document.getElementById("phone").setAttribute("data-elder", "1"));
    await page.waitForTimeout(350);
    const fs = await page.evaluate(() => ({
      tab: getComputedStyle(document.querySelector(".ad-tab")).fontSize,
      row: getComputedStyle(document.querySelector(".jj-ad-rows > div")).fontSize
    }));
    check("长辈模式下页签与登记行字号放大", parseFloat(fs.tab) >= 14.5 && parseFloat(fs.row) >= 13.5, JSON.stringify(fs));

    await page.close();
  } finally { await b.close(); }
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
