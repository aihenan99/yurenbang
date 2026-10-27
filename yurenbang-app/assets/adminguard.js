/* =========================================================
   育人帮 · 管理后台二次验证层（管理密码）
   ---------------------------------------------------------
   为什么要有这一层：
   后台只认「管理员账号」。一旦管理员的手机被人借用、或手机本身就登着管理员
   账号，光有手机验证码这道门就等于没门。所以进后台再加一道**只有管理员知道
   的管理密码**。

   密码存在哪里（关键）：
   - 云数据库表 public.yb_admin_guard：开启 RLS 且**不建任何策略**、不对
     anon/authenticated 授权 → 客户端连读都读不到，只有服务端函数可达。
   - 校验在数据库里完成（SECURITY DEFINER + bcrypt）：
       admin_guard_status()                      → 是否已设置密码
       admin_set_password(p_new, p_old)          → 设置 / 修改（改需旧密码）
       admin_verify_password(p_password)         → 校验，失败 5 次锁 5 分钟
     密码哈希永不出库，前端拿不到，也就无法离线爆破。
   - 本层只负责界面与解锁状态（sessionStorage，15 分钟失效）。

   依赖：cloud.js（YRB_CLOUD）；不改 app.js / refine23.js / cloud.js 结构
   ========================================================= */
(function () {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TTL = 15 * 60 * 1000;   /* 解锁后 15 分钟内免重复输入 */
const MIN_LEN = 8;
const MAX_FAIL = 5;

/* ---------- 解锁态（sessionStorage，关掉标签页即失效） ---------- */
const mem = { at: 0 };
function store(k, v) {
  try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); }
  catch (e) { if (v == null) mem.at = 0; else mem.at = +v; }
}
function read(k) {
  try { return sessionStorage.getItem(k); } catch (e) { return mem.at ? String(mem.at) : null; }
}
function unlocked() {
  const t = +(read("yrb_admin_unlock_at") || 0);
  return !!t && Date.now() - t < TTL;
}
function markUnlocked() { store("yrb_admin_unlock_at", String(Date.now())); }
function lock() { store("yrb_admin_unlock_at", null); }

/* ---------- 云服务 ---------- */
function cloud() { try { return (window.YRB_CLOUD && YRB_CLOUD.client) || null; } catch (e) { return null; } }
function rpc(fn, args) {
  const c = cloud();
  if (!c || !c.database || !c.database.rpc) return Promise.resolve({ data: null, error: { message: "云服务未就绪" } });
  return c.database.rpc(fn, args).then(r => r || { data: null, error: null }).catch(e => ({ data: null, error: e }));
}
function signedIn() { try { return !!(window.YRB_CLOUD && YRB_CLOUD.signedIn && YRB_CLOUD.signedIn()); } catch (e) { return false; } }
function isAdmin() { try { return !!(window.YRB_CONSOLE && YRB_CONSOLE.isAdmin && YRB_CONSOLE.isAdmin()); } catch (e) { return false; } }

/* 只有「已登录且确为管理员」才需要密码；未登录/非管理员交给后台自己的提示页 */
function needed() { return signedIn() && isAdmin(); }

/* ---------- 界面 ---------- */
function ensureShell() {
  const phone = $("#phone");
  if (!phone || $("#agLayer")) return;
  phone.insertAdjacentHTML("beforeend", `
  <div id="agLayer">
    <div class="ag-box">
      <div class="ag-ic" id="agIc">🔐</div>
      <div class="ag-t" id="agTitle">管理员二次验证</div>
      <div class="ag-d" id="agDesc"></div>
      <div id="agFields"></div>
      <div class="ag-err" id="agErr"></div>
      <div class="ag-acts">
        <button class="ag-cancel" id="agCancel">取消</button>
        <button class="ag-ok" id="agOk">进入后台</button>
      </div>
    </div>
  </div>`);
}
function show() { ensureShell(); const l = $("#agLayer"); if (l) l.classList.add("open"); }
function hide() { const l = $("#agLayer"); if (l) l.classList.remove("open"); }
function setErr(t) { const e = $("#agErr"); if (e) e.innerHTML = t || ""; }

let after = null, mode = "verify", busy = false;

/* 密码强度：仅用于提示，真正的规则在数据库函数里再校验一次 */
function strength(v) {
  let n = 0;
  if (v.length >= MIN_LEN) n++;
  if (/[A-Za-z]/.test(v) && /[0-9]/.test(v)) n++;
  if (/[^A-Za-z0-9]/.test(v) && v.length >= 12) n++;
  return n;
}
function strengthHTML() {
  return `<div class="ag-strength" id="agBar"><i></i><i></i><i></i></div>`;
}
function paintStrength(v) {
  const n = strength(v), bars = $$("#agBar i");
  bars.forEach((b, i) => { b.className = i < n ? "on" + n : ""; });
}

function renderVerify(extra) {
  mode = "verify";
  $("#agIc").textContent = "🔐";
  $("#agTitle").textContent = "请输入管理密码";
  $("#agDesc").innerHTML = "手机验证码用于<b>登录账号</b>，管理密码用于<b>进入后台</b>。<br>两者都通过才能查看和管理社区数据。";
  $("#agFields").innerHTML = `
    <div class="ag-field">
      <label>管理密码</label>
      <input id="agPwd" type="password" autocomplete="current-password" placeholder="请输入管理密码">
    </div>`;
  $("#agOk").textContent = "进入后台";
  setErr(extra || "");
  renderIdle();
  const i = $("#agPwd"); if (i) setTimeout(() => i.focus(), 60);
}

function renderSetup(withOld) {
  mode = withOld ? "change" : "setup";
  $("#agIc").textContent = "🔑";
  $("#agTitle").textContent = withOld ? "修改管理密码" : "首次设置管理密码";
  $("#agDesc").innerHTML = withOld
    ? "修改后请牢记新密码，下次进后台要用。"
    : "后台目前只认手机验证码。为保护注册家长的数据，请再设一个<b>只有你知道</b>的管理密码。<br>以后每次进后台都需要它。";
  $("#agFields").innerHTML = `
    ${withOld ? `<div class="ag-field"><label>当前管理密码</label><input id="agOld" type="password" autocomplete="current-password" placeholder="请输入当前管理密码"></div>` : ""}
    <div class="ag-field">
      <label>新管理密码（至少 ${MIN_LEN} 位，含字母和数字）</label>
      <input id="agPwd" type="password" autocomplete="new-password" placeholder="例如 ayb2026safe">
      ${strengthHTML()}
    </div>
    <div class="ag-field">
      <label>再输一次</label>
      <input id="agPwd2" type="password" autocomplete="new-password" placeholder="确认新密码">
    </div>
    <div class="ag-tip">🔒 密码以 bcrypt 加密存放在云数据库里，只在服务器端比对，<b>密码本身不会保存在手机或网页里</b>。忘记密码需要联系技术支持重置。</div>`;
  $("#agOk").textContent = withOld ? "保存新密码" : "设置并进入";
  setErr("");
  renderIdle();
  const i = $("#agPwd"); if (i) setTimeout(() => i.focus(), 60);
}

function renderBusy(text) {
  const b = $("#agOk"); if (b) { b.disabled = true; b.textContent = text || "校验中…"; }
}
function renderIdle() {
  const b = $("#agOk"); if (b) { b.disabled = false; b.textContent = mode === "verify" ? "进入后台" : (mode === "change" ? "保存新密码" : "设置并进入"); }
}

/* ---------- 对外：打开门禁 ---------- */
function prompt(then, forceMode) {
  after = then || null;
  ensureShell(); show(); setErr("");
  rpc("admin_guard_status", {}).then(r => {
    if (r.error) { renderVerify("暂时无法连接云服务，请稍后重试"); return; }
    const d = r.data || {};
    if (d.ok === false) {
      /* 非管理员 / 未登录：不该走到这里，交回后台自己的提示 */
      hide();
      if (after) after();
      return;
    }
    if (d.locked_until && new Date(d.locked_until).getTime() > Date.now()) {
      renderVerify(lockMsg(new Date(d.locked_until)));
      return;
    }
    if (forceMode === "change") {
      if (!d.is_set) renderSetup(false); else renderSetup(true);
      return;
    }
    if (d.is_set) renderVerify(""); else renderSetup(false);
  });
}
function lockMsg(until) {
  const min = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `连续输错次数过多，已临时锁定，请约 ${min} 分钟后重试。`;
}

async function submit() {
  if (busy) return;
  const pwd = ($("#agPwd") || {}).value || "";
  if (mode === "verify") {
    if (!pwd) { setErr("请输入管理密码"); return; }
    busy = true; renderBusy("校验中…"); setErr("");
    const r = await rpc("admin_verify_password", { p_password: pwd });
    busy = false; renderIdle();
    if (r.error) { setErr("校验失败：" + esc(r.error.message || "网络异常")); return; }
    const d = r.data || {};
    if (d.ok) {
      markUnlocked(); hide();
      if (window.toast) toast("验证通过 ✅ 已进入管理后台");
      if (after) after();
      return;
    }
    if (d.reason === "locked") { setErr(lockMsg(new Date(d.locked_until))); return; }
    if (d.reason === "not_admin") { setErr("当前账号不是管理员"); return; }
    if (d.reason === "not_set") { renderSetup(false); return; }
    const left = typeof d.left === "number" ? d.left : null;
    setErr("管理密码不正确" + (left != null ? `，还可尝试 ${left} 次` : "") + "。");
    const i = $("#agPwd"); if (i) { i.value = ""; i.focus(); }
    return;
  }

  /* 设置 / 修改 */
  const pwd2 = ($("#agPwd2") || {}).value || "";
  const old = ($("#agOld") || {}).value || "";
  if (pwd.length < MIN_LEN) { setErr(`新密码至少 ${MIN_LEN} 位`); return; }
  if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) { setErr("新密码需同时包含字母和数字"); return; }
  if (pwd !== pwd2) { setErr("两次输入的新密码不一致"); return; }
  if (mode === "change" && !old) { setErr("请输入当前管理密码"); return; }
  busy = true; renderBusy("保存中…"); setErr("");
  const args = mode === "change" ? { p_new: pwd, p_old: old } : { p_new: pwd };
  const r = await rpc("admin_set_password", args);
  busy = false; renderIdle();
  if (r.error) { setErr("保存失败：" + esc(r.error.message || "网络异常")); return; }
  const d = r.data || {};
  if (d.ok) {
    markUnlocked(); hide();
    if (window.toast) toast(mode === "change" ? "管理密码已更新 ✅" : "管理密码已设置 ✅ 以后进后台都要用它");
    if (after) after();
    return;
  }
  if (d.reason === "weak") { setErr("密码太弱：至少 8 位且含字母和数字"); return; }
  if (d.reason === "bad_old") { setErr("当前管理密码不正确"); return; }
  if (d.reason === "not_admin") { setErr("当前账号不是管理员"); return; }
  setErr("保存失败，请重试");
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  if (e.target.closest("#agOk")) { e.stopPropagation(); e.preventDefault(); submit(); return; }
  if (e.target.closest("#agCancel")) {
    e.stopPropagation(); e.preventDefault();
    hide(); after = null; lock();
    return;
  }
}, true);
document.addEventListener("keydown", e => {
  const l = $("#agLayer");
  if (!l || !l.classList.contains("open")) return;
  if (e.key === "Enter") { e.preventDefault(); submit(); }
  if (e.key === "Escape") { hide(); after = null; lock(); }
}, true);
document.addEventListener("input", e => {
  if (e.target && e.target.id === "agPwd" && mode !== "verify") paintStrength(e.target.value || "");
}, true);

/* 切换账号 / 退出登录 → 立即失效，避免"换了人还开着门" */
window.addEventListener("yrb-auth", () => { lock(); });

/* ---------- 对外接口 ---------- */
window.YRB_ADMINGUARD = {
  needed, unlocked, lock, prompt,
  changePassword() { prompt(null, "change"); },
  ttlMinutes: TTL / 60000,
  maxFail: MAX_FAIL
};
})();
