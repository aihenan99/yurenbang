/* =========================================================
   育人帮 · 资质证照 / 用户协议层（license.js）
   背景：设置 →「用户协议」「资质证照」原本是静态占位——
         用户协议只有一段摘要，资质证照每行「查看」没有任何响应，
         后台也没有上传入口（用户 2026-10-18 反馈"点不开、无法上传更改"）。
   做法（遵循增强层约定，不改 app.js 结构）：
     1) 包装 openSubpage：agreement → 渲染完整协议正文（与登录面板同一份）
                          license   → 渲染证照列表（数据来自云端 yb_settings）
     2) 证照图片支持点开全屏查看；未上传时给明确提示
     3) 后台（admin.js「资质证照」页签）上传后派发 yrb-license，页面即时刷新
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LSKEY = "yrb_license_v1";

  /* 证照清单：key 与后台 yb_settings 的键一一对应 */
  const LICENSES = [
    { key: "license_business", ic: "🏢", name: "营业执照", desc: "运营主体工商登记" },
    { key: "license_icp", ic: "🌐", name: "ICP 备案", desc: "网站备案信息" },
    { key: "license_edi", ic: "📡", name: "EDI 许可证", desc: "在线数据处理与交易处理" },
    { key: "license_culture", ic: "🎭", name: "网络文化经营许可证", desc: "网络文化产品经营" },
    { key: "license_copyright", ic: "©️", name: "软件著作权", desc: "平台软件著作权登记" }
  ];

  let STORE = {};
  try { STORE = JSON.parse(localStorage.getItem(LSKEY) || "{}") || {}; } catch (e) { STORE = {}; }

  function saveStore() {
    try { localStorage.setItem(LSKEY, JSON.stringify(STORE)); } catch (e) {}
  }

  /* ---------- 从云端拉取（yb_settings 允许公开读） ---------- */
  let loading = false;
  async function pull() {
    const C = window.YRB_CLOUD;
    if (loading || !C || !C.enabled || !C.enabled() || !C.client || !C.client.database) return;
    loading = true;
    try {
      const r = await C.client.database.from("yb_settings").select("key,value");
      const rows = (r && r.data) || [];
      if (rows.length) {
        let dirty = false;
        rows.forEach(x => {
          if (String(x.key || "").indexOf("license_") === 0) {
            const v = x.value || "";
            if ((STORE[x.key] || "") !== v) { STORE[x.key] = v; dirty = true; }
          }
        });
        if (dirty) saveStore();
      }
    } catch (e) { /* 离线或未开放读权限时用本地缓存兜底 */ }
    loading = false;
    if (isLicenseOpen()) renderLicense();
  }

  function valueOf(k) { return STORE[k] || ""; }

  /* ---------- 资质证照页 ---------- */
  function isLicenseOpen() {
    const p = $("#subpage");
    return !!(p && p.classList.contains("open") && $("#spTitle") && /资质证照/.test($("#spTitle").textContent || ""));
  }

  function renderLicense() {
    const body = $("#spBody"); if (!body) return;
    const rows = LICENSES.map(L => {
      const has = !!valueOf(L.key);
      return `<button class="sp-row lic-row" data-lic="${L.key}">
        <span class="ic">${L.ic}</span>
        <span class="lic-t">${esc(L.name)}<i class="lic-d">${esc(L.desc)}</i></span>
        <span class="sub"><span class="chip ${has ? "" : "off"}">${has ? "查看" : "待上传"}</span></span>
      </button>`;
    }).join("");
    body.innerHTML = `<div class="sp-sec">${rows}</div>
      <div class="sp-note">证照由平台运营方上传并公示，点「查看」可全屏查看原件。如发现信息有误，可通过「反馈与帮助」告知我们。</div>`;
  }

  /* ---------- 全屏查看 ---------- */
  function ensureViewer() {
    if ($("#licView")) return;
    const host = $("#phone") || document.body;
    host.insertAdjacentHTML("beforeend", `
      <div id="licView" role="dialog" aria-label="证照查看">
        <div class="lv-bar"><b id="lvTitle">证照</b><button id="lvClose" aria-label="关闭">✕</button></div>
        <div class="lv-body"><img id="lvImg" alt="证照图片"></div>
        <div class="lv-tip">双指可放大查看 · 点右上角关闭</div>
      </div>`);
    $("#lvClose").addEventListener("click", () => $("#licView").classList.remove("open"));
    $("#licView").addEventListener("click", e => { if (e.target.id === "licView" || e.target.className === "lv-body") $("#licView").classList.remove("open"); });
  }
  function openViewer(src, title) {
    ensureViewer();
    $("#lvTitle").textContent = title || "证照";
    $("#lvImg").src = src;
    $("#licView").classList.add("open");
  }

  /* ---------- 用户协议 / 隐私政策（完整正文） ---------- */
  function renderDoc(kind) {
    const body = $("#spBody"); if (!body) return;
    const C = window.YRB_CLOUD;
    const d = (C && C.doc) ? C.doc(kind) : null;
    if (!d || !d.html) return; /* 云服务层没就绪时保留 app.js 里的摘要，不显示空白 */
    $("#spTitle").textContent = d.title;
    body.innerHTML = `<div class="lic-doc-tabs">
        <button class="lic-tab ${kind === "terms" ? "on" : ""}" data-doc="terms">用户协议</button>
        <button class="lic-tab ${kind === "privacy" ? "on" : ""}" data-doc="privacy">隐私政策</button>
        <span class="lic-tag">${esc(d.tag || "")}</span>
      </div>
      <div class="lic-doc">${d.html}</div>`;
    body.scrollTop = 0;
    const sc = $("#spBody").closest(".sp-body") || body;
    try { sc.scrollTop = 0; } catch (e) {}
  }

  /* ---------- 包装 openSubpage ---------- */
  try {
    const _open = openSubpage;
    openSubpage = function (k) {
      _open(k);
      try {
        if (k === "agreement") { renderDoc("terms"); }
        else if (k === "license") { renderLicense(); pull(); }
      } catch (e) {}
    };
  } catch (e) {}

  /* ---------- 事件 ---------- */
  document.addEventListener("click", e => {
    /* 关于页两个入口 */
    if (e.target.closest("#spLic")) { e.stopPropagation(); openSubpage("license"); return; }
    if (e.target.closest("#spAgr")) { e.stopPropagation(); openSubpage("agreement"); return; }
    /* 协议页内切换 用户协议 / 隐私政策 */
    const tab = e.target.closest("#spBody .lic-tab");
    if (tab) { e.stopPropagation(); renderDoc(tab.dataset.doc); return; }
    /* 证照行：查看 */
    const row = e.target.closest("#spBody .lic-row");
    if (row) {
      e.stopPropagation();
      const L = LICENSES.find(x => x.key === row.dataset.lic);
      if (!L) return;
      const src = valueOf(L.key);
      if (!src) { if (window.toast) toast("该证照尚未上传，管理员可在后台「资质证照」页上传"); return; }
      openViewer(src, L.name);
      return;
    }
  }, true);

  window.addEventListener("yrb-license", () => {
    try { STORE = JSON.parse(localStorage.getItem(LSKEY) || "{}") || STORE; } catch (e) {}
    if (isLicenseOpen()) renderLicense();
  });

  window.YRB_LICENSE = {
    keys: LICENSES.map(x => x.key),
    list: LICENSES,
    get: valueOf,
    set(k, v) { STORE[k] = v || ""; saveStore(); },
    refresh: pull
  };

  /* 启动后预热一次：打开「资质证照」时无需等待 */
  setTimeout(pull, 1500);
})();
