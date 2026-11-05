/* =========================================================
   育人帮 · 分享层 + 管理员身份（share.js，2026-11-05）
   ------------------------------------------------------------------
   从 admin.js 拆出来的「第一屏部分」：
     1) 分享层：二维码 / 网址 / 复制 / 保存 / 系统分享 / 装到桌面
     2) 「我的」页入口注入（分享入口全员可见，管理后台入口仅管理员）
     3) 管理员身份判定（问库 is_admin()，结果按账号缓存）
     4) YRB_CONSOLE 门面：openShare / isAdmin / openAdmin（按需拉起后台）

   为什么要拆：后台管理代码 78.8KB（gzip 25.9KB）只有站长一个人用，
   却要塞进每个家长的首屏包。拆开后 admin.js 变成按需层（见 lazy.js 的
   MAP.admin），首屏只留这一份分享与身份逻辑。
   后台何时加载：点「进入管理后台」/ 点「我的 → 管理后台」/ 打开 #admin 时。

   依赖：cloud.js（YRB_CLOUD 会话）、lazy.js（按需加载 admin）；
        不改 app.js/refine23.js 结构。
   ========================================================= */
(function () {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
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
    /* 1) 旧平台账号 ID（迁移前的遗留判断，留着不碍事） */
    if (ADMIN_IDS.some(id => String(w.id || "") === id)) return true;
    /* 2) 本次会话里已问过数据库：以答案为准 */
    if (adminProbeResult === true) return true;
    if (adminProbeResult === false) return false;
    /* 3) 刷新后还没问完：先用上回缓存，避免入口闪一下才出现 */
    if (adminCached()) return true;
    /* 4) 兼容：手机号后 11 位（旧平台会话能取到号码时生效） */
    const d = digits(w.phone);
    return d.length >= 7 && ADMIN_PHONES.some(p => d.endsWith(digits(p)));
  } catch (e) { return false; }
}

/* ---------- 管理员身份：改问数据库（2026-11-01 迁移自建库后） ----------
   新库只认 public.yb_admins（is_admin() 函数），前端再也拿不到手机号可比对。
   做法：登录后异步调 is_admin() RPC，结果按账号缓存到 localStorage。
   ★ 缓存只影响「入口是否显示」，真正的增删改权限永远由数据库 RLS 判定，
     就算有人手工改 localStorage 把入口点亮，操作也会被数据库拒绝。 */
const ADMIN_CACHE = "yrb_admin_ok:";
let adminProbe = null;        /* 进行中的请求（并发去重） */
let adminProbeResult = null;  /* 本次会话的复核结果：true / false / null(未定) */

function adminCacheKey() { const w = me(); return w ? ADMIN_CACHE + String(w.id || "") : null; }
function adminCached() {
  try { const k = adminCacheKey(); return !!k && localStorage.getItem(k) === "1"; } catch (e) { return false; }
}
function adminSetCache(ok) {
  try {
    const k = adminCacheKey(); if (!k) return;
    ok ? localStorage.setItem(k, "1") : localStorage.removeItem(k);
  } catch (e) {}
}
function probeAdmin(force) {
  try {
    if (!window.YRB_CLOUD || !YRB_CLOUD.signedIn()) { adminProbeResult = false; return Promise.resolve(false); }
    if (adminProbe && !force) return adminProbe;
    const c = db();
    if (!c || typeof c.rpc !== "function") return Promise.resolve(isAdmin());
    adminProbe = c.rpc("is_admin", {}).then(r => {
      if (!r || r.error) return isAdmin();               /* 异常：沿用现有判断，不误降权 */
      const v = r.data === true || r.data === "true";
      const changed = v !== adminCached();
      adminProbeResult = v;
      adminSetCache(v);
      if (changed) {
        try { syncAdminEntry(); } catch (e) {}
        try { if (typeof renderFuncRow === "function") renderFuncRow(); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent("yrb-admin-changed", { detail: { admin: v } })); } catch (e) {}
      }
      return v;
    }).catch(() => isAdmin()).then(v => { adminProbe = null; return v; });
    return adminProbe;
  } catch (e) { return Promise.resolve(false); }
}
/* 账号一变，本会话的结论立刻作废，避免换了账号还顶着上一个账号的权限 */
function resetAdminProbe() { adminProbe = null; adminProbeResult = null; }
/* 当前账号的可读标识，用于提示文案（便于排查"为什么不是管理员"） */
function meLabel() {
  const w = me(); if (!w) return "未登录";
  const d = digits(w.phone);
  const who = w.name || ("账号" + String(w.id || "").slice(-4));
  return d.length >= 11 ? `${who}（${d.slice(0, 3)}****${d.slice(-4)}）` : who;
}

/* ---------- 分享层 DOM（一次性注入） ---------- */
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
  <div id="shGuide"></div>`);
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
/* 复制：后台的「复制联系方式」「复制体检报告」也走这里（admin.js 转调） */
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

/* ---------- 管理后台：按需拉起（2026-11-05） ----------
   后台层 78.8KB 只有管理员用得到，平时不进首屏包；点入口时才下载。
   加载期间按钮不需要转圈：本地/4G 都在百毫秒级，且加载失败会有明确提示。 */
let adminOpening = false;
function requestAdmin() {
  const open = () => {
    adminOpening = false;
    const A = window.YRB_ADMIN_CONSOLE;
    if (A && typeof A.open === "function") { try { return A.open(); } catch (e) {} }
    if (typeof toast === "function") toast("后台没加载成功，请再点一次");
  };
  if (window.YRB_ADMIN_CONSOLE) return open();
  if (adminOpening) return;             /* 连点两下不重复加载 */
  adminOpening = true;
  if (window.YRB_LAZY) {
    return YRB_LAZY.load("admin").then(open).catch(() => {
      adminOpening = false;
      if (typeof toast === "function") toast("网络有点慢，后台没加载成功，请再点一次");
    });
  }
  open();
}

/* ---------- 「我的」页菜单 ---------- */
/* 分享入口（所有人可见）；管理后台入口**仅对管理员显示**——登录、退出、
   切换账号都会通过 cloud.js 广播的 yrb-auth 事件即时刷新，无需重开应用。 */
function adminBtnHTML() {
  return `<button class="me-item" id="mmAdmin"><span class="ic">🛠</span>管理后台<span class="arr">数据与内容管理</span></button>`;
}
/* 身份是否已经有结论：true=问过库（或确认未登录），false=还没问完。
   后台「非管理员就自动退出」要用它——**没结论时不能关**，
   否则管理员刚点开后台、is_admin() 还没回来，一次无关的入口刷新就把面板关了
   （2026-11-05 拆层时实测踩到：点开 60ms 后被 syncAdminEntry 关掉）。 */
function identitySettled() { return adminProbeResult !== null || !me(); }
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
  /* 3) 确认「不是管理员」后，若后台正开着则自动退回（身份未定时不碰它） */
  const layer = $("#adLayer");
  if (!on && identitySettled() && layer && layer.classList.contains("open") && window.YRB_ADMIN_CONSOLE) {
    try { YRB_ADMIN_CONSOLE.close(); } catch (e) {}
  }
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
/* 启动即问一次身份：已登录的管理员刷新页面后入口马上出现（缓存先顶着，答案回来后校正） */
setTimeout(() => { probeAdmin().then(() => { try { syncAdminEntry(); } catch (e) {} }); }, 900);

/* 支持 yurenbang-app.html#admin 直达后台（管理员的备用入口：即使未登录也能打开登录引导） */
function hashRoute() {
  if (/^#admin/.test(location.hash)) setTimeout(requestAdmin, 1200);
}
window.addEventListener("hashchange", hashRoute);
window.addEventListener("load", hashRoute);
if (document.readyState !== "loading") hashRoute();

/* ---------- 事件 ---------- */
document.addEventListener("click", e => {
  if (e.target.closest("#mmShare")) { e.stopPropagation(); e.preventDefault(); openShare(); return; }
  if (e.target.closest("#mmAdmin")) { e.stopPropagation(); e.preventDefault(); requestAdmin(); return; }
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
  if (e.target.closest("#slAdmin")) { closeShare(); requestAdmin(); return; }
}, true);

/* 登录 / 退出后自动刷新入口显隐（后台界面自己监听 yrb-auth，这里只管入口） */
window.addEventListener("yrb-auth", () => {
  setTimeout(syncAdminEntry, 80);   /* 等 renderAccount() 把菜单刷新完再判定 */
  /* 换了账号：先作废上一个账号的判断，再问一次数据库（2026-11-01） */
  resetAdminProbe();
  probeAdmin(true).then(() => {
    try { syncAdminEntry(); } catch (e) {}
    try { if (typeof renderFuncRow === "function") renderFuncRow(); } catch (e) {}
  });
});
/* 兜底：登录面板关闭 / 退出登录时也同步一次（老逻辑选错了按钮 id，已一并修正） */
document.addEventListener("click", e => {
  if (!e.target.closest("#lgX, #loginMask, #loginClose, #clOut")) return;
  setTimeout(syncAdminEntry, 600);
}, true);
window.addEventListener("yrb-cloud-ready", () => {
  setTimeout(() => { probeAdmin().then(() => { try { syncAdminEntry(); } catch (e) {} }); }, 500);
});

/* ---------- 对外接口 ---------- */
window.YRB_SHARE = {
  openShare, closeShare, ensureShell,
  isAdmin, probeAdmin, resetAdminProbe, meLabel, copyText,
  syncEntry: syncAdminEntry
};
/* YRB_CONSOLE 保持老名字（app.js / protect.js / refine23.js / adminguard.js 都在用）：
   openShare 与 isAdmin 仍同步可用，openAdmin 改为「按需加载后台层再打开」。 */
window.YRB_CONSOLE = {
  openShare,
  /* 运行时取值（不在定义时缓存引用）：既让 `YRB_CONSOLE.isAdmin = () => true` 这种打桩有效
     （覆盖整个属性），也让只改 `YRB_SHARE.isAdmin` 的调用方自动生效——两边不各存一份判断 */
  isAdmin: () => {
    try { return (window.YRB_SHARE && YRB_SHARE.isAdmin) ? !!YRB_SHARE.isAdmin() : isAdmin(); }
    catch (e) { return false; }
  },
  openAdmin: requestAdmin,
  reload: () => {
    const A = window.YRB_ADMIN_CONSOLE;
    if (A && typeof A.reload === "function") return A.reload();
  }
};
})();
