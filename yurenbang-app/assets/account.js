/* =========================================================
   育人帮 · 登录账号层（account.js）
   ---------------------------------------------------------
   为什么需要这一层：
   1) 平台鉴权只认手机号，用户想用「用户名 + 密码」免验证码登录，
      需要一个 用户名 → 手机号 的映射，以及能真正落在平台侧的口令；
   2) 「账号与安全」页原本是静态占位（手机号写死成一个示例号码），
      要改成真实信息 + 「设置 / 修改登录密码」入口。

   设计约定（与 refine23 / access / food 等增强层一致）：
   - 不修改 app.js 结构：监听 #subpage 打开，识别标题「账号与安全」后
     向 #spBody 注入自己的区块，DOM 带 id 防重入；
   - 口令写入统一走 YRB_CLOUD.accounts（cloud.js 内的云端函数），
     本层只负责界面与流程，不重复实现密码学逻辑；
   - 设置成功后做一次「真实登录自检」：用刚设的密码调 signInWithPassword，
     通过才算真的生效，避免"页面说设好了、其实登不上"。
   ========================================================= */
(function () {
  "use strict";

  var TAG = "[账号]";
  function $(s, r) { return (r || document).querySelector(s); }
  function toast(m) { try { if (typeof window.toast === "function") window.toast(m); } catch (e) {} }
  function C() { return window.YRB_CLOUD || null; }
  function signedIn() { try { return !!(C() && C().signedIn && C().signedIn()); } catch (e) { return false; } }
  function who() { try { return (C() && C().who && C().who()) || null; } catch (e) { return null; } }
  /* 本机手机号：会话对象里没有手机号（平台 SDK 限制），按可靠性取——
     ① who()（sessionPhone 多路兜底，含本机最近登录记录）
     ② 服务端 yb_account_me 返回的 phone（yb_accounts 行或平台 auth.users.phone_number） */
  function getPhone() {
    var p = String((who() || {}).phone || "").replace(/\D/g, "");
    if (/^1\d{10}$/.test(p)) return p;
    var m = ST.me || {};
    p = String(m.phone || "").replace(/\D/g, "");
    return /^1\d{10}$/.test(p) ? p : "";
  }
  function maskPhone(p) {
    p = String(p || "").replace(/\D/g, "");
    return p.length === 11 ? p.slice(0, 3) + "****" + p.slice(-4) : "";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- 状态 ---------------- */
  var ST = { loading: false, me: null, at: 0 };

  function fetchMe(force) {
    if (!signedIn()) return Promise.resolve(null);
    if (!force && ST.me && Date.now() - ST.at < 30000) return Promise.resolve(ST.me);
    return C().accounts.me().then(function (r) {
      var d = r && r.data;
      ST.me = (d && d.ok) ? d : { ok: false };
      ST.at = Date.now();
      return ST.me;
    }).catch(function () { return null; });
  }

  /* ---------------- 样式（一次注入） ---------------- */
  function ensureCSS() {
    if (document.getElementById("acctCSS")) return;
    var css = document.createElement("style");
    css.id = "acctCSS";
    css.textContent = [
      "#acctBlk{margin-top:10px}",
      "#acctBlk .ac-sec{background:#fff;border:1px solid var(--rule,#F0E4DA);border-radius:16px;overflow:hidden;margin:0 0 10px}",
      "#acctBlk .ac-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:none;",
      "  font-family:inherit;font-size:14px;color:var(--ink,#3B2A20);padding:14px 16px;cursor:pointer;",
      "  border-bottom:1px solid #F7F0EA}",
      "#acctBlk .ac-row:last-child{border-bottom:none}",
      "#acctBlk .ac-row .ic{flex:none;width:22px;text-align:center;font-size:17px}",
      "#acctBlk .ac-row .tx{flex:1;min-width:0}",
      "#acctBlk .ac-row .sub{flex:none;font-size:12.5px;color:#9A8375}",
      "#acctBlk .ac-row .sub.ok{color:#1FA47F;font-weight:800}",
      "#acctBlk .ac-row .sub.warn{color:#C0562F;font-weight:800}",
      "#acctBlk .ac-note{font-size:11.5px;color:#9A8375;line-height:1.7;padding:0 6px 6px}",
      "#acctBlk .ac-hero{display:flex;align-items:center;gap:12px;padding:14px 16px;",
      "  background:linear-gradient(135deg,#FFF3E9,#FFE8DA);border-radius:16px;margin:0 0 10px}",
      "#acctBlk .ac-av{flex:none;width:44px;height:44px;border-radius:50%;background:var(--gradA,#F0543C);",
      "  color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:900}",
      "#acctBlk .ac-hn{font-size:15px;font-weight:900;color:var(--ink,#3B2A20)}",
      "#acctBlk .ac-hs{font-size:12px;color:#8C7A6E;margin-top:3px}",
      "#phone[data-elder=\"1\"] #acctBlk .ac-row{font-size:16px;padding:17px 16px}",
      "#phone[data-elder=\"1\"] #acctBlk .ac-note{font-size:13px}",
      /* 设置密码弹层 */
      "#pwdSheet{position:absolute;inset:0;z-index:88;display:none}",
      "#pwdSheet.open{display:block}",
      "#pwdSheet .pw-mask{position:absolute;inset:0;background:rgba(30,20,14,.45)}",
      "#pwdSheet .pw-card{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;",
      "  padding:10px 20px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(70,45,30,.18);",
      "  animation:pwUp .22s ease-out;max-height:92%;overflow:auto}",
      "@keyframes pwUp{from{transform:translateY(40px);opacity:.5}to{transform:none;opacity:1}}",
      "#pwdSheet .pw-bar{width:42px;height:4px;border-radius:99px;background:#EADFD6;margin:0 auto 12px}",
      "#pwdSheet .pw-t{font-size:17px;font-weight:900;color:var(--ink,#3B2A20);text-align:center}",
      "#pwdSheet .pw-d{font-size:12.5px;color:#8C7A6E;text-align:center;line-height:1.65;margin:6px 0 4px}",
      "#pwdSheet .pw-l{font-size:12px;font-weight:800;color:#8C7A6E;margin:13px 2px 6px}",
      "#pwdSheet .pw-f{display:flex;align-items:center;gap:8px;border:1.5px solid #EFE2D8;background:#FCFAF8;",
      "  border-radius:14px;padding:0 14px;min-height:50px}",
      "#pwdSheet .pw-f:focus-within{border-color:var(--accent,#F0543C)}",
      "#pwdSheet .pw-f input{flex:1;border:none;background:none;outline:none;font-size:16px;min-width:0;color:var(--ink,#3B2A20)}",
      "#pwdSheet .pw-f input::placeholder{color:#B7A79B;font-size:14px}",
      "#pwdSheet .pw-eye{border:none;background:none;font-size:12.5px;font-weight:800;color:var(--accent2,#E8703C);",
      "  font-family:inherit;cursor:pointer;padding:6px 2px}",
      "#pwdSheet .pw-err{font-size:12.5px;color:#D14343;line-height:1.6;margin:8px 2px 0;min-height:0}",
      "#pwdSheet .pw-ok{font-size:12.5px;color:#1FA47F;line-height:1.6;margin:8px 2px 0}",
      "#pwdSheet .pw-btns{display:flex;gap:10px;margin-top:16px}",
      "#pwdSheet .pw-b{flex:1;border:none;border-radius:999px;padding:14px 8px;font-size:15px;font-weight:800;",
      "  font-family:inherit;cursor:pointer;background:var(--gradA,#F0543C);color:#fff}",
      "#pwdSheet .pw-b.ghost{background:#fff;color:var(--ink,#3B2A20);border:1.5px solid #FFE1D2}",
      "#pwdSheet .pw-b:disabled{opacity:.55}",
      "#pwdSheet .pw-note{font-size:11.5px;color:#9A8375;line-height:1.7;margin-top:12px;text-align:center}",
      "#phone[data-elder=\"1\"] #pwdSheet .pw-t{font-size:19px}",
      "#phone[data-elder=\"1\"] #pwdSheet .pw-d,#phone[data-elder=\"1\"] #pwdSheet .pw-note{font-size:14px}",
      "#phone[data-elder=\"1\"] #pwdSheet .pw-b{font-size:17px;padding:16px 8px}"
    ].join("\n");
    document.head.appendChild(css);
  }

  /* ---------------- 账号与安全页注入 ---------------- */
  function blockHTML() {
    var m = ST.me || {};
    var phone = maskPhone(m.phone || (who() && who().phone));
    var uname = m.username || "";
    var hasPwd = !!m.has_pwd;
    var authOk = !!m.auth_pwd;
    var pwdSub = hasPwd
      ? (authOk ? '<span class="sub ok">已设置 ›</span>' : '<span class="sub warn">待生效 ›</span>')
      : '<span class="sub warn">未设置 ›</span>';
    return '' +
      '<div id="acctBlk">' +
        '<div class="ac-hero">' +
          '<div class="ac-av">' + esc((uname || "家").slice(0, 1)) + '</div>' +
          '<div><div class="ac-hn">' + (uname ? esc(uname) : "还没设置登录用户名") + '</div>' +
          '<div class="ac-hs">' + (phone ? ("手机号 " + phone) : "已登录") + '</div></div>' +
        '</div>' +
        '<div class="ac-sec">' +
          '<button class="ac-row" id="acSetPwd"><span class="ic">🔑</span><span class="tx">登录密码</span>' + pwdSub + '</button>' +
          '<button class="ac-row" id="acSetName"><span class="ic">🪪</span><span class="tx">登录用户名</span>' +
            '<span class="sub">' + (uname ? esc(uname) + ' ›' : '未设置 ›') + '</span></button>' +
        '</div>' +
        '<div class="ac-note">设置后可用「用户名 + 密码」或「手机号 + 密码」直接登录，不必每次等短信验证码；忘记密码时随时可用验证码登录。</div>' +
      '</div>';
  }

  function injectIntoSubpage() {
    var title = $("#spTitle"), body = $("#spBody");
    if (!title || !body) return;
    if (String(title.textContent || "").trim() !== "账号与安全") return;
    if (document.getElementById("acctBlk")) return;      /* 防重入 */
    if (!signedIn()) return;
    body.insertAdjacentHTML("afterbegin", blockHTML());
    /* app.js 里「手机号」是写死的示例号码，这里换成真实号码 */
    var realPhone = maskPhone((ST.me && ST.me.phone) || (who() && who().phone));
    if (realPhone) {
      Array.prototype.forEach.call(body.querySelectorAll(".sp-row"), function (r) {
        if (!/手机号/.test(r.textContent || "")) return;
        var sub = r.querySelector(".sub");
        if (sub) sub.textContent = realPhone + " ›";
      });
    }
    var a = $("#acSetPwd"), b = $("#acSetName");
    if (a) a.addEventListener("click", function () { openPwdSheet("pwd"); });
    if (b) b.addEventListener("click", function () { openPwdSheet("name"); });
    /* 拉到真实账号信息后刷新一次（首屏不阻塞） */
    fetchMe().then(function (m) {
      if (!m) return;
      var blk = document.getElementById("acctBlk");
      if (!blk) return;
      blk.outerHTML = blockHTML();
      var a2 = $("#acSetPwd"), b2 = $("#acSetName");
      if (a2) a2.addEventListener("click", function () { openPwdSheet("pwd"); });
      if (b2) b2.addEventListener("click", function () { openPwdSheet("name"); });
    });
  }

  /* 监听二级页打开（#subpage 加 open 类时内容已渲染） */
  function watch() {
    var sp = document.getElementById("subpage");
    if (!sp) return;
    var mo = new MutationObserver(function () {
      if (sp.classList.contains("open")) setTimeout(injectIntoSubpage, 30);
    });
    mo.observe(sp, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---------------- 设置密码 / 用户名 弹层 ---------------- */
  function ensureSheet() {
    if (document.getElementById("pwdSheet")) return;
    var host = document.getElementById("phone") || document.body;
    host.insertAdjacentHTML("beforeend", '' +
      '<div id="pwdSheet" role="dialog" aria-label="设置登录账号">' +
        '<div class="pw-mask" data-pw="close"></div>' +
        '<div class="pw-card">' +
          '<div class="pw-bar"></div>' +
          '<div class="pw-t" id="pwTitle">设置登录密码</div>' +
          '<div class="pw-d" id="pwDesc">设置后下次打开可直接用密码登录，不用再等短信验证码</div>' +
          '<div id="pwNameWrap">' +
            '<div class="pw-l">登录用户名</div>' +
            '<div class="pw-f"><input id="pwName" maxlength="20" placeholder="2-20 位，如：小明妈妈" autocomplete="username"></div>' +
          '</div>' +
          '<div class="pw-l" id="pwPwdLabel">登录密码</div>' +
          '<div class="pw-f"><input id="pwPwd" type="password" maxlength="32" placeholder="6-20 位，字母+数字更安全" autocomplete="new-password">' +
            '<button class="pw-eye" id="pwEye" type="button">显示</button></div>' +
          '<div class="pw-l" id="pwPwd2Label">再输一次</div>' +
          '<div class="pw-f"><input id="pwPwd2" type="password" maxlength="32" placeholder="两次输入保持一致" autocomplete="new-password"></div>' +
          '<div class="pw-l">短信验证码</div>' +
          '<div class="pw-f"><input id="pwCode" inputmode="numeric" maxlength="6" placeholder="6 位短信验证码" aria-label="短信验证码">' +
            '<button class="pw-eye" id="pwSend" type="button">获取验证码</button></div>' +
          '<div class="pw-note" id="pwSendTip" style="text-align:left;margin-top:8px"></div>' +
          '<div class="pw-err" id="pwErr"></div>' +
          '<div class="pw-btns">' +
            '<button class="pw-b ghost" id="pwCancel" type="button">取消</button>' +
            '<button class="pw-b" id="pwSave" type="button">保存并启用</button>' +
          '</div>' +
          '<div class="pw-note">密码仅用于登录，忘记可用手机验证码重新登录后修改</div>' +
        '</div>' +
      '</div>');
    var sh = $("#pwdSheet");
    sh.addEventListener("click", function (e) {
      if (e.target.closest('[data-pw="close"]') || e.target.closest("#pwCancel")) closeSheet();
    });
    var eye = $("#pwEye");
    if (eye) eye.addEventListener("click", function () {
      var i = $("#pwPwd"); if (!i) return;
      var show = i.type === "password";
      i.type = show ? "text" : "password";
      eye.textContent = show ? "隐藏" : "显示";
    });
    var save = $("#pwSave");
    if (save) save.addEventListener("click", doSave);
    var send = $("#pwSend");
    if (send) send.addEventListener("click", sendCode);
  }

  /* ---------------- 发验证码（设置密码前确认本人） ---------------- */
  var CODE = { vid: "", phone: "", at: 0, timer: null, retried: false };
  function sendCode() {
    var btn = $("#pwSend"), err = $("#pwErr"), tip = $("#pwSendTip");
    if (!signedIn()) { if (err) err.textContent = "请先登录后再设置密码"; return; }
    var phone = getPhone();
    if (!/^1\d{10}$/.test(phone)) {
      /* 兜底：账号信息可能还没拉回来，强制刷新一次再试（只重试一次防死循环） */
      if (!CODE.retried) {
        CODE.retried = true;
        if (err) err.textContent = "正在核对账号信息…";
        fetchMe(true).then(function () { sendCode(); });
        return;
      }
      if (err) err.textContent = "没取到手机号，请退出后重新用验证码登录"; return;
    }
    btn.disabled = true; btn.textContent = "发送中…";
    if (err) err.textContent = "";
    /* 设密码必须用 PASSWORD_RESET 专用验证码（2026-10-25）：
       复用登录验证码的话，最后 reset 一步会因令牌用途不符被平台拒绝 */
    C().accounts.sendResetOtp(phone).then(function (r) {
      if (!r || !r.ok || !r.verificationId) {
        btn.disabled = false; btn.textContent = "获取验证码";
        if (err) err.textContent = (r && r.msg) || "验证码没发出去，请检查网络后重试";
        return;
      }
      CODE.vid = r.verificationId; CODE.phone = phone; CODE.at = Date.now();
      if (tip) tip.textContent = "验证码已发送到 " + maskPhone(phone) + "，5 分钟内有效，收到后填在上面的输入框";
      var left = 20; btn.textContent = left + "s 后重发";
      clearInterval(CODE.timer);
      CODE.timer = setInterval(function () {
        left--;
        if (left <= 0) { clearInterval(CODE.timer); btn.disabled = false; btn.textContent = "重新获取"; return; }
        btn.textContent = left + "s 后重发";
      }, 1000);
    }).catch(function () {
      btn.disabled = false; btn.textContent = "获取验证码";
      if (err) err.textContent = "验证码没发出去，请检查网络后重试";
    });
  }
  function closeSheet() {
    var sh = $("#pwdSheet"); if (sh) sh.classList.remove("open");
  }
  var MODE = "pwd";
  function openPwdSheet(mode) {
    ensureCSS(); ensureSheet();
    MODE = mode === "name" ? "name" : "pwd";
    var m = ST.me || {};
    $("#pwTitle").textContent = MODE === "name" ? "设置登录用户名" : (m.has_pwd ? "修改登录密码" : "设置登录密码");
    $("#pwDesc").textContent = MODE === "name"
      ? "用户名用于登录，设置后可用「用户名 + 密码」进入"
      : (m.has_pwd ? "改完立即生效，下次用新密码登录" : "设置后下次打开可直接用密码登录，不用再等短信验证码");
    var nameWrap = $("#pwNameWrap");
    if (nameWrap) nameWrap.style.display = "";
    var n = $("#pwName"); if (n) n.value = m.username || "";
    var p = $("#pwPwd"); if (p) { p.value = ""; p.type = "password"; }
    var p2 = $("#pwPwd2"); if (p2) p2.value = "";
    var eye = $("#pwEye"); if (eye) eye.textContent = "显示";
    var err = $("#pwErr"); if (err) err.textContent = "";
    /* 验证码每次重新开始 */
    CODE.vid = ""; CODE.at = 0; CODE.retried = false;
    clearInterval(CODE.timer);
    var c = $("#pwCode"); if (c) c.value = "";
    var sb = $("#pwSend"); if (sb) { sb.disabled = false; sb.textContent = "获取验证码"; }
    var st = $("#pwSendTip");
    if (st) {
      var mp = maskPhone((who() || {}).phone);
      st.textContent = "为确认是你本人操作，需先给 " + (mp || "本机号码") + " 发一条验证码，收到后连同密码一起提交";
    }
    var sh = $("#pwdSheet"); if (sh) sh.classList.add("open");
    setTimeout(function () { if (n) n.focus(); }, 180);
    /* 预取服务端账号信息：手机号兜底全靠它（会话对象里没有手机号） */
    fetchMe(true);
  }

  function refreshBlock() {
    var b2 = document.getElementById("acctBlk");
    if (!b2) return;
    fetchMe(true).then(function () {
      var b3 = document.getElementById("acctBlk");
      if (!b3) return;
      b3.outerHTML = blockHTML();
      var a2 = $("#acSetPwd"), c2 = $("#acSetName");
      if (a2) a2.addEventListener("click", function () { openPwdSheet("pwd"); });
      if (c2) c2.addEventListener("click", function () { openPwdSheet("name"); });
    });
  }

  function doSave() {
    var btn = $("#pwSave"), errE = $("#pwErr");
    var uname = ($("#pwName").value || "").trim();
    var pwd = $("#pwPwd").value || "";
    var pwd2 = $("#pwPwd2").value || "";
    var code = ($("#pwCode").value || "").trim();
    function fail(m) { if (errE) errE.textContent = m; }
    function restore(t) { btn.disabled = false; btn.textContent = t || "保存并启用"; }

    if (!uname) return fail("请填写登录用户名");
    var rule = (C().accounts && C().accounts.rule) ? C().accounts.rule(uname) : "";
    if (rule) return fail(rule);
    if (pwd.length < 6 || pwd.length > 20) return fail("密码请设置 6-20 位");
    if (pwd !== pwd2) return fail("两次输入的密码不一致");
    if (!/^\d{4,6}$/.test(code)) return fail("请填写收到的短信验证码");
    var phone = getPhone();
    if (!/^1\d{10}$/.test(phone)) return fail("没取到手机号，请稍候再试一次或重新登录后再设置");
    if (!CODE.vid || CODE.phone !== phone) return fail("请先点「获取验证码」，收到后再提交");
    if (Date.now() - CODE.at > 10 * 60 * 1000) return fail("验证码已过期，请点「重新获取」");

    btn.disabled = true; btn.textContent = "设置中…"; fail("");
    /* ① 平台侧设密码（它自己的加密格式，走验证码重置接口）
       ② 立刻用新密码登一次：既确认真的能用，也把可能被重置操作影响的会话刷新回来
       ③ 最后保存「用户名 → 手机号」映射 */
    C().accounts.setPwd(phone, CODE.vid, code, pwd).then(function (r) {
      if (!r || !r.ok) { restore(); return fail((r && r.msg) || "设置密码失败，请稍后重试"); }
      CODE.vid = "";
      return C().accounts.signIn(phone, pwd).then(function (si) {
        if (si && si.error) {
          restore();
          return fail("密码已设置，但自动登录没成功，请返回用验证码登录后再试");
        }
        return C().accounts.save(uname, pwd, phone).then(function (sr) {
          restore();
          ST.me = null; ST.at = 0;
          if (!sr || !sr.ok) {
            return fail("密码已设好（可用手机号+密码登录），但登录名没保存：" + ((sr && sr.msg) || "请换个用户名再试一次"));
          }
          closeSheet();
          if ($("#pwCode")) $("#pwCode").value = "";
          if ($("#pwSendTip")) $("#pwSendTip").textContent = "";
          toast("设置成功 ✅ 下次可用「" + uname + "」+ 密码直接登录");
          refreshBlock();
        });
      });
    }).catch(function (e) {
      restore();
      fail("设置失败，请检查网络后重试");
      try { console.warn(TAG, e); } catch (_) {}
    });
  }

  /* ---------------- 登录后自动提醒（每会话一次） ---------------- */
  function onAuth() {
    if (!signedIn()) { ST.me = null; return; }
    ST.me = null;
    if (C().accounts && C().accounts.remind) C().accounts.remind();
  }

  function boot() {
    ensureCSS();
    watch();
    window.addEventListener("yrb-auth", function () { setTimeout(onAuth, 200); });
    /* 已登录状态下打开页面：也走一次（延迟，避免和启动流程抢资源） */
    setTimeout(function () { if (signedIn()) onAuth(); }, 4000);
    window.YRB_ACCOUNT = {
      open: openPwdSheet,
      me: function () { return fetchMe(true); },
      refresh: function () { injectIntoSubpage(); }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
