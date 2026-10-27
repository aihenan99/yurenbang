/* =========================================================
   育人帮 · 个人资料编辑层（profile.js）
   需求（2026-10-18）：「点击我的用户名，应该可以更改自己的注册信息」
   做法：
     1) 「我的」页点头像旁的名字 / 育人帮号 → 打开编辑面板
     2) 可改：昵称、孩子年龄段、所在城市、一句话介绍；手机号只读展示
     3) 保存：先写本地（立即生效，含离线场景），登录状态下再同步云端 yb_profiles
     4) 昵称会同步到发布求助 / 帮忙留言的作者名（cloud.js 的 myName 读同一份）
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "yrb_profile_v1";
  const AGES = ["未填", "0-3岁", "3-6岁", "6-12岁", "12-15岁", "15-18岁"];

  let P = {};
  try { P = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { P = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }
  function nick() { return String(P.nick || "").trim(); }

  /* ---------- 云端同步（登录后才生效；失败静默，不影响本地保存） ---------- */
  function meId() {
    try {
      const C = window.YRB_CLOUD;
      const w = C && C.who && C.who();
      return (w && w.id) ? String(w.id) : "";
    } catch (e) { return ""; }
  }
  async function pullCloud() {
    const C = window.YRB_CLOUD, id = meId();
    if (!C || !id || !C.client || !C.client.database) return;
    try {
      const r = await C.client.database.from("yb_profiles").select("*").eq("user_id", id).maybeSingle();
      const row = r && r.data;
      if (row && !nick() && row.nick) {
        P = { nick: row.nick, childAge: row.child_age || "", city: row.city || "", bio: row.bio || "" };
        save(); apply();
      }
    } catch (e) { /* 旧库/未建表时忽略 */ }
  }
  async function pushCloud() {
    const C = window.YRB_CLOUD, id = meId();
    if (!C || !id || !C.client || !C.client.database) return false;
    const row = { nick: nick(), child_age: P.childAge || "", city: P.city || "", bio: P.bio || "" };
    try {
      await C.client.database.from("yb_profiles").update(row).eq("user_id", id);
      const chk = await C.client.database.from("yb_profiles").select("user_id").eq("user_id", id);
      if (chk && (chk.data || []).length === 0) {
        const ins = await C.client.database.from("yb_profiles").insert(Object.assign({ user_id: id }, row));
        if (ins && ins.error) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 应用到界面 ---------- */
  function apply() {
    const nameEl = $("#page-me .me-n");
    if (!nameEl) return;
    /* 未登录不显示昵称（2026-10-20 用户反馈）：头部由 cloud.js renderAccount 显示「未登录」，
       登录后 myName() 会优先读本资料，这里无需抢写 */
    try { if (window.YRB_CLOUD && YRB_CLOUD.signedIn && !YRB_CLOUD.signedIn()) return; } catch (e) {}
    const want = nick();
    if (!want) return;              /* 没设置昵称：沿用登录名 / 默认名，不覆盖 renderAccount 的结果 */
    const t = nameEl.firstChild;
    if (t && t.nodeType === 3) {
      if (t.nodeValue.trim() !== want) t.nodeValue = want + " ";
    } else {
      nameEl.insertBefore(document.createTextNode(want + " "), nameEl.firstChild);
    }
    nameEl.dataset.pfName = want;
  }

  /* ---------- 面板 ---------- */
  function ensureSheet() {
    if ($("#pfSheet")) return;
    const host = $("#phone") || document.body;
    host.insertAdjacentHTML("beforeend", `
      <div id="pfMask"></div>
      <div id="pfSheet" role="dialog" aria-label="编辑个人资料">
        <div class="pf-bar"><b>编辑资料</b><button id="pfX" aria-label="关闭">✕</button></div>
        <div class="pf-body">
          <div class="pf-note">昵称与介绍会展示在求助卡片和帮忙留言上；手机号用于登录，如需更换请联系客服。</div>
          <label class="pf-lb">昵称 <i>*</i></label>
          <input class="pf-in" id="pfNick" maxlength="12" placeholder="2-12 个字，想好再填哦">
          <div class="pf-err" id="pfErr"></div>
          <label class="pf-lb">孩子年龄段</label>
          <div class="pf-ages" id="pfAges">${AGES.map(a => `<button type="button" class="pf-age" data-a="${esc(a)}">${esc(a)}</button>`).join("")}</div>
          <label class="pf-lb">所在城市</label>
          <input class="pf-in" id="pfCity" maxlength="20" placeholder="例如：北京">
          <label class="pf-lb">一句话介绍</label>
          <textarea class="pf-in pf-ta" id="pfBio" maxlength="40" placeholder="例如：两个孩子的妈妈，喜欢分享育儿经验"></textarea>
          <div class="pf-row"><span>手机号</span><b id="pfPhone">未登录</b></div>
          <div class="pf-row"><span>育人帮号</span><b id="pfUid">—</b></div>
        </div>
        <div class="pf-foot">
          <button class="pf-btn ghost" id="pfCancel">取消</button>
          <button class="pf-btn" id="pfSave">保存</button>
        </div>
      </div>`);

    $("#pfMask").addEventListener("click", close);
    $("#pfX").addEventListener("click", close);
    $("#pfCancel").addEventListener("click", close);
    $("#pfAges").addEventListener("click", e => {
      const b = e.target.closest(".pf-age"); if (!b) return;
      [...$("#pfAges").children].forEach(x => x.classList.remove("on"));
      b.classList.add("on");
    });
    $("#pfSave").addEventListener("click", commit);
    $("#pfNick").addEventListener("input", () => { $("#pfErr").textContent = ""; });
  }

  let prevAge = "";
  function open() {
    ensureSheet();
    $("#pfNick").value = nick();
    $("#pfCity").value = P.city || "";
    $("#pfBio").value = P.bio || "";
    prevAge = P.childAge || "未填";
    [...$("#pfAges").children].forEach(b => b.classList.toggle("on", b.dataset.a === prevAge));
    /* 手机号 / 育人帮号（只读展示） */
    let phone = "", uid = "";
    try {
      const C = window.YRB_CLOUD, w = C && C.who && C.who();
      if (w) {
        uid = String(w.id || "").slice(-8);
        phone = w.phone ? w.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2") : "";
      }
    } catch (e) {}
    $("#pfPhone").textContent = phone || "未登录（登录后自动关联）";
    $("#pfUid").textContent = uid ? ("yrb_" + uid) : "—";
    $("#pfErr").textContent = "";
    $("#pfMask").classList.add("open");
    $("#pfSheet").classList.add("open");
    setTimeout(() => { try { $("#pfNick").focus(); } catch (e) {} }, 120);
  }
  function close() {
    const m = $("#pfMask"), s = $("#pfSheet");
    if (m) m.classList.remove("open");
    if (s) s.classList.remove("open");
  }

  async function commit() {
    const n = $("#pfNick").value.trim();
    if (n.length < 2 || n.length > 12) { $("#pfErr").textContent = "昵称请填 2-12 个字"; $("#pfNick").focus(); return; }
    if (/[<>\"]/.test(n)) { $("#pfErr").textContent = "昵称不能包含 < > \" 等符号"; return; }
    const ageBtn = $("#pfAges .pf-age.on");
    P = {
      nick: n,
      childAge: ageBtn ? ageBtn.dataset.a : "未填",
      city: $("#pfCity").value.trim().slice(0, 20),
      bio: $("#pfBio").value.trim().slice(0, 40)
    };
    save();
    apply();
    close();
    if (window.toast) toast("资料已更新 ✅");
    /* 登录状态下同步云端（不阻塞界面，失败也不打扰用户） */
    if (meId()) {
      const ok = await pushCloud();
      if (!ok && window.console) console.warn("[profile] 云端同步失败（本地已生效）");
    }
    try { window.dispatchEvent(new CustomEvent("yrb-profile", { detail: { profile: P } })); } catch (e) {}
  }

  /* ---------- 入口：点名字 / 育人帮号 ---------- */
  document.addEventListener("click", e => {
    const hit = e.target.closest("#page-me .me-n, #page-me .me-id");
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    /* 未登录：点头像区 = 引导登录（与下方「登录 / 注册」一致），不再打开编辑资料 */
    try {
      if (window.YRB_CLOUD && YRB_CLOUD.signedIn && !YRB_CLOUD.signedIn()) {
        if (YRB_CLOUD.ensureLogin) YRB_CLOUD.ensureLogin();
        return;
      }
    } catch (e2) {}
    open();
  }, true);

  /* 登录态变化后补一次云端资料 */
  window.addEventListener("yrb-auth", () => { setTimeout(pullCloud, 400); });

  apply();
  setTimeout(pullCloud, 2000);

  window.YRB_PROFILE = {
    get() { return Object.assign({}, P); },
    nick,
    open,
    /** 供其它层读取（如自定义文案） */
    display() { return nick() || null; }
  };
})();
