/* 登录账号体系回归测试（2026-10-23）
   覆盖：方式切换 / 首次注册展开 / 验证码登录带密码 / 密码登录（手机号·用户名·未设密码·
   密码错误·锁定）/ 用户名查重 / 「账号与安全」注入 / 设置密码弹窗校验 / 无报错
   说明：云端 RPC 走真实线上（本地页面 endpoint 指向 .cn/yrbapi），
   涉及登录态的用例用 mock 覆盖 SDK 方法，避免真的发短信。 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const BASE = process.env.ACCT_BASE || "http://127.0.0.1:8794/";
let pass = 0, fail = 0;
function ok(c, m, extra) {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  });

  async function newPage() {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.goto(BASE + "?t=" + Date.now(), { waitUntil: "load", timeout: 30000 });
    await p.waitForTimeout(2200);
    await p.evaluate(() => { try { enterApp(); } catch (e) {} });
    await p.waitForTimeout(300);
    return { p, ctx, errs };
  }

  /* ---------- S1 登录面板骨架与方式切换 ---------- */
  console.log("S1 登录面板：两种方式可切换");
  {
    const { p, ctx, errs } = await newPage();
    await p.evaluate(() => YRB_CLOUD.openLogin());
    await p.waitForTimeout(400);
    const a = await p.evaluate(() => ({
      tabs: [...document.querySelectorAll("#loginSheet .lg-tab")].map(e => e.textContent.trim()),
      phoneOn: document.getElementById("lgPanePwd").classList.contains("on"),
      submitVisible: getComputedStyle(document.getElementById("lgSubmit")).display !== "none"
    }));
    ok(a.tabs.length === 2 && /验证码/.test(a.tabs[0]) && /密码/.test(a.tabs[1]), "两个方式按钮都在", JSON.stringify(a.tabs));
    ok(a.phoneOn === false, "默认停在验证码方式");
    ok(a.submitVisible, "默认显示「登录 / 注册」按钮");

    await p.evaluate(() => document.getElementById("lgTabPwd").click());
    await p.waitForTimeout(250);
    const b = await p.evaluate(() => ({
      pwdOn: document.getElementById("lgPanePwd").classList.contains("on"),
      pwdBtn: getComputedStyle(document.getElementById("lgPwdSubmit")).display !== "none",
      smsBtn: getComputedStyle(document.getElementById("lgSubmit")).display === "none",
      acct: !!document.getElementById("lgAcct")
    }));
    ok(b.pwdOn && b.pwdBtn && b.smsBtn && b.acct, "切到密码登录后显示账号/密码与登录按钮", JSON.stringify(b));

    await p.evaluate(() => document.getElementById("lgTabPhone").click());
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => !document.getElementById("lgPanePwd").classList.contains("on")), "能切回验证码方式");
    ok(errs.length === 0, "无页面报错", errs[0]);
    await ctx.close();
  }

  /* ---------- S2 首次注册：展开设置用户名+密码，提交时带 password ---------- */
  console.log("S2 首次注册：验证码 + 用户名 + 密码");
  {
    const { p, ctx, errs } = await newPage();
    /* mock：新用户 + 注册成功 */
    await p.evaluate(() => {
      const auth = YRB_CLOUD.client.auth;
      auth.sendOtp = async () => ({ data: { verificationId: "vid-new", isExistingUser: false } });
      YRB_CLOUD.__cap = null;
      auth.verifyOtp = async (arg) => { YRB_CLOUD.__cap = JSON.parse(JSON.stringify(arg)); return { data: { ok: 1 } }; };
      YRB_CLOUD.refreshSession = async () => {};  /* 页面内私有，改不到就忽略 */
    });
    await p.evaluate(() => YRB_CLOUD.openLogin());
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      const ck = document.getElementById("lgCk");
      if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
      document.getElementById("lgPhone").value = "13800138000";
      document.getElementById("lgSend").click();
    });
    await p.waitForTimeout(900);
    const a = await p.evaluate(() => ({
      regShown: !document.getElementById("lgReg").hidden,
      hint: (document.getElementById("lgHint").textContent || "").slice(0, 30)
    }));
    ok(a.regShown, "首次注册时展开「用户名 + 密码」区");
    ok(/首次注册/.test(a.hint), "提示语说明注册要设账号", a.hint);

    /* 校验：用户名太短要拦下 */
    await p.evaluate(() => {
      document.getElementById("lgUser").value = "a";
      document.getElementById("lgPwd").value = "abc123456";
      document.getElementById("lgCode").value = "123456";
      document.getElementById("lgSubmit").click();
    });
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => /至少 2 个字/.test(document.getElementById("lgUserErr").textContent || "")), "用户名过短被拦下");

    /* 正常提交 */
    await p.evaluate(() => {
      document.getElementById("lgUser").value = "小明妈妈";
      document.getElementById("lgUserErr").textContent = "";
    });
    await p.evaluate(() => document.getElementById("lgSubmit").click());
    await p.waitForTimeout(3500);
    const cap = await p.evaluate(() => YRB_CLOUD.__cap);
    ok(cap && cap.password === "abc123456", "提交时把密码一起交给平台（用于设密码）", JSON.stringify(cap && cap.password));
    ok(cap && cap.phone === "13800138000" && cap.token === "123456", "手机号与验证码原样传递");
    ok(errs.length === 0, "无页面报错", errs[0]);
    await ctx.close();
  }

  /* ---------- S3 老用户：不展开注册区；跳过按钮可收起 ---------- */
  console.log("S3 老用户：只走验证码，不强制设密码");
  {
    const { p, ctx } = await newPage();
    await p.evaluate(() => {
      YRB_CLOUD.client.auth.sendOtp = async () => ({ data: { verificationId: "vid-old", isExistingUser: true } });
    });
    await p.evaluate(() => YRB_CLOUD.openLogin());
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      const ck = document.getElementById("lgCk");
      if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
      document.getElementById("lgPhone").value = "13900139000";
      document.getElementById("lgSend").click();
    });
    await p.waitForTimeout(900);
    ok(await p.evaluate(() => document.getElementById("lgReg").hidden === true), "老用户不展开注册区（不打扰）");

    /* 切到新用户场景，测「先不设」 */
    await p.evaluate(() => {
      YRB_CLOUD.client.auth.sendOtp = async () => ({ data: { verificationId: "vid-x", isExistingUser: false } });
      document.getElementById("lgSend").disabled = false;
      document.getElementById("lgSend").click();
    });
    await p.waitForTimeout(900);
    const shown = await p.evaluate(() => !document.getElementById("lgReg").hidden);
    await p.evaluate(() => document.getElementById("lgSkipReg").click());
    await p.waitForTimeout(200);
    ok(shown && await p.evaluate(() => document.getElementById("lgReg").hidden === true), "点「先不设」能收起注册区");
    await ctx.close();
  }

  /* ---------- S4 密码登录：手机号路径 + 错误文案 ---------- */
  console.log("S4 密码登录（手机号）");
  {
    const { p, ctx, errs } = await newPage();
    await p.evaluate(() => {
      YRB_CLOUD.client.auth.signInWithPassword = async () => ({
        error: { code: "password_not_set", message: "user password not set" }
      });
      YRB_CLOUD.openLogin();
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      const ck = document.getElementById("lgCk");
      if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
      document.getElementById("lgTabPwd").click();
    });
    await p.waitForTimeout(200);
    await p.evaluate(() => {
      document.getElementById("lgAcct").value = "13800138000";
      document.getElementById("lgPwd2").value = "abc123456";
      document.getElementById("lgPwdSubmit").click();
    });
    await p.waitForTimeout(800);
    const t1 = await p.evaluate(() => (document.getElementById("lgErr").textContent || ""));
    ok(/还没设置登录密码/.test(t1) && /验证码登录/.test(t1), "未设密码时给出明确指引", t1);

    /* 密码错误 */
    await p.evaluate(() => {
      YRB_CLOUD.client.auth.signInWithPassword = async () => ({
        error: { code: "invalid_username_or_password", message: "Username or password incorrect." }
      });
      document.getElementById("lgPwdSubmit").click();
    });
    await p.waitForTimeout(700);
    const t2 = await p.evaluate(() => (document.getElementById("lgErr").textContent || ""));
    ok(/不正确/.test(t2), "密码错误有明确提示", t2);

    /* 成功路径 */
    await p.evaluate(() => {
      YRB_CLOUD.client.auth.signInWithPassword = async () => ({ data: { ok: 1 } });
      document.getElementById("lgPwdSubmit").click();
    });
    await p.waitForTimeout(900);
    const t3 = await p.evaluate(() => ({
      err: document.getElementById("lgErr").textContent || "",
      sheet: document.getElementById("loginSheet").classList.contains("open")
    }));
    ok(t3.err === "" && t3.sheet === false, "密码正确后关闭登录面板", JSON.stringify(t3));
    ok(errs.length === 0, "无页面报错", errs[0]);
    await ctx.close();
  }

  /* ---------- S5 密码登录（用户名）：查无此人 / 密码错 N 次 / 锁定 ---------- */
  console.log("S5 密码登录（用户名）");
  {
    const { p, ctx, errs } = await newPage();
    await p.evaluate(() => {
      YRB_CLOUD.client.database.rpc = async (fn, args) => {
        if (fn === "yb_account_login") {
          if (args.p_username === "没这个人") return { data: { ok: false, reason: "no_user" } };
          if (args.p_username === "错密码") return { data: { ok: false, reason: "bad_pwd", left: 3 } };
          if (args.p_username === "被锁了") return { data: { ok: false, reason: "locked", seconds: 240 } };
          return { data: { ok: true, phone: "13700137000", username: args.p_username } };
        }
        return { data: null };
      };
      YRB_CLOUD.client.auth.signInWithPassword = async () => ({ data: { ok: 1 } });
      YRB_CLOUD.openLogin();
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      const ck = document.getElementById("lgCk");
      if (ck && ck.getAttribute("aria-checked") !== "true") ck.click();
      document.getElementById("lgTabPwd").click();
    });
    await p.waitForTimeout(200);

    async function tryOne(name, pwd) {
      await p.evaluate(([n, w]) => {
        document.getElementById("lgAcct").value = n;
        document.getElementById("lgPwd2").value = w;
        document.getElementById("lgPwdSubmit").click();
      }, [name, pwd]);
      await p.waitForTimeout(600);
      return p.evaluate(() => (document.getElementById("lgErr").textContent || ""));
    }
    const e1 = await tryOne("没这个人", "abc123456");
    ok(/没有找到这个用户名/.test(e1), "用户名不存在提示准确", e1);
    const e2 = await tryOne("错密码", "abc123456");
    ok(/还可以再试 3 次/.test(e2), "密码错误带剩余次数", e2);
    const e3 = await tryOne("被锁了", "abc123456");
    ok(/4 分钟后再试/.test(e3), "锁定提示带等待分钟数", e3);
    const e4 = await tryOne("小明妈妈", "abc123456");
    ok(e4 === "", "正确凭证可登录通过", e4);
    ok(errs.length === 0, "无页面报错", errs[0]);
    await ctx.close();
  }

  /* ---------- S6 云端函数真实可达（仅线上跑；本地 127.0.0.1 会被 CORS 拦） ---------- */
  console.log("S6 云端账号函数连通性");
  if (/127\.0\.0\.1|localhost/.test(BASE)) {
    console.log("  - 本地环境跳过（跨域会被浏览器拦，改由线上 prod-acct-check 验证）");
  } else {
    const { p, ctx } = await newPage();
    const r = await p.evaluate(async () => {
      const out = {};
      out.avail = await YRB_CLOUD.accounts.avail("回归测试名_" + Date.now()).then(x => x && x.data).catch(e => String(e));
      out.lookup = await YRB_CLOUD.accounts.lookup("__nobody__", "abc123456").then(x => x && x.data).catch(e => String(e));
      out.me = await YRB_CLOUD.accounts.me().then(x => x && x.data).catch(e => String(e));
      return out;
    });
    ok(r.avail && r.avail.ok === true && r.avail.avail === true, "用户名查重函数可调", JSON.stringify(r.avail));
    ok(r.lookup && r.lookup.reason === "no_user", "账号校验函数可调（不存在→no_user）", JSON.stringify(r.lookup));
    ok(r.me && r.me.reason === "not_signed_in", "当前账号状态函数可调（未登录被拒）", JSON.stringify(r.me));
    await ctx.close();
  }

  /* ---------- S7 「账号与安全」注入 + 设置密码弹窗校验 ---------- */
  console.log("S7 账号与安全页");
  {
    const { p, ctx, errs } = await newPage();
    await p.evaluate(() => {
      YRB_CLOUD.signedIn = () => true;
      YRB_CLOUD.who = () => ({ id: "u1", phone: "13800138000", name: "小明妈妈" });
      YRB_CLOUD.client.database.rpc = async (fn) => {
        if (fn === "yb_account_me")
          return { data: { ok: true, has_pwd: false, auth_pwd: false, username: "", phone: "13800138000" } };
        /* 其余（保存等）一律拦下：测试不写生产库 */
        return { data: { ok: false, reason: "not_signed_in" } };
      };
      openSubpage("acct");
    });
    await p.waitForTimeout(900);
    const a = await p.evaluate(() => {
      const b = document.getElementById("acctBlk");
      return {
        has: !!b,
        text: b ? b.innerText.replace(/\s+/g, " ").slice(0, 120) : "",
        pwdWarn: b ? /未设置/.test(b.innerText) : false,
        realPhone: b ? /138\*{4}8000/.test(b.innerText) : false,
        oldFake: /138\*{4}8888/.test(document.getElementById("spBody").innerText)
      };
    });
    ok(a.has, "账号与安全页注入账号区块");
    ok(a.pwdWarn, "未设密码时显示「未设置」", a.text);
    ok(a.realPhone, "显示真实手机号（不再是写死的 138****8888）");
    ok(!a.oldFake, "旧的假手机号已被替换");

    /* 打开设置弹窗，校验两次密码不一致 */
    await p.evaluate(() => document.getElementById("acSetPwd").click());
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.getElementById("pwdSheet").classList.contains("open")), "点「登录密码」打开设置弹窗");
    await p.evaluate(() => {
      document.getElementById("pwName").value = "小明妈妈";
      document.getElementById("pwPwd").value = "abc123456";
      document.getElementById("pwPwd2").value = "abc999999";
      document.getElementById("pwSave").click();
    });
    await p.waitForTimeout(400);
    const e1 = await p.evaluate(() => document.getElementById("pwErr").textContent || "");
    ok(/不一致/.test(e1), "两次密码不一致被拦下", e1);

    await p.evaluate(() => { document.getElementById("pwPwd2").value = "abc123456"; document.getElementById("pwPwd").value = "123"; document.getElementById("pwSave").click(); });
    await p.waitForTimeout(300);
    ok(/6-20 位/.test(await p.evaluate(() => document.getElementById("pwErr").textContent || "")), "密码过短被拦下");

    await p.evaluate(() => { document.getElementById("pwName").value = ""; document.getElementById("pwSave").click(); });
    await p.waitForTimeout(300);
    ok(/请填写登录用户名/.test(await p.evaluate(() => document.getElementById("pwErr").textContent || "")), "未填用户名有明确提示");

    /* 设密码必须过验证码这一关 */
    await p.evaluate(() => {
      document.getElementById("pwName").value = "小明妈妈";
      document.getElementById("pwPwd").value = "abc123456";
      document.getElementById("pwPwd2").value = "abc123456";
      document.getElementById("pwCode").value = "";
      document.getElementById("pwSave").click();
    });
    await p.waitForTimeout(300);
    ok(/短信验证码/.test(await p.evaluate(() => document.getElementById("pwErr").textContent || "")), "未填验证码被拦下");

    await p.evaluate(() => {
      document.getElementById("pwCode").value = "123456";
      document.getElementById("pwSave").click();
    });
    await p.waitForTimeout(300);
    ok(/请先点「获取验证码」/.test(await p.evaluate(() => document.getElementById("pwErr").textContent || "")), "没发验证码直接提交会提示先获取");

    /* 获取验证码：mock 平台发送，检查倒计时与提示 */
    await p.evaluate(() => {
      /* 2026-10-25 设密改走 PASSWORD_RESET 专用验证码：mock YRB_CLOUD.accounts.sendResetOtp */
      YRB_CLOUD.accounts.sendResetOtp = async () => ({ ok: true, verificationId: "vid-pwd" });
      document.getElementById("pwSend").click();
    });
    await p.waitForTimeout(600);
    const sentTip = await p.evaluate(() => ({
      btn: document.getElementById("pwSend").textContent.trim(),
      tip: document.getElementById("pwSendTip").textContent || ""
    }));
    ok(/\d+s 后重发/.test(sentTip.btn), "点获取验证码后进入倒计时", sentTip.btn);
    ok(/已发送到 138\*{4}8000/.test(sentTip.tip), "提示写明验证码发到哪个号", sentTip.tip);
    ok(errs.length === 0, "无页面报错", errs[0]);
    await ctx.close();
  }

  await browser.close();
  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常:", e); process.exit(2); });
