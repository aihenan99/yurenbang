/* =========================================================
   育人帮 · 运营控制台层
   1) 分享层：二维码 / 网址 / 复制 / 保存 / 系统分享
   2) 社区管理后台：概览统计 + 求助管理（下架/恢复/删除）+ 帮忙管理（删除）
   权限：界面按管理员手机号显示入口；真正的权限由数据库 RLS（is_admin()）把关，
        普通账号即使误入也只能看到数据，操作会被数据库拒绝。
   依赖：cloud.js（YRB_CLOUD，登录/云数据库）；不改 app.js/refine23.js 结构
   ========================================================= */
(function () {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const APP_URL = "https://yurenbang.app.workbuddy.host/";
/* 管理员识别（与本库 is_admin() 函数保持一致的账号，新增管理员需同步改这里 + 数据库函数）
   ADMIN_IDS：auth.users.sub，最可靠——SDK 会话对象一定带 id，不依赖手机号能否读出来
   ADMIN_PHONES：库中手机号后 11 位，作为兼容兜底（会话里能取到手机号时生效）。
     ★ 源码里不再写死手机号（本仓库公开，硬编码等于把号码发布到全世界）。
       发布时由 temp/sync_deploy.py 从本地私有配置 config/admin.local.json
       （已 gitignore，不入库）注入 window.YRB_ADMIN.phones；源码/测试环境为空数组，
       管理员识别仍走 ADMIN_IDS 主判据，功能不受影响。
       彻底方案：云恢复后改用数据库 is_admin() RPC，前端只看结果。 */
const ADMIN_IDS = ["2110319594408247296"];
const ADMIN_PHONES = (window.YRB_ADMIN && window.YRB_ADMIN.phones) || [];

/* ---------- 工具 ---------- */
function db() {
  const c = window.YRB_CLOUD;
  try { return (c && c.enabled() && c.client && c.client.database) || null; } catch (e) { return null; }
}
function digits(s) { return String(s || "").replace(/\D/g, ""); }
function me() {
  try { return (window.YRB_CLOUD && YRB_CLOUD.who && YRB_CLOUD.who()) || null; } catch (e) { return null; }
}
function isAdmin() {
  try {
    const w = me();
    if (!w) return false;
    /* 1) 账号 ID（sub）命中即为管理员——不依赖手机号读取 */
    if (ADMIN_IDS.some(id => String(w.id || "") === id)) return true;
    /* 2) 兼容：手机号后 11 位匹配 */
    const d = digits(w.phone);
    return d.length >= 7 && ADMIN_PHONES.some(p => d.endsWith(digits(p)));
  } catch (e) { return false; }
}
/* 当前账号的可读标识，用于提示文案（便于排查"为什么不是管理员"） */
function meLabel() {
  const w = me(); if (!w) return "未登录";
  const d = digits(w.phone);
  const who = w.name || ("账号" + String(w.id || "").slice(-4));
  return d.length >= 11 ? `${who}（${d.slice(0, 3)}****${d.slice(-4)}）` : who;
}
function relTime(iso) {
  const t = new Date(iso).getTime(); if (!t) return "";
  const d = Math.max(0, (Date.now() - t) / 1000);
  if (d < 60) return "刚刚";
  if (d < 3600) return Math.floor(d / 60) + "分钟前";
  if (d < 86400) return Math.floor(d / 3600) + "小时前";
  if (d < 604800) return Math.floor(d / 86400) + "天前";
  try { return new Date(t).toLocaleDateString("zh-CN"); } catch (e) { return ""; }
}
function kindLabel(k) { return { text: "文字", voice: "语音", video: "视频", image: "图片" }[k] || (k || "文字"); }

/* ---------- DOM 注入（一次性） ---------- */
function ensureShell() {
  const phone = $("#phone"); if (!phone || $("#shareLayer")) return;
  phone.insertAdjacentHTML("beforeend", `
  <div id="shareLayer">
    <div class="sl-head"><button class="sl-back" id="slBack">‹</button><b>分享「育人帮」</b></div>
    <div class="sl-body">
      <img class="sl-qr" id="slQr" src="assets/qr-share.png?v=2" alt="育人帮二维码">
      <div class="sl-name">🌱 育人帮 · 家长互助社区</div>
      <div class="sl-slogan">关心下一代，呵护成长 —— 有困惑，发一条，很多家长愿意伸手帮你</div>
      <div class="sl-url"><span id="slUrl">${APP_URL}</span><button class="ad-act" id="slCopy" style="flex:none;padding:8px 14px">复制</button></div>
      <div class="sl-tip">
        <b>📲 像 APP 一样装到手机桌面（无需应用商店）</b><br>
        · 安卓（Chrome/Edge 等）：扫二维码打开后，点菜单「添加到主屏幕 / 安装应用」<br>
        · iPhone（Safari 扫码）：点分享按钮 →「添加到主屏幕」<br>
        · 也可以直接<b>长按上方二维码 → 保存到相册</b>，转发到家长群
      </div>
      <button class="sl-btn" id="slShare">📤 立即分享给家长群 / 好友</button>
      <button class="sl-btn ghost" id="slInstall" style="display:none">📲 安装到手机桌面（像 APP 一样全屏）</button>
      <button class="sl-btn ghost" id="slSave">⬇️ 保存二维码图片</button>
      <div class="sl-admin" id="slAdminBox" style="display:none">
        <div class="t">🛠 社区管理后台</div>
        <div class="d">求助与帮忙内容管理（下架 / 恢复 / 删除）、家教登记名单、社区数据总览。仅管理员账号可操作。</div>
        <button class="sl-btn ghost" id="slAdmin" style="margin-top:0">进入管理后台 →</button>
      </div>
    </div>
  </div>
  <div id="shGuide"></div>
  <div id="adLayer">
    <div class="ad-head"><button class="ad-back" id="adBack">‹</button><b>🛠 管理后台</b><button class="ad-refresh" id="adRefresh">刷新</button></div>
    <div class="ad-body" id="adBody"></div>
  </div>`);
}

/* ---------- 分享层 ---------- */
function openShare() { ensureShell(); $("#shareLayer").classList.add("open"); refreshInstallBtn(); }
function closeShare() { const l = $("#shareLayer"); if (l) l.classList.remove("open"); }
/* PWA 一键安装（2026-10-23b）：Chrome/Edge/华为等支持 beforeinstallprompt 的浏览器
   会出现「安装到手机桌面」按钮，点了直接生成桌面图标像 APP 一样全屏——
   恢复「微信扫码 → 生成一款 APP」的体验；iPhone/微信没有此事件，按钮保持隐藏 */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installEvt = e;
  refreshInstallBtn();
});
window.addEventListener("appinstalled", () => { installEvt = null; refreshInstallBtn(); });
function refreshInstallBtn() {
  const b = $("#slInstall");
  if (b) b.style.display = installEvt ? "flex" : "none";
}
/* 分享引导弹层（2026-10-23）：微信内置浏览器 / 老安卓 WebView 没有 navigator.share，
   直接 toast「浏览器不支持」会让用户无从下手 → 改为图文引导：
   微信内教「右上角 ··· → 发送给朋友」，其他浏览器自动复制网址 + 提示去微信粘贴。
   兜底还有「长按二维码保存图片转发」，在没有分享能力的容器里最稳。 */
function isWeChat() { return /MicroMessenger/i.test(navigator.userAgent || ""); }
function closeShareGuide() { const el = $("#shGuide"); if (el) el.classList.remove("open"); }
function shareGuide() {
  ensureShell();
  const el = $("#shGuide"); if (!el) return;
  const wx = isWeChat();
  /* 桌面图标指引（通用）：安卓微信走 ···菜单，普通浏览器走菜单安装，iPhone 走 Safari */
  const DESKTOP_TIP = wx
    ? "想在桌面生成「育」字图标（像 APP 一样）：点右上角「···」→「添加到桌面」（安卓微信支持）；iPhone 请用 Safari 打开后「添加到主屏幕」。"
    : "想在桌面生成「育」字图标（像 APP 一样）：浏览器菜单「添加到主屏幕 / 安装应用」即可；iPhone 用 Safari 打开后点分享按钮选「添加到主屏幕」。";
  el.innerHTML = `
    <div class="shg-mask" data-shg="close"></div>
    <div class="shg-card">
      <div class="shg-bar"></div>
      <div class="shg-t">📤 分享给家长群 / 好友</div>
      ${wx
        ? `<div class="shg-steps">
             <div class="shg-step"><b>1</b>点屏幕<b>右上角「···」</b></div>
             <div class="shg-step"><b>2</b>选<b>「发送给朋友」</b>或「分享到朋友圈」</div>
           </div>
           <div class="shg-note">当前是微信内置浏览器，系统不允许网页直接弹出分享面板，用右上角菜单发送即可。<br>${DESKTOP_TIP}</div>`
        : `<div class="shg-steps">
             <div class="shg-step"><b>1</b>网址<b>已自动复制</b></div>
             <div class="shg-step"><b>2</b>打开微信 / QQ，<b>粘贴</b>发送给家长群</div>
           </div>
           <div class="shg-note">当前浏览器不支持一键分享，复制粘贴同样快；也可以把下面的二维码当图片转发。<br>${DESKTOP_TIP}</div>`}
      <img class="shg-qr" src="assets/qr-share.png?v=2" alt="育人帮二维码">
      <div class="shg-scan">长按二维码 →「保存图片」，可直接发到家长群</div>
      <div class="shg-url">${esc(APP_URL)}</div>
      <div class="shg-acts">
        <button class="shg-btn" data-shg="copy">📋 复制网址</button>
        <button class="shg-btn ghost" data-shg="close">关闭</button>
      </div>
    </div>`;
  el.classList.add("open");
  if (!wx) copyText(APP_URL).then(ok => { if (ok && typeof toast === "function") toast("网址已复制，打开微信粘贴发送 ✅"); });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = t; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e2) { return false; }
  }
}

/* ---------- 管理后台：数据 ---------- */
let AD = { posts: [], comments: [], tutors: [], cases: [], reports: [], reportsErr: "", qrRow: null, licRows: {}, chipsRow: null, chipDraft: null, tab: "content", loading: false, deep: null, deepBusy: false, errs: null };
async function fetchAll() {
  const c = db(); if (!c) throw new Error("云服务未就绪");
  const [p, cm, tj, st, ls, cs, rp] = await Promise.all([
    c.from("yb_posts").select("*").order("created_at", { ascending: false }).limit(200),
    c.from("yb_comments").select("*").order("created_at", { ascending: false }).limit(200),
    c.from("yb_tutor_req").select("*").order("created_at", { ascending: false }).limit(300),
    c.from("yb_settings").select("key,value").eq("key", "jiaojiao_qr").maybeSingle(),
    c.from("yb_settings").select("key,value"),
    c.from("yb_cases").select("*").order("created_at", { ascending: false }).limit(200),
    /* 举报表 2026-10-28 新增：未建表时只降级提示，不能把整个后台拖挂 */
    c.from("yb_reports").select("*").order("created_at", { ascending: false }).limit(200)
  ]);
  if (p && p.error) throw p.error;
  if (cm && cm.error) throw cm.error;
  /* 家教表读不到不算致命（老版本无 admin 策略时），只提示 */
  if (tj && tj.error) console.warn("[后台] 家教登记读取失败：", tj.error.message || tj.error);
  if (st && st.error) console.warn("[后台] 二维码设置读取失败：", st.error.message || st.error);
  if (ls && ls.error) console.warn("[后台] 资质证照读取失败：", ls.error.message || ls.error);
  if (cs && cs.error) console.warn("[后台] 案例读取失败：", cs.error.message || cs.error);
  if (rp && rp.error) console.warn("[后台] 举报读取失败（可能尚未建表）：", rp.error.message || rp.error);
  AD.posts = (p && p.data) || [];
  AD.comments = (cm && cm.data) || [];
  AD.tutors = (tj && tj.data) || [];
  AD.cases = (cs && cs.data) || [];
  AD.reports = (rp && rp.data) || [];
  AD.reportsErr = (rp && rp.error) ? String(rp.error.message || rp.error.code || "读取失败") : "";
  AD.qrRow = (st && st.data) || null;
  AD.licRows = {};
  ((ls && ls.data) || []).forEach(x => {
    if (String(x.key || "").indexOf("license_") === 0) AD.licRows[x.key] = x.value || "";
    if (String(x.key || "") === "home_chips") AD.chipsRow = x;
  });
}
function stats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const media = { image: 0, video: 0, voice: 0 };
  AD.posts.forEach(x => (x.media || []).forEach(m => { if (media[m.kind] !== undefined) media[m.kind]++; }));
  AD.comments.forEach(x => (x.media || []).forEach(m => { if (media[m.kind] !== undefined) media[m.kind]++; }));
  const tags = {};
  AD.posts.forEach(x => { const k = x.tag || "未分类"; tags[k] = (tags[k] || 0) + 1; });
  const tagArr = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return {
    posts: AD.posts.length,
    today: AD.posts.filter(x => new Date(x.created_at).getTime() >= t0).length,
    helps: AD.comments.length,
    media, tagArr,
    hidden: AD.posts.filter(x => x.hidden).length
  };
}

/* ---------- 管理后台：页签 ---------- */
const TABS = [["content", "📚 社区内容"], ["reports", "🛡 举报处理"], ["cases", "🎬 案例管理"], ["tutor", "🎓 家教登记"], ["license", "📜 资质证照"], ["homechips", "🧩 首页栏目"], ["health", "🩺 系统健康"]];
function tabBarHTML() {
  return `<div class="ad-tabs">${TABS.map(([k, t]) =>
    `<button class="ad-tab ${AD.tab === k ? "on" : ""}" data-adtab="${k}">${t}</button>`).join("")}</div>`;
}

/* ---------- 举报处理页签（2026-10-28）：原前端只弹窗不落库，此页是真正的受理端 ---------- */
function reportsTabHTML() {
  const rows = AD.reports || [];
  const open = rows.filter(x => x.status === "open");
  const done = rows.filter(x => x.status !== "open");
  const label = (x) => x.target_type === "case" ? "案例" : x.target_type === "comment" ? "帮忙" : "求助";
  const one = (x) => `<div class="ad-item">
      <div class="ad-t">🛡 ${esc(x.reason || "（未填理由）")} · ${esc(String(x.target_title || "（无标题）").slice(0, 40))}</div>
      <div class="ad-meta">
        <span>${esc(x.reporter_name || "家长")}</span>
        <span>${label(x)} #${esc(String(x.target_id || ""))}</span>
        <span>🕘 ${relTime(x.created_at)}</span>
        <span class="ad-tag">${x.status === "open" ? "待处理" : x.status === "handled" ? "已处理" : "不成立"}</span>
      </div>
      ${x.snapshot ? `<div class="ad-note" style="margin:6px 2px;white-space:pre-wrap;max-height:5.4em;overflow:hidden">${esc(String(x.snapshot).slice(0, 300))}</div>` : ""}
      ${x.note ? `<div class="ad-note" style="margin:6px 2px">用户补充：${esc(x.note)}</div>` : ""}
      ${x.status === "open"
        ? `<div class="ad-acts">
             <button class="ad-act warn" data-ad="rpdone" data-id="${esc(String(x.id))}">✅ 已处理</button>
             <button class="ad-act" data-ad="rpreject" data-id="${esc(String(x.id))}">🚫 不成立</button>
           </div>`
        : `<div class="ad-note" style="margin:6px 2px">处理记录：${esc(x.handle_note || "—")}${x.handled_at ? " · " + relTime(x.handled_at) : ""}</div>`}
    </div>`;

  if (!rows.length) {
    return `<div class="ad-sec">🛡 举报处理 <span class="n">0</span></div>
      <div class="ad-empty">${AD.reportsErr
        ? `举报表还没建立：${esc(AD.reportsErr)}<br>恢复云端后执行 db/schema.sql §2.1 即可启用。`
        : "还没有人举报，很好。"}</div>`;
  }
  return `
    <div class="ad-sec">🛡 举报处理 <span class="n">${open.length} 待处理 / ${rows.length} 合计</span></div>
    <div class="ad-note" style="margin:0 2px 8px">处理是<b>打标记，不删行</b>——举报记录永久保留作为审计痕迹。看到举报请先核实内容：属实的到「社区内容」下架或删除。</div>
    ${open.map(one).join("") || `<div class="ad-empty">没有待处理的举报</div>`}
    ${done.length ? `<div class="ad-sec" style="margin-top:14px">已处理 <span class="n">${done.length}</span></div>${done.slice(0, 20).map(one).join("")}` : ""}`;
}

/* ---------- 案例管理页签（2026-10-24）：查看 + 删除 ---------- */
function casesTabHTML() {
  const rows = AD.cases.map(x => {
    const ms = x.media || [];
    const kinds = ms.length
      ? ms.map(m => ({ image: "🖼", img: "🖼", video: "🎬", voice: "🎤", file: "📄", ppt: "📊" }[m.kind] || "📎")).join("")
      : "（无素材）";
    return `<div class="ad-item">
      <div class="ad-t">🎬 ${esc(x.title || "（无标题案例）")}</div>
      <div class="ad-meta">
        <span>${esc(x.owner_name || "家长")}</span>
        <span>${esc(x.type || "img")}</span>
        <span>${kinds}</span>
        <span>🕘 ${relTime(x.created_at)}</span>
        <span class="ad-tag">#${x.id}</span>
      </div>
      <div class="ad-acts"><button class="ad-act warn" data-ad="casedel" data-id="${x.id}">🗑 删除案例</button></div>
    </div>`;
  }).join("") || `<div class="ad-empty">案例广场还没有内容</div>`;
  return `
    <div class="ad-sec">🎬 案例广场管理 <span class="n">${AD.cases.length}</span></div>
    <div class="ad-note" style="margin:0 2px 8px">删除会<b>同时清掉案例素材文件</b>，用户端案例广场立即少一条；删除不可撤销。普通账号操作会被数据库拒绝（RLS 保护）。</div>
    ${rows}`;
}

/* ---------- 家教登记页签 ---------- */
function tutorCardHTML(x) {
  const rows = [
    ["称呼", x.name], ["微信号/手机号", x.contact], ["居住小区", x.community],
    ["年级", x.grade], ["科目", [x.subjects, x.other_subject].filter(Boolean).join("、其他：" + x.other_subject).replace("、其他：", x.other_subject ? "、其他：" : "")],
    ["频次", x.freq], ["老师类型", x.teacher_types], ["线上", x.online], ["目标", x.goals]
  ].filter(([, v]) => v);
  return `<div class="ad-item jj-ad-item">
    <div class="ad-t">🎓 ${esc(x.grade || "年级未填")} · ${esc(x.subjects || "")}</div>
    <div class="ad-meta">
      <span>${esc(x.owner_name || "家长")}</span>
      <span>🕘 ${relTime(x.created_at)}</span>
      <span class="ad-tag">#${x.id}</span>
    </div>
    <div class="jj-ad-rows">${rows.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("")}</div>
    <div class="ad-acts">
      <button class="ad-act" data-ad="jjcopy" data-id="${x.id}">📋 复制联系方式</button>
      <button class="ad-act warn" data-ad="jjdel" data-id="${x.id}">🗑 删除登记</button>
    </div>
  </div>`;
}
function tutorTabHTML() {
  const list = AD.tutors.map(tutorCardHTML).join("") || `<div class="ad-empty">还没有家教登记</div>`;
  const cur = (AD.qrRow && AD.qrRow.value) || "assets/jiaojiao-qr.png";
  const isCustom = !!(AD.qrRow && AD.qrRow.value);
  return `
    <div class="ad-sec">🎓 家教需求登记 <span class="n">${AD.tutors.length}</span></div>
    <div class="ad-note" style="margin:0 2px 8px">家长的联系方式<b>只有管理员能看到</b>（数据库只放行管理员读取）；「复制联系方式」会进剪贴板，方便直接加微信。</div>
    ${list}
    <div class="ad-sec">💬 扫码卡二维码 <span class="n">${isCustom ? "自定义" : "默认"}</span></div>
    <div class="jj-ad-qr">
      <img id="adQrImg" src="${esc(cur)}" alt="当前二维码">
      <div class="jj-ad-qr-d">
        <div class="t">家教页底部「扫码咨询」卡</div>
        <div class="d">${isCustom ? "当前为你在后台上传的二维码" : "当前为默认二维码（指向育人帮.cn 首页）"}。上传你的个人微信群二维码后，所有访客看到的扫码卡立即更换（下次进入生效，已在页面上的人刷新后生效）。</div>
        <input type="file" id="adQrFile" accept="image/*" hidden>
        <div class="acts">
          <button class="ad-act" id="adQrUp">📤 上传 / 更换二维码</button>
          ${isCustom ? `<button class="ad-act warn" id="adQrReset">↩️ 恢复默认</button>` : ""}
        </div>
      </div>
    </div>`;
}

/* ---------- 资质证照页签 ---------- */
const LIC_DEFS = [
  ["license_business", "🏢", "营业执照", "运营主体工商登记"],
  ["license_icp", "🌐", "ICP 备案", "网站备案信息"],
  ["license_edi", "📡", "EDI 许可证", "在线数据处理与交易处理"],
  ["license_culture", "🎭", "网络文化经营许可证", "网络文化产品经营"],
  ["license_copyright", "©️", "软件著作权", "平台软件著作权登记"]
];
function licSrc(key) { return (AD.licRows && AD.licRows[key]) || ""; }
function licenseTabHTML() {
  const cards = LIC_DEFS.map(([key, ic, name, desc]) => {
    const src = licSrc(key);
    return `<div class="ad-item lic-ad" data-key="${key}">
      <div class="ad-t">${ic} ${esc(name)}</div>
      <div class="ad-meta"><span>${esc(desc)}</span><span class="ad-tag">${src ? "已上传" : "未上传"}</span></div>
      <div class="lic-ad-thumb">${src
        ? `<img src="${esc(src)}" alt="${esc(name)}">`
        : `<span class="lic-ad-empty">尚未上传，用户端显示「待上传」</span>`}</div>
      <input type="file" id="adLicFile_${key}" data-licfile="${key}" accept="image/*" hidden>
      <div class="ad-acts">
        <button class="ad-act" data-licup="${key}">📤 ${src ? "更换" : "上传"}</button>
        ${src ? `<button class="ad-act warn" data-licdel="${key}">🗑 清除</button>` : ""}
      </div>
    </div>`;
  }).join("");
  return `
    <div class="ad-sec">📜 资质证照公示 <span class="n">${LIC_DEFS.length}</span></div>
    <div class="ad-note" style="margin:0 2px 8px">上传后<b>立即对访客生效</b>（设置 →「资质证照」可查看）。图片会压缩到长边 1400px 内，建议上传清晰的扫描件或照片。</div>
    ${cards}
    <div class="ad-note">证照属于公示信息，请确认无误再上传；清除后用户端该条目显示「待上传」。</div>`;
}

/* ---------- 首页栏目页签（2026-10-23） ---------- */
/* 与 chips.js / app.js 的能力清单保持一致 */
const CHIP_CORE = [
  ["foryou", "📌", "推荐", "默认栏目，不可移除"],
  ["hot", "🔥", "爆火", "按点赞排序的热门求助"],
  ["cases", "🎬", "案例", "案例广场精选"],
  ["growth", "🌱", "成长录", "记录孩子成长时间线"]
];
const CHIP_EXTRA = [
  ["名师课堂", "🧑‍🏫"], ["心理树洞", "🌳"], ["爱心集市", "🎁"], ["亲子地图", "🗺️"], ["公益图谱", "❤️"]
];
const CHIPS_DEFAULT = { funcs: ["foryou", "cases"], extra: [] };
function chipsCurrent() {
  /* 优先云端行 → 本层缓存 → 默认 */
  try {
    const raw = AD.chipsRow && AD.chipsRow.value;
    if (raw) return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {}
  try {
    if (window.YRB_CHIPS) return YRB_CHIPS.get();
  } catch (e2) {}
  return CHIPS_DEFAULT;
}
function ensureChipDraft() {
  if (!AD.chipDraft) {
    const c = chipsCurrent();
    AD.chipDraft = {
      funcs: (c.funcs || []).slice(),
      extra: (c.extra || []).slice()
    };
  }
  return AD.chipDraft;
}
function chipsTabHTML() {
  const d = ensureChipDraft();
  const coreRows = CHIP_CORE.map(([k, ic, name, desc]) => {
    const on = d.funcs.indexOf(k) >= 0;
    const fixed = k === "foryou";
    return `<div class="ad-item chip-ad">
      <div class="ad-t">${ic} ${esc(name)} ${fixed ? `<span class="ad-tag">必选</span>` : ""}</div>
      <div class="ad-meta"><span>${esc(desc)}</span></div>
      <div class="ad-acts">
        ${fixed
          ? `<button class="ad-act" disabled style="opacity:.5">✅ 显示中</button>`
          : `<button class="ad-act ${on ? "" : "warn"}" data-chipup="funcs:${k}">${on ? "✅ 显示中（点击隐藏）" : "🚫 已隐藏（点击显示）"}</button>`}
      </div>
    </div>`;
  }).join("");
  const extraRows = CHIP_EXTRA.map(([name, ic]) => {
    const on = d.extra.indexOf(name) >= 0;
    return `<div class="ad-item chip-ad">
      <div class="ad-t">${ic} ${esc(name)}</div>
      <div class="ad-meta"><span>拓展模块（预留升级架构）</span></div>
      <div class="ad-acts">
        <button class="ad-act ${on ? "" : "warn"}" data-chipup="extra:${esc(name)}">${on ? "✅ 已开放（点击关闭）" : "🚫 未开放（点击开放）"}</button>
      </div>
    </div>`;
  }).join("");
  return `
    <div class="ad-sec">🧩 首页功能栏目</div>
    <div class="ad-note" style="margin:0 2px 8px">控制<b>所有访客</b>首页顶部的功能按钮。推荐为固定栏目；保存后新访客立即生效，已在页面上的用户刷新后生效。</div>
    ${coreRows}
    <div class="ad-sec">✨ 拓展模块（用户端「＋」面板可选）</div>
    <div class="ad-note" style="margin:0 2px 8px">开放的模块会出现在首页拓展区，用户也可在首页「＋」面板中自行添加；未开放的模块用户端不显示。</div>
    ${extraRows}
    <div class="ad-acts" style="padding:10px 2px">
      <button class="ad-btn" id="adChipsSave">💾 保存栏目配置</button>
      <button class="ad-act warn" id="adChipsReset">♻️ 恢复默认（推荐 + 案例）</button>
    </div>`;
}
/* ---------- 🩺 系统健康（免疫系统仪表盘） ----------
   为什么放在后台：以前"某个功能悄悄没了"只能靠用户反馈才发现。
   这里把 health.js 的探针结果、自愈记录、构建号直接摊开，管理员随时可自查。 */
const HEALTH_NAMES = {
  app: ["应用骨架", "核心"], cloud: ["云服务与登录", "核心"],
  refine23: ["发布与详情", "重要"], access: ["长辈模式与个人页", "重要"],
  jiaojiao: ["家教栏目", "重要"], food: ["美食答谢", "重要"],
  gate: ["登录门槛", "重要"], chips: ["首页栏目配置", "重要"],
  capture: ["素材采集", "增强"], reward: ["激励与玫瑰", "增强"],
  pptview: ["案例 PPT 浏览", "增强"], admin: ["管理后台", "增强"],
  adminguard: ["后台密码门", "增强"], license: ["资质证照", "增强"],
  profile: ["个人资料编辑", "增强"], rose: ["玫瑰答谢", "增强"],
  account: ["账号中心", "增强"], protect: ["内容保护", "增强"],
  mediafull: ["媒体全屏", "增强"], cover: ["案例封面", "增强"],
  guard: ["错误监控上报", "增强"]
};
const HEALTH_EVTS = {
  boot: "启动", state: "状态", heal: "补载", recovered: "恢复", giveup: "放弃重试",
  "res-error": "资源失败", "js-error": "脚本报错", promise: "异步报错",
  sweep: "巡检", rebuild: "重建骨架", mute: "稍后提醒", manual: "手动修复"
};

function healthTabHTML() {
  const H = window.YRB_HEALTH;
  const U = window.YRB_UPGRADE;
  const build = (U && U.build) || document.documentElement.dataset.yrbBuild || "未知";
  const pkg = (U && U.pkgBuild) || "";
  const st = H ? H.status() : { total: 0, ok: 0, bad: [], detail: {}, healthy: false };
  const raw = H ? H.log() : [];
  const logs = raw.slice(-12).reverse();

  const rows = Object.keys(HEALTH_NAMES).map(k => {
    const d = st.detail[k] || { state: "fail", severity: "minor" };
    const ok = d.state === "ok";
    const healing = d.state === "healing";
    const color = ok ? "#1FA47F" : healing ? "#E9A23B" : "#E8404C";
    const label = ok ? "正常" : healing ? "修复中" : "未就绪";
    return `<div class="hl-row">
      <span class="hl-dot" style="background:${color}"></span>
      <span class="hl-n">${HEALTH_NAMES[k][0]}</span>
      <span class="hl-s" style="color:${color}">${label}</span>
      <span class="hl-lv">${HEALTH_NAMES[k][1]}</span>
    </div>`;
  }).join("");

  const logRows = logs.length ? logs.map(x => {
    const t = new Date(x.t);
    const hh = ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2);
    return `<div class="hl-log">
      <span class="hl-lt">${hh}</span>
      <b>${HEALTH_EVTS[x.evt] || x.evt}</b>
      <span class="hl-lm">${x.layer ? esc(x.layer) + " · " : ""}${esc(x.msg)}</span>
    </div>`;
  }).join("") : `<div class="ad-empty">暂无异常记录，系统运行平稳 ✅</div>`;

  return `
    <div class="hl-hero ${st.healthy ? "ok" : "bad"}">
      <div class="hl-big">${st.ok}<span>/${st.total}</span></div>
      <div class="hl-cap">${st.healthy ? "全部功能运行正常" : "有 " + st.bad.length + " 项正在自动修复"}</div>
      <div class="hl-meta">构建号 ${esc(build || "未知")}${pkg && pkg !== build ? " · ⚠️ 资源包 " + esc(pkg) : ""}</div>
    </div>
    <div class="ad-acts" style="padding:10px 2px">
      <button class="ad-btn" data-heal="check">🔄 立即体检并修复</button>
      <button class="ad-btn" data-heal="deep">${AD.deepBusy ? "⏳ 深度体检中…" : "☁️ 云端深度体检"}</button>
      <button class="ad-act" data-heal="copyreport">📋 复制体检报告</button>
      <button class="ad-act warn" data-heal="clearerrs">🧹 清理旧错误日志</button>
      <button class="ad-act warn" data-heal="clear">清空记录</button>
    </div>
    <div id="adDeep">${AD.deep ? deepHTML(AD.deep) : `<div class="ad-note">☁️ 云端深度体检：检查云数据库表结构 / RLS 防线 / 数据规模 / 边缘安全头，并拉取用户端真实错误日志。建议每周做一次。</div>`}</div>
    <div class="ad-sec">📮 用户端真实错误 <span class="n">${AD.errs ? AD.errs.length : ""}</span></div>
    <div id="adErrs">${AD.errs ? errsHTML(AD.errs) : `<div class="ad-note">点「☁️ 云端深度体检」后自动拉取最近 20 条用户端上报的错误（用户手机上的脚本报错会自动送到这里）。</div>`}</div>
    <div class="ad-sec">🧩 功能层状态</div>
    <div class="hl-grid">${rows}</div>
    <div class="ad-sec">🩹 最近自愈记录 <span class="n">${raw.length}</span></div>
    <div class="hl-logs">${logRows}</div>
    <div class="ad-note">系统每 90 秒自检一次，页面回到前台也会自检。发现某层缺失会按依赖顺序
      自动补载（最多 4 轮）；补不回来会在页面顶部明确提示，不会让功能无声消失。
      这里显示的是<b>当前这台设备</b>的运行状况；「☁️ 云端深度体检」覆盖云端数据与<b>所有用户手机</b>上报的真实错误，
      两边都看才算真正掌握系统全貌。</div>`;
}

/* ---------- ☁️ 云端深度体检（2026-10-25 后台升级） ----------
   服务端 yb_admin_health / yb_admin_recent_errs / yb_admin_clear_errs
   均为 SECURITY DEFINER + is_admin() 校验，普通账号调用直接 42501。 */
const ERR_KIND_NAMES = { "js-error": "⚠️ 脚本报错", "promise": "🌀 异步报错", "res-error": "📥 资源失败", "manual": "✍️ 人工记录" };
function deepHTML(h) {
  if (h.error) {
    return `<div class="ad-note">⚠️ 深度体检失败：${esc(String(h.error).slice(0, 120))}<br>多为网络波动或登录过期，重进后台再试。</div>`;
  }
  const tbl = (h.tables || []).map(t =>
    `<span class="ad-chip ${t.rls ? "" : "top"}">${esc(t.name)}${t.rls ? " 🔒" : " ⚠️未开RLS"}</span>`).join("");
  const noRls = (h.tables || []).filter(t => !t.rls).map(t => t.name);
  const stat = (v, name) => `<div class="ad-card"><b>${v < 0 ? "缺失" : v}</b><span>${name}</span></div>`;
  return `
    <div class="ad-cards">
      ${stat(h.posts, "求助总数")}${stat(h.comments, "帮忙总数")}${stat(h.cases, "案例数")}${stat(h.errlog, "错误日志累计")}
    </div>
    <div class="ad-note" style="margin-top:8px">🗂 云表与 RLS 防线（🔒=已开启行级安全）：<br><span class="ad-chips" style="display:inline-flex;flex-wrap:wrap;gap:6px">${tbl || "无"}</span></div>
    ${noRls.length ? `<div class="ad-note">⚠️ 有 ${noRls.length} 张表未开启 RLS：${esc(noRls.join("、"))}——需要尽快处理！</div>` : `<div class="ad-note">✅ 全部云表 RLS 防线开启，匿名/普通账号无法越权读写。</div>`}
    ${h.errlog24h > 10 ? `<div class="ad-note">⚠️ 最近 24 小时用户端上报错误 ${h.errlog24h} 条，明显偏多，请查看下方明细定位。</div>` : h.errlog24h >= 0 ? `<div class="ad-note">✅ 最近 24 小时用户端错误 ${h.errlog24h} 条（≤10 为平稳）。</div>` : ""}
    <div class="ad-meta" style="margin-top:6px">🕘 体检时间：${esc(h.checked_at || "")}</div>`;
}
function errsHTML(rows) {
  if (!rows.length) return `<div class="ad-empty">没有用户端错误上报，运行平稳 ✅</div>`;
  return rows.map(x => {
    const t = x.created_at ? new Date(x.created_at) : null;
    const hh = t ? `${t.getMonth() + 1}-${t.getDate()} ${("0" + t.getHours()).slice(-2)}:${("0" + t.getMinutes()).slice(-2)}` : "";
    return `<div class="hl-log"><span class="hl-lt">${hh}</span><b>${ERR_KIND_NAMES[x.kind] || esc(x.kind || "")}</b>
      <span class="hl-lm">${esc(String(x.msg || "").slice(0, 90))}${x.src ? " · " + esc(String(x.src).slice(0, 40)) : ""}${x.build ? " · 构建" + esc(x.build) : ""}</span></div>`;
  }).join("");
}
async function runDeep(alsoErrs) {
  AD.deepBusy = true; render();
  let failed = null;
  try {
    const r = await rpcT("yb_admin_health", {}, 20000);
    if (r && r.error) { failed = (r.error.message || r.error.error_description || "没有权限") + ""; AD.deep = { error: failed }; }
    else { AD.deep = r.data || { error: "云端返回为空" }; }
  } catch (e) { AD.deep = { error: (e && e.message) || "网络异常" }; }
  AD.deepBusy = false;
  if (alsoErrs !== false) {
    try {
      const r2 = await rpcT("yb_admin_recent_errs", { p_limit: 20 }, 20000);
      AD.errs = (r2 && !r2.error && r2.data) || [];
      if (r2 && r2.error) { console.warn("[错误日志] 读取失败：", r2.error && (r2.error.message || r2.error)); }
    } catch (e) {}
  }
  render();
  toast && toast(failed ? "深度体检失败：" + failed.slice(0, 50) : "云端深度体检完成 ✅");
}

async function chipsSave(cfgOverride) {
  const d = cfgOverride || ensureChipDraft();
  const payload = JSON.stringify({ funcs: d.funcs || [], extra: d.extra || [] });
  const r = await licRpc("admin_set_setting", { p_key: "home_chips", p_value: payload });
  if (r && r.error) {
    toast && toast("保存失败：" + ((r.error.message || r.error.error_description || "没有权限") + "").slice(0, 60));
    return false;
  }
  /* 同步到本层缓存并通知当前页面立即生效 */
  try { localStorage.setItem("yrb_chips_v1", payload); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent("yrb-chips", { detail: d })); } catch (e2) {}
  toast && toast("首页栏目已更新 ✅ 新访客立即生效");
  return true;
}


/* ---------- 管理后台：渲染 ---------- */
function gateHTML(msg, sub, btnLabel, btnId) {
  return `<div class="ad-gate"><span class="e">🔐</span>${msg}<br><span style="font-size:12px">${sub || ""}</span>
    <div><button class="ad-btn" id="${btnId || "adLogin"}">${esc(btnLabel || "📱 登录管理员账号")}</button></div>
    <div class="ad-note">管理后台仅对管理员账号开放。登录后若仍无权限，说明当前账号不是管理员。</div></div>`;
}
function render() {
  const body = $("#adBody"); if (!body) return;
  if (!window.YRB_CLOUD || !YRB_CLOUD.enabled()) {
    body.innerHTML = gateHTML("云服务未就绪", "请检查网络后点右上角「刷新」"); return;
  }
  if (!YRB_CLOUD.signedIn()) { body.innerHTML = gateHTML("请先登录管理员账号", "登录后即可查看社区数据并进行内容管理"); return; }
  if (!isAdmin()) {
    body.innerHTML = gateHTML("当前账号不是管理员",
      `本后台仅对管理员开放（当前账号：${esc(meLabel())}）。请用管理员手机号登录。`,
      "🔁 切换管理员账号登录", "adSwitch");
    return;
  }

  if (AD.loading) { body.innerHTML = `<div class="ad-gate"><span class="e">⏳</span>正在加载社区数据…</div>`; return; }
  const s = stats();
  const chips = s.tagArr.length
    ? s.tagArr.map(([t, n], i) => `<span class="ad-chip ${i === 0 ? "top" : ""}">${esc(t)} · ${n}</span>`).join("")
    : `<span class="ad-chip">暂无数据</span>`;

  const posts = AD.posts.map(x => `
    <div class="ad-item ${x.hidden ? "off" : ""}">
      <div class="ad-t">${x.hidden ? "🚫 " : ""}${esc(x.title || x.body || "（无标题）")}</div>
      <div class="ad-meta">
        <span class="ad-tag">${esc(x.tag || "求助")}</span>
        <span>${esc(x.owner_name || "家长")}</span>
        <span>${kindLabel(x.type)}</span>
        <span>🕘 ${relTime(x.created_at)}</span>
        <span>🤝 ${x.helps || 0}</span>
        ${x.hidden ? `<span class="ad-hide">已下架</span>` : ""}
      </div>
      <div class="ad-acts">
        <button class="ad-act" data-ad="toggle" data-id="${x.id}" data-v="${x.hidden ? 0 : 1}">${x.hidden ? "👁 恢复展示" : "🚫 下架"}</button>
        <button class="ad-act warn" data-ad="delpost" data-id="${x.id}">🗑 删除</button>
      </div>
    </div>`).join("") || `<div class="ad-empty">还没有求助</div>`;

  const comments = AD.comments.map(x => `
    <div class="ad-item">
      <div class="ad-t">${esc(x.body || (x.kind !== "text" ? `[${kindLabel(x.kind)}帮忙]` : "（无文字）"))}</div>
      <div class="ad-meta">
        <span>${esc(x.owner_name || "家长")}</span>
        <span>${kindLabel(x.kind)}</span>
        <span>🕘 ${relTime(x.created_at)}</span>
        <span>帖子 #${x.post_id}</span>
      </div>
      <div class="ad-acts"><button class="ad-act warn" data-ad="delcm" data-id="${x.id}">🗑 删除该帮忙</button></div>
    </div>`).join("") || `<div class="ad-empty">还没有帮忙记录</div>`;

  const head = tabBarHTML();
  if (AD.tab === "reports") {
    body.innerHTML = head + reportsTabHTML() + adminFooterHTML();
    return;
  }
  if (AD.tab === "cases") {
    body.innerHTML = head + casesTabHTML() + adminFooterHTML();
    return;
  }
  if (AD.tab === "tutor") {
    body.innerHTML = head + tutorTabHTML() + adminFooterHTML();
    return;
  }
  if (AD.tab === "license") {
    body.innerHTML = head + licenseTabHTML() + adminFooterHTML();
    return;
  }
  if (AD.tab === "homechips") {
    body.innerHTML = head + chipsTabHTML() + adminFooterHTML();
    return;
  }
  if (AD.tab === "health") {
    body.innerHTML = head + healthTabHTML() + adminFooterHTML();
    return;
  }

  body.innerHTML = head + `
    <div class="ad-cards">
      <div class="ad-card"><b>${s.posts}</b><span>求助总数（今日 +${s.today}）</span></div>
      <div class="ad-card"><b>${s.helps}</b><span>帮忙总数</span></div>
      <div class="ad-card"><b>${s.media.image + s.media.video + s.media.voice}</b><span>素材：图片${s.media.image}·视频${s.media.video}·语音${s.media.voice}</span></div>
      <div class="ad-card"><b>${s.hidden}</b><span>已下架内容</span></div>
    </div>
    <div class="ad-sec">📚 分类分布</div>
    <div class="ad-chips">${chips}</div>
    <div class="ad-sec">📄 求助管理 <span class="n">${AD.posts.length}</span></div>
    ${posts}
    <div class="ad-sec">🤝 帮忙管理 <span class="n">${AD.comments.length}</span></div>
    ${comments}
    <div class="ad-note">说明：下架内容立即从信息流隐藏但保留数据，可随时恢复；删除不可撤销。普通账号的操作会被数据库拒绝（RLS 保护）。<br>
      🔐 进入本后台需通过<b>管理员二次验证</b>（管理密码），验证通过后 15 分钟内有效，切换账号立即失效。</div>
    ${adminFooterHTML()}`;
}
function adminFooterHTML() {
  return `<div class="ad-acts" style="padding:0 0 6px">
      <button class="ad-act" id="adChangePwd">🔑 修改管理密码</button>
      <button class="ad-act" id="adLockNow">🔒 立即锁定后台</button>
    </div>`;
}
async function loadAndRender() {
  AD.loading = true; AD.chipDraft = null; render();
  try { await fetchAll(); } catch (e) {
    const body = $("#adBody");
    if (body) body.innerHTML = `<div class="ad-gate"><span class="e">⚠️</span>加载失败：${esc((e && e.message) || "网络异常")}<div><button class="ad-btn" id="adRetry">重试</button></div></div>`;
  }
  AD.loading = false; render();
}
function openAdmin() {
  ensureShell();
  /* 二次验证：管理员账号登录后，进后台还需输入管理密码（见 adminguard.js）
     未登录 / 非管理员不在这里拦——交给后台自己的提示页，避免用户看不到"该怎么登录" */
  const G = window.YRB_ADMINGUARD;
  if (G && G.needed() && !G.unlocked()) { G.prompt(openAdmin); return; }
  $("#adLayer").classList.add("open");
  loadAndRender();
}
function closeAdmin() { const l = $("#adLayer"); if (l) l.classList.remove("open"); }

/* ---------- 操作 ---------- */
async function act(el) {
  const id = el.dataset.id, op = el.dataset.ad;
  const c = db(); if (!c) return;
  if (op === "toggle") {
    const v = el.dataset.v === "1";
    el.textContent = v ? "下架中…" : "恢复中…";
    try {
      const r = await c.from("yb_posts").update({ hidden: v }).eq("id", id);
      if (r && r.error) throw r.error;
      toast && toast(v ? "已下架，信息流不再展示" : "已恢复展示");
    } catch (e) { toast && toast("操作失败：" + ((e && e.message) || "没有权限")); }
    loadAndRender();
  } else if (op === "rpdone" || op === "rpreject") {
    /* 举报处理：只改状态、不删行（保留审计痕迹） */
    const st = op === "rpdone" ? "handled" : "rejected";
    el.textContent = "处理中…";
    try {
      const w = me() || {};
      const r = await c.from("yb_reports").update({
        status: st,
        handled_at: new Date().toISOString(),
        handled_by: String(w.name || "管理员"),
        handle_note: op === "rpdone" ? "已核实处理" : "核实后不成立"
      }).eq("id", id);
      if (r && r.error) throw r.error;
      toast && toast(op === "rpdone" ? "已标记为处理完成" : "已标记为不成立");
    } catch (e) { toast && toast("操作失败：" + ((e && e.message) || "没有权限")); }
    loadAndRender();
  } else if (op === "delpost" || op === "delcm") {
    if (!confirm("确定删除？删除后不可恢复。")) return;
    try {
      const r = await c.from(op === "delpost" ? "yb_posts" : "yb_comments").delete().eq("id", id);
      if (r && r.error) throw r.error;
      toast && toast("已删除");
    } catch (e) { toast && toast("删除失败：" + ((e && e.message) || "没有权限")); }
    loadAndRender();
  } else if (op === "casedel") {
    if (!confirm("确定删除这个案例？素材文件会一并清理，删除后不可恢复。")) return;
    el.textContent = "删除中…";
    const x = AD.cases.find(t => String(t.id) === String(id));
    const C = window.YRB_CLOUD;
    try {
      if (!(C && C.deleteCase)) throw new Error("云层未就绪");
      const r = await C.deleteCase(id, (x && x.media) || []);
      if (!r || !r.ok) throw new Error(r && r.message || "没有权限");
      toast && toast("案例已删除");
      try { C.loadCases && C.loadCases(); } catch (e2) {}   /* 用户端案例广场同步刷新 */
    } catch (e) { toast && toast("删除失败：" + ((e && e.message) || "没有权限")); }
    loadAndRender();
  } else if (op === "jjdel") {
    if (!confirm("确定删除这条家教登记？删除后不可恢复。")) return;
    try {
      const r = await c.from("yb_tutor_req").delete().eq("id", id);
      if (r && r.error) throw r.error;
      toast && toast("已删除该登记");
    } catch (e) { toast && toast("删除失败：" + ((e && e.message) || "没有权限")); }
    loadAndRender();
  } else if (op === "jjcopy") {
    const x = AD.tutors.find(t => String(t.id) === String(id));
    if (!x) return;
    const txt = [x.name ? "称呼：" + x.name : "", "联系方式：" + (x.contact || ""), x.community ? "小区：" + x.community : ""]
      .filter(Boolean).join("\n") + `\n（家教登记 #${x.id}，${x.grade || ""}${x.subjects ? " · " + x.subjects : ""}）`;
    copyText(txt).then(ok => toast && toast(ok ? "联系方式已复制，去添加家长吧 ✅" : "复制失败，请长按记录手动复制"));
  }
}

/* ---------- 二维码上传（家教页扫码卡） ---------- */
function shrinkImage(file, maxPx) { return shrinkToBudget(file, maxPx, Infinity); }
/* 压到「体积预算」内的 dataURL。
   2026-10-21 排障结论：admin_set_setting 走 .cn 代理，大体积 dataURL（几百 KB~1MB）
   会被网关拦掉（yb_settings 全空 = 二维码/证照从来就没写进去过，之前全靠 localStorage 缓存假象）。
   所以这里必须把 dataURL 压到 ~200KB 以内：先降质量再缩边，循环到达标为止。 */
function shrinkToBudget(file, maxPx, budgetKB, preferPng) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("读取文件失败"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("不是有效图片"));
      img.onload = () => {
        try {
          let w = img.width, h = img.height;
          const r0 = Math.min(1, maxPx / Math.max(w, h));
          w = Math.max(1, Math.round(w * r0)); h = Math.max(1, Math.round(h * r0));
          let q = 0.85;
          const paint = (ww, hh, type, qq) => {
            const cv = document.createElement("canvas");
            cv.width = ww; cv.height = hh;
            cv.getContext("2d").drawImage(img, 0, 0, ww, hh);
            return cv.toDataURL(type, qq);
          };
          /* 二维码：先试无损 PNG（干净二维码本来就小），超预算再转 JPEG */
          if (preferPng) {
            const png = paint(w, h, "image/png");
            if (png.length <= budgetKB * 1365) return resolve(png);   /* base64 膨胀 4/3，再留余量 */
          }
          for (let round = 0; round < 7; round++) {
            const out = paint(w, h, "image/jpeg", q);
            if (out.length <= budgetKB * 1365) return resolve(out);
            if (q > 0.5) q -= 0.12;                                    /* 先降质量 */
            else { w = Math.round(w * 0.78); h = Math.round(h * 0.78); } /* 再缩边 */
            if (w < 200 || h < 200) return resolve(out);               /* 到底了，用最好的一版 */
          }
          resolve(paint(w, h, "image/jpeg", 0.5));
        } catch (e) { reject(e); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
/* RPC 带超时 + 原始错误进控制台（大 payload 被网关拦时浏览器只看到挂起/吞错误，必须自己兜） */
function rpcT(fn, args, ms) {
  const c = db();
  if (!c || !c.rpc) return Promise.resolve({ error: { message: "云服务未就绪" } });
  let done = false;
  return Promise.race([
    c.rpc(fn, args).then(r => { done = true; return r; }).catch(e => { done = true; return { error: e }; }),
    new Promise(res => setTimeout(() => {
      if (!done) {
        console.warn("[" + fn + "] RPC " + ms + "ms 无响应（疑似被网关拦截或网络挂起）");
        res({ error: { message: "TIMEOUT:云端 " + ms / 1000 + " 秒没有响应" } });
      }
    }, ms))
  ]);
}
async function qrUpload(file) {
  if (!file) return;
  /* 写库要管理员身份：先明确校验，避免"图选了、也提示成功感，但云端没写进去" */
  try {
    const C = window.YRB_CLOUD;
    if (!C || !C.signedIn || !C.signedIn()) {
      toast && toast("请先用管理员手机号登录，再上传二维码");
      return;
    }
  } catch (e) {}
  if (file.size > 15 * 1024 * 1024) { toast && toast("图片太大，请选 15MB 以内的"); return; }
  toast && toast("正在处理二维码…");
  let dataUrl;
  try { dataUrl = await shrinkToBudget(file, 560, 150, true); }
  catch (e) { toast && toast("图片处理失败：" + e.message); return; }
  const rpc = (fn, args) => rpcT(fn, args, 20000);
  const r = await rpc("admin_set_setting", { p_key: "jiaojiao_qr", p_value: dataUrl });
  if (r && r.error) {
    const raw = String(r.error.message || r.error.error_description || r.error || "");
    try { console.warn("[二维码上传] 原始错误：", r.error && (r.error.code || r.error.status), raw.slice(0, 200)); } catch (e2) {}
    toast && toast(/42501|仅管理员|permission|policy/i.test(raw)
      ? "保存失败：当前登录账号不是管理员（需用 180****5855 登录）"
      : /TIMEOUT/i.test(raw)
        ? "保存失败：云端 20 秒没响应，请检查网络后再试一次"
        : "保存失败：" + raw.slice(0, 60));
    return;
  }
  /* 回读校验：确认云端真的写进去了（防止"接口报成功但实际没落库"） */
  try {
    const D = db();
    if (D && D.from) {
      const chk = await D.from("yb_settings").select("key,value").eq("key", "jiaojiao_qr").maybeSingle();
      const got = chk && chk.data ? chk.data.value : null;
      if (chk && !chk.error && got !== dataUrl) {
        toast && toast("云端未生效（可能权限被拦截），请刷新后台后重试");
        return;
      }
    }
  } catch (e) {}
  AD.qrRow = { key: "jiaojiao_qr", value: dataUrl };
  try { localStorage.setItem("yrb_jj_qr", dataUrl); } catch (e) {}
  window.dispatchEvent(new CustomEvent("yrb-jj-qr", { detail: { value: dataUrl } }));   /* 正开着的家教页立即换新 */
  toast && toast("二维码已更换 ✅ 家教页已生效");
  render();
}
async function qrReset() {
  if (!confirm("恢复为默认二维码（指向育人帮.cn 首页）？")) return;
  const rpc = (fn, args) => {
    const c = db();
    if (!c || !c.rpc) return Promise.resolve({ error: { message: "云服务未就绪" } });
    return c.rpc(fn, args).catch(e => ({ error: e }));
  };
  const r = await rpc("admin_set_setting", { p_key: "jiaojiao_qr", p_value: "" });
  if (r && r.error) { toast && toast("操作失败：" + ((r.error.message || "没有权限").slice(0, 60))); return; }
  AD.qrRow = { key: "jiaojiao_qr", value: "" };
  try { localStorage.removeItem("yrb_jj_qr"); } catch (e) {}
  window.dispatchEvent(new CustomEvent("yrb-jj-qr"));   /* 让当前家教页立即回默认 */
  toast && toast("已恢复默认二维码");
  render();
}

/* ---------- 资质证照上传 / 清除 ---------- */
function licRpc(fn, args) {
  const c = db();
  if (!c || !c.rpc) return Promise.resolve({ error: { message: "云服务未就绪" } });
  return c.rpc(fn, args).catch(e => ({ error: e }));
}
function syncLicCache() {
  try { localStorage.setItem("yrb_license_v1", JSON.stringify(AD.licRows)); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent("yrb-license")); } catch (e) {}
}
async function licUpload(key, file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { toast && toast("图片太大，请选 20MB 以内的"); return; }
  const def = LIC_DEFS.find(d => d[0] === key) || [];
  const name = def[2] || "证照";
  toast && toast("正在处理" + name + "…");
  let dataUrl;
  try { dataUrl = await shrinkToBudget(file, 1000, 200, false); }
  catch (e) { toast && toast("图片处理失败：" + e.message); return; }
  const r = await licRpc("admin_set_setting", { p_key: key, p_value: dataUrl });
  if (r && r.error) {
    const raw = String(r.error.message || r.error.error_description || r.error || "");
    try { console.warn("[证照上传:" + key + "] 原始错误：", r.error && (r.error.code || r.error.status), raw.slice(0, 200)); } catch (e2) {}
    toast && toast(/TIMEOUT/i.test(raw) ? "保存失败：云端 20 秒没响应，请检查网络后再试一次"
      : "保存失败：" + ((raw || "没有权限").slice(0, 60)));
    return;
  }
  AD.licRows[key] = dataUrl;
  syncLicCache();
  toast && toast(name + "已更新 ✅ 用户端「设置 → 资质证照」即可查看");
  render();
}
async function licClear(key) {
  const def = LIC_DEFS.find(d => d[0] === key) || [];
  if (!confirm("清除「" + (def[2] || "该证照") + "」？清除后用户端该条目显示「待上传」。")) return;
  const r = await licRpc("admin_set_setting", { p_key: key, p_value: "" });
  if (r && r.error) { toast && toast("操作失败：" + ((r.error.message || "没有权限").slice(0, 60))); return; }
  AD.licRows[key] = "";
  syncLicCache();
  toast && toast("已清除");
  render();
}

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  /* 「我的」页两个新入口 */
  if (e.target.closest("#mmShare")) { e.stopPropagation(); e.preventDefault(); openShare(); return; }
  if (e.target.closest("#mmAdmin")) { e.stopPropagation(); e.preventDefault(); openAdmin(); return; }

  const b = e.target.closest("[data-ad]");
  if (b) { e.stopPropagation(); act(b); return; }
  /* 页签切换 */
  const tb = e.target.closest("[data-adtab]");
  if (tb) { AD.tab = tb.dataset.adtab; render(); return; }
  /* 系统健康：立即体检 / 清空自愈记录 */
  const hl = e.target.closest("[data-heal]");
  if (hl) {
    if (hl.dataset.heal === "check") {
      if (window.YRB_HEALTH) { window.YRB_HEALTH.sweep("后台手动体检"); }
      toast && toast("正在体检并修复…");
      setTimeout(render, 1400);
    } else if (hl.dataset.heal === "deep") {
      runDeep();
    } else if (hl.dataset.heal === "clearerrs") {
      if (confirm("清理 7 天前的用户端错误日志？最近 7 天的会保留。")) {
        rpcT("yb_admin_clear_errs", { p_days: 7 }, 20000).then(r => {
          if (r && r.error) { toast && toast("清理失败：" + String(r.error.message || r.error).slice(0, 50)); }
          else { toast && toast("已清理 " + (r.data === undefined ? "" : r.data) + " 条旧日志"); if (AD.deep) runDeep(); else render(); }
        });
      }
    } else if (hl.dataset.heal === "copyreport") {
      const H = window.YRB_HEALTH, G = window.YRB_GUARD;
      const s = H ? H.summary() : {};
      const lines = ["【育人帮 系统体检报告】", "时间：" + new Date().toLocaleString(),
        "构建号：" + ((window.YRB_UPGRADE && window.YRB_UPGRADE.build) || document.documentElement.dataset.yrbBuild || "未知"),
        "功能层：" + (s.ok || "") + (s.healthy ? " 全部正常" : " 异常层：" + (s.bad || []).join(",")),
        "本机监控：已上报 " + (G ? G.status().sent : 0) + " 条 / 待发 " + (G ? G.status().pending : 0) + " 条"];
      if (AD.deep && !AD.deep.error) {
        lines.push("云端数据：求助" + AD.deep.posts + " · 帮忙" + AD.deep.comments + " · 案例" + AD.deep.cases,
          "云表 RLS：" + ((AD.deep.tables || []).filter(t => t.rls).length) + "/" + (AD.deep.tables || []).length + " 开启",
          "24h 用户端错误：" + AD.deep.errlog24h + " 条");
      }
      if (AD.errs && AD.errs.length) {
        lines.push("最近错误：");
        AD.errs.slice(0, 10).forEach(x => lines.push("  [" + x.kind + "] " + String(x.msg || "").slice(0, 80)));
      }
      copyText(lines.join("\n")).then(ok => toast && toast(ok ? "体检报告已复制，可粘贴给技术支持 📋" : "复制失败，请手动截图"));
    } else {
      if (confirm("清空这台设备的自愈记录？不影响功能。")) {
        if (window.YRB_HEALTH) { window.YRB_HEALTH.clearLog(); }
        render();
      }
    }
    return;
  }
  /* 二维码上传 / 恢复默认 */
  if (e.target.closest("#adQrUp")) { const f = $("#adQrFile"); if (f) f.click(); return; }
  if (e.target.closest("#adQrReset")) { qrReset(); return; }
  /* 资质证照上传 / 清除 */
  if (e.target.closest("[data-licup]")) {
    const k = e.target.closest("[data-licup]").dataset.licup;
    const f = $("#adLicFile_" + k);
    if (f) f.click();
    return;
  }
  if (e.target.closest("[data-licdel]")) {
    licClear(e.target.closest("[data-licdel]").dataset.licdel);
    return;
  }
  /* 首页栏目：切换 / 保存 / 恢复默认 */
  const cu = e.target.closest("[data-chipup]");
  if (cu) {
    const d = ensureChipDraft();
    const [kind, name] = cu.dataset.chipup.split(":");
    const arr = kind === "funcs" ? d.funcs : d.extra;
    const i = arr.indexOf(name);
    if (i >= 0) arr.splice(i, 1); else arr.push(name);
    render();
    return;
  }
  if (e.target.closest("#adChipsSave")) { chipsSave(); return; }
  if (e.target.closest("#adChipsReset")) {
    AD.chipDraft = JSON.parse(JSON.stringify(CHIPS_DEFAULT));
    chipsSave(AD.chipDraft).then(ok => { if (ok) { AD.chipsRow = { key: "home_chips", value: JSON.stringify(AD.chipDraft) }; render(); } });
    return;
  }
  if (e.target.closest("#adBack")) { closeAdmin(); return; }
  if (e.target.closest("#adRefresh") || e.target.closest("#adRetry")) { loadAndRender(); return; }
  if (e.target.closest("#adLogin")) {
    if (window.YRB_CLOUD && YRB_CLOUD.openLogin) YRB_CLOUD.openLogin();
    else toast && toast("云服务未就绪，请稍后再试");
    return;
  }
  if (e.target.closest("#adSwitch")) {
    (async () => {
      if (window.YRB_CLOUD && YRB_CLOUD.signOut) await YRB_CLOUD.signOut();
      loadAndRender();
      if (window.YRB_CLOUD && YRB_CLOUD.openLogin) YRB_CLOUD.openLogin();
    })();
    return;
  }
  /* 二次验证相关：改密码 / 立即锁定 */
  if (e.target.closest("#adChangePwd")) {
    const G = window.YRB_ADMINGUARD;
    if (G) G.changePassword(); else toast && toast("功能未加载，请刷新页面");
    return;
  }
  if (e.target.closest("#adLockNow")) {
    const G = window.YRB_ADMINGUARD;
    if (G) G.lock();
    closeAdmin();
    toast && toast("已锁定后台，下次进入需重新输入管理密码 🔒");
    return;
  }
  if (e.target.closest("#slInstall")) {
    if (installEvt && typeof installEvt.prompt === "function") {
      const evt = installEvt; installEvt = null; refreshInstallBtn();
      try {
        evt.prompt();
        Promise.resolve(evt.userChoice).then(ch => {
          if (typeof toast === "function") toast(ch && ch.outcome === "accepted" ? "已开始安装，桌面出现「育」字图标 🎉" : "已取消安装，可随时再来");
        }).catch(() => {});
      } catch (err) { shareGuide(); }
    } else {
      shareGuide();
    }
    return;
  }
  if (e.target.closest("#slBack")) { closeShare(); return; }
  if (e.target.closest("#slCopy")) {
    copyText(APP_URL).then(ok => toast && toast(ok ? "网址已复制，去粘贴给家长吧 ✅" : "复制失败，请长按网址手动复制"));
    return;
  }
  if (e.target.closest("#slSave")) {
    const a = document.createElement("a");
    a.href = "assets/qr-share.png"; a.download = "育人帮-分享二维码.png"; a.click();
    toast && toast("二维码已开始下载（长按图片也可保存）");
    return;
  }
  if (e.target.closest("#slShare")) {
    /* 先试系统分享（支持 canShare 时校验）；不支持 / 被拒 / 出错 → 走图文引导弹层 */
    const data = { title: "育人帮 · 家长互助社区", text: "关心下一代，呵护成长。有困惑发一条，很多家长愿意伸手帮你 →", url: APP_URL };
    let launched = false;
    if (typeof navigator.share === "function") {
      try {
        if (typeof navigator.canShare !== "function" || navigator.canShare(data)) {
          navigator.share(data).then(() => {}).catch(err => {
            /* AbortError = 用户自己取消，不打扰；其他错误才提示引导 */
            if (!err || err.name !== "AbortError") shareGuide();
          });
          launched = true;
        }
      } catch (err) { launched = false; }
    }
    if (!launched) shareGuide();
    return;
  }
  /* 分享引导弹层的按钮 */
  const shg = e.target.closest("[data-shg]");
  if (shg) {
    const a = shg.dataset.shg;
    if (a === "close") { closeShareGuide(); return; }
    if (a === "copy") {
      copyText(APP_URL).then(ok => toast && toast(ok ? "网址已复制，去微信粘贴给家长吧 ✅" : "复制失败，请长按上方网址手动复制"));
      return;
    }
    return;
  }
  if (e.target.closest("#slAdmin")) { closeShare(); openAdmin(); return; }
}, true);
/* 二维码文件选择（change 事件不冒泡到 click 委托里，单独绑） */
document.addEventListener("change", e => {
  if (e.target && e.target.id === "adQrFile" && e.target.files && e.target.files[0]) {
    qrUpload(e.target.files[0]);
    e.target.value = "";
  }
  /* 资质证照：某个槽位选了图片 */
  if (e.target && e.target.dataset && e.target.dataset.licfile && e.target.files && e.target.files[0]) {
    licUpload(e.target.dataset.licfile, e.target.files[0]);
    e.target.value = "";
  }
}, true);

/* 登录 / 退出后自动刷新：①后台界面（若正打开）②「我的」页入口的显隐 */
window.addEventListener("yrb-auth", () => {
  const l = $("#adLayer");
  if (l && l.classList.contains("open")) loadAndRender();
  setTimeout(syncAdminEntry, 80);   /* 等 renderAccount() 把菜单刷新完再判定 */
});
/* 兜底：登录面板关闭 / 退出登录时也同步一次（老逻辑选错了按钮 id，已一并修正） */
document.addEventListener("click", e => {
  if (!e.target.closest("#lgX, #loginMask, #loginClose, #clOut")) return;
  setTimeout(() => {
    if ($("#adLayer") && $("#adLayer").classList.contains("open")) loadAndRender();
    syncAdminEntry();
  }, 600);
}, true);

/* 「我的」页菜单：注入「分享」入口（所有人可见）；
   管理后台入口**仅对管理员显示**——管理员手机号/账号登录后自动出现，普通用户完全看不到。
   登录、退出、切换账号都会通过 cloud.js 广播的 yrb-auth 事件即时刷新，无需重开应用。 */
function adminBtnHTML() {
  return `<button class="me-item" id="mmAdmin"><span class="ic">🛠</span>管理后台<span class="arr">数据与内容管理</span></button>`;
}
function syncAdminEntry() {
  const on = isAdmin();
  /* 1) 「我的」页入口：只有管理员看得到 */
  const menu = $("#meMenu");
  if (menu) {
    const has = $("#mmAdmin");
    if (on && !has) {
      const anchor = $("#mmShare");
      if (anchor) anchor.insertAdjacentHTML("afterend", adminBtnHTML());
      else menu.insertAdjacentHTML("beforeend", adminBtnHTML());
    } else if (!on && has) {
      has.remove();
    }
  }
  /* 2) 分享层里的后台说明区块：同样只对管理员显示（分享页发给家长群，不暴露后台） */
  const box = $("#slAdminBox");
  if (box) box.style.display = on ? "" : "none";
  /* 3) 退出登录 / 换成普通账号后，若后台正开着则自动退回 */
  const layer = $("#adLayer");
  if (!on && layer && layer.classList.contains("open")) closeAdmin();
}
function injectMenu() {
  const menu = $("#meMenu"); if (!menu) return;
  if (!$("#mmShare")) {
    menu.insertAdjacentHTML("beforeend", `
    <button class="me-item" id="mmShare"><span class="ic">📤</span>分享APP给家长<span class="arr">二维码 · 链接</span></button>`);
  }
  syncAdminEntry();
}
/* 观察 #meMenu 被重建（切换「我的」页会重刷菜单），重建后自动补回并重新判定权限 */
new MutationObserver(() => { if ($("#meMenu")) injectMenu(); })
  .observe($("#phone") || document.body, { childList: true, subtree: true });
setTimeout(injectMenu, 400);

/* 支持 yurenbang-app.html#admin 直达后台（管理员的备用入口：即使未登录也能打开登录引导） */
function hashRoute() {
  if (/^#admin/.test(location.hash)) setTimeout(openAdmin, 1200);
}
window.addEventListener("hashchange", hashRoute);
window.addEventListener("load", hashRoute);
if (document.readyState !== "loading") hashRoute();

/* 对外接口 */
window.YRB_CONSOLE = { openShare, openAdmin, isAdmin, reload: loadAndRender,
  /* 自测钩子：后台「系统健康」面板的渲染入口（便于自动化验证，不参与业务） */
  healthHTML: healthTabHTML };

/* 会话就绪/登录登出后重渲染首页栏目行：
   「＋添加」按钮仅管理员可见（app.js renderFuncRow 运行时判定），
   而首次渲染时本层还没加载/会话未就绪，这里补一次刷新 */
window.addEventListener("yrb-auth", () => {
  try { if (typeof renderFuncRow === "function") renderFuncRow(); } catch (e) {}
});
window.addEventListener("yrb-cloud-ready", () => {
  setTimeout(() => { try { if (typeof renderFuncRow === "function") renderFuncRow(); } catch (e) {} }, 300);
});
})();
