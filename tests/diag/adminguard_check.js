/* 管理后台二次验证（管理密码）集成测试
   用桩替换 YRB_CLOUD，语义与数据库函数一致：
     admin_guard_status / admin_set_password(fail 5 次锁 5 分钟) / admin_verify_password
   重点验证：入口拦截、首次设置、弱密码拦截、TTL 免重输、错误计数、锁定、切账号失效 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "https://xn--gmqq09al6z.cn/";

let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? "  [PASS] " : "  [FAIL] ") + name + (extra && !ok ? "  → " + extra : ""));
  ok ? pass++ : fail++;
}

const STUB = (adminId) => `
(function(){
  var pw = null, fails = 0, lockedUntil = 0, seq = [];
  function res(o){ return Promise.resolve({ data: o, error: null }); }
  window.__AG = {
    get pw(){ return pw; }, set pw(v){ pw = v; },
    get fails(){ return fails; }, get locked(){ return lockedUntil > Date.now(); },
    seq: seq,
    reset: function(){ pw = null; fails = 0; lockedUntil = 0; seq.length = 0;
      try{ sessionStorage.removeItem("yrb_admin_unlock_at"); }catch(e){} }
  };
  window.YRB_CLOUD = {
    enabled: function(){ return true; },
    signedIn: function(){ return true; },
    who: function(){ return ${adminId ? '{ id: "2110319594408247296", phone: "18000005855", name: "家长5855" }' : '{ id: "999999", phone: "13900000000", name: "普通家长" }'}; },
    openLogin: function(){ window.__AG.loginAsked = true; },
    signOut: function(){ return Promise.resolve(); },
    client: { database: { rpc: function(fn, a){
      seq.push(fn + (a && a.p_new ? ":set" : ""));
      if (fn === "admin_guard_status")
        return res({ ok: true, is_set: !!pw, fail_count: fails,
                     locked_until: lockedUntil > Date.now() ? new Date(lockedUntil).toISOString() : null });
      if (fn === "admin_set_password") {
        var np = (a || {}).p_new, op = (a || {}).p_old;
        if (!np || np.length < 8 || !/[A-Za-z]/.test(np) || !/[0-9]/.test(np)) return res({ ok:false, reason:"weak" });
        if (pw && op !== pw) return res({ ok:false, reason:"bad_old" });
        pw = np; fails = 0; lockedUntil = 0; return res({ ok:true });
      }
      if (fn === "admin_verify_password") {
        if (lockedUntil > Date.now()) return res({ ok:false, reason:"locked", locked_until:new Date(lockedUntil).toISOString() });
        if (!pw) return res({ ok:false, reason:"not_set" });
        if ((a || {}).p_password === pw) { fails = 0; return res({ ok:true }); }
        fails++;
        if (fails >= 5) { lockedUntil = Date.now() + 5*60*1000;
          return res({ ok:false, reason:"locked", left:0, locked_until:new Date(lockedUntil).toISOString() }); }
        return res({ ok:false, reason:"bad", left: 5 - fails, fail_count: fails });
      }
      return res({ ok:false, reason:"unknown" });
    } } },
  };
})();`;

async function newPage(browser, admin) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  PAGEERROR:", String(e.message).slice(0, 160)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3600);
  await page.evaluate(STUB(admin));
  return { page, ctx };
}
const state = p => p.evaluate(() => ({
  gateOpen: !!document.querySelector("#agLayer.open"),
  title: (document.querySelector("#agTitle") || {}).textContent || "",
  desc: (document.querySelector("#agDesc") || {}).innerHTML || "",
  err: (document.querySelector("#agErr") || {}).textContent || "",
  fields: [...document.querySelectorAll("#agFields input")].map(i => i.id),
  adminOpen: !!document.querySelector("#adLayer.open"),
  unlockAt: (() => { try { return sessionStorage.getItem("yrb_admin_unlock_at"); } catch (e) { return null; } })(),
  body: (document.querySelector("#adBody") || {}).textContent || "",
}));
const type = async (p, id, v) => p.$eval(id, (e, val) => { e.value = val; e.dispatchEvent(new Event("input", { bubbles: true })); }, v);
const ok = async p => { await p.$eval("#agOk", e => e.click()); await p.waitForTimeout(450); };

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });

  /* ---------- A. 首次：必须设置密码才能进 ---------- */
  console.log("A. 首次进入（未设置密码）");
  let { page, ctx } = await newPage(b, true);
  await page.evaluate(() => YRB_CONSOLE.openAdmin());
  await page.waitForTimeout(600);
  let s = await state(page);
  check("弹出「首次设置管理密码」", /首次设置管理密码/.test(s.title), s.title);
  check("后台面板未打开", !s.adminOpen);
  check("提供了新密码+确认两个输入", s.fields.join(",") === "agPwd,agPwd2", s.fields.join(","));
  check("文案说明是保护家长数据", /保护注册家长的数据/.test(s.desc));

  console.log("B. 弱密码 / 不一致被拦");
  await type(page, "#agPwd", "12345678"); await type(page, "#agPwd2", "12345678"); await ok(page);
  s = await state(page);
  check("纯数字密码被拦", /字母和数字/.test(s.err), s.err);
  await type(page, "#agPwd", "abcdefgh"); await type(page, "#agPwd2", "abcdefgh"); await ok(page);
  s = await state(page);
  check("纯字母密码被拦", /字母和数字/.test(s.err), s.err);
  await type(page, "#agPwd", "yrbTest2026"); await type(page, "#agPwd2", "yrbTest2027"); await ok(page);
  s = await state(page);
  check("两次不一致被拦", /不一致/.test(s.err), s.err);
  check("弱密码未写入后端", await page.evaluate(() => !window.__AG.pw));

  console.log("C. 设置成功 → 进入后台");
  await type(page, "#agPwd", "yrbTest2026"); await type(page, "#agPwd2", "yrbTest2026"); await ok(page);
  await page.waitForTimeout(700);
  s = await state(page);
  check("密码已写入", await page.evaluate(() => window.__AG.pw === "yrbTest2026"));
  check("门禁层已关闭", !s.gateOpen);
  check("后台面板已打开", s.adminOpen);
  check("写入了解锁时间戳（TTL）", !!s.unlockAt);
  check("后台页脚有「修改管理密码」", (await page.evaluate(() => !!document.querySelector("#adChangePwd"))));

  console.log("D. TTL 内再次进入免输密码");
  await page.evaluate(() => { document.querySelector("#adLayer").classList.remove("open"); YRB_CONSOLE.openAdmin(); });
  await page.waitForTimeout(600);
  s = await state(page);
  check("不再要求密码、直接进后台", !s.gateOpen && s.adminOpen);

  console.log("E. 手动锁定后重新要求密码");
  await page.evaluate(() => { document.querySelector("#adLayer").classList.remove("open"); YRB_ADMINGUARD.lock(); YRB_CONSOLE.openAdmin(); });
  await page.waitForTimeout(600);
  s = await state(page);
  check("弹出「请输入管理密码」", /请输入管理密码/.test(s.title), s.title);
  check("后台未打开", !s.adminOpen);
  check("只有一个密码输入框", s.fields.join(",") === "agPwd", s.fields.join(","));

  console.log("F. 密码错误 → 剩余次数提示");
  await type(page, "#agPwd", "wrongPass1"); await ok(page);
  s = await state(page);
  check("提示剩余 4 次", /还可尝试 4 次/.test(s.err), s.err);

  console.log("G. 连错 5 次 → 锁定");
  for (const v of ["wrongPass2", "wrongPass3", "wrongPass4", "wrongPass5"]) { await type(page, "#agPwd", v); await ok(page); }
  s = await state(page);
  check("提示已临时锁定", /临时锁定/.test(s.err), s.err);
  await type(page, "#agPwd", "yrbTest2026"); await ok(page);
  s = await state(page);
  check("锁定期间正确密码也不放行", /临时锁定/.test(s.err) && !s.adminOpen, s.err);

  console.log("H. 解锁窗口过期后可正常进入（重置桩数据）");
  await page.evaluate(() => { window.__AG.reset(); window.__AG.pw = "yrbTest2026"; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.querySelector("#agLayer").classList.remove("open"); YRB_CONSOLE.openAdmin(); });
  await page.waitForTimeout(500);
  await type(page, "#agPwd", "yrbTest2026"); await ok(page);
  await page.waitForTimeout(600);
  s = await state(page);
  check("正确密码放行并进入后台", s.adminOpen && !s.gateOpen);
  await ctx.close();

  /* ---------- I. 切换账号 → 立即失效 ---------- */
  console.log("I. 切换账号后解锁态失效");
  ({ page, ctx } = await newPage(b, true));
  await page.evaluate(() => { sessionStorage.setItem("yrb_admin_unlock_at", String(Date.now())); });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("yrb-auth", { detail: { signedIn: true } })));
  await page.waitForTimeout(300);
  s = await state(page);
  check("解锁时间戳已被清除", !s.unlockAt, String(s.unlockAt));
  await page.evaluate(() => YRB_CONSOLE.openAdmin());
  await page.waitForTimeout(600);
  s = await state(page);
  check("重新要求设密码/输密码", s.gateOpen, s.title);
  await ctx.close();

  /* ---------- J. 非管理员不弹密码 ---------- */
  console.log("J. 非管理员账号：不弹管理密码");
  ({ page, ctx } = await newPage(b, false));
  await page.evaluate(() => YRB_CONSOLE.openAdmin());
  await page.waitForTimeout(700);
  s = await state(page);
  check("未弹管理密码", !s.gateOpen);
  check("后台给出「不是管理员」提示", /不是管理员/.test(s.body), s.body.slice(0, 40));
  check("提供了切换账号按钮", await page.evaluate(() => !!document.querySelector("#adSwitch")));
  await ctx.close();

  await b.close();
  console.log("\n===== 结果 %d/%d 通过 =====", pass, pass + fail);
  process.exit(fail ? 1 : 0);
})();
