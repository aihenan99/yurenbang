/* 育人帮 · 平稳升级层（upgrade.js）  2026-10-23
   ------------------------------------------------------------------
   目标：版本更新对用户是"打个招呼"，不是"页面突然刷新/白屏/功能对不上"。

   做四件事：
     1) 版本一致性闸门：页面 HTML 的构建号 与 资源包内的构建号必须一致。
        不一致说明命中了新旧混载（CDN/浏览器缓存错层），这是最危险的状态
        （新 HTML 配旧 JS → 按钮点了没反应），自动纠正且最多纠正一次。
     2) 新版本探测：轻量读 /build.json（no-store），比对当前构建号。
     3) 温和提示：底部浮卡「有新版本」+ [立即更新] / [稍后]，绝不自动刷新打断；
        用户正在输入或弹层打开时，延后到安全时机再提示。
     4) 更新落地：优先让等待中的 Service Worker 接管后刷新；无 SW 则直接刷新。
        刷新前记录目标版本，回来后只提示一次「已更新」，不会反复打扰。

   对外：window.YRB_UPGRADE = { build, check, apply, pending }
   ------------------------------------------------------------------ */
(function () {
  if (window.YRB_UPGRADE) { return; }

  var META = document.querySelector('meta[name="yrb-build"]');
  var PAGE_BUILD = (META && META.content) || "";
  var PKG_BUILD = window.YRB_BUILD || "";
  var CHECK_MS = 10 * 60 * 1000;
  var SKIP_KEY = "yrb_upgrade_skip_v1";
  var DONE_KEY = "yrb_upgrade_done_v1";
  var FIX_KEY = "yrb_upgrade_fix_v1";

  var pendingBuild = "";      /* 发现的新版本号 */
  var applying = false;
  var cardEl = null;

  function ls(k, v) {
    try { if (v === undefined) { return localStorage.getItem(k); } localStorage.setItem(k, v); return v; } catch (e) { return null; }
  }
  function ss(k, v) {
    try { if (v === undefined) { return sessionStorage.getItem(k); } sessionStorage.setItem(k, v); return v; } catch (e) { return null; }
  }
  function say(msg, ms) {
    if (typeof window.toast === "function") { try { window.toast(msg); return; } catch (e) {} }
    var d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:99999;" +
      "background:rgba(35,25,20,.9);color:#fff;font-size:13px;border-radius:99px;padding:10px 20px;" +
      "max-width:86vw;text-align:center;line-height:1.5";
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, ms || 2600);
  }

  /* ---------------- 1. 版本一致性闸门 ---------------- */
  function consistencyGate() {
    if (!PAGE_BUILD || !PKG_BUILD) { return; }
    if (PAGE_BUILD === PKG_BUILD) {
      /* 记录当前生效版本，供后台「系统健康」展示 */
      document.documentElement.dataset.yrbBuild = PAGE_BUILD;
      return;
    }
    /* 命中混载。只纠正一次，避免死循环（若第二次还不一致，说明源站本身有问题） */
    if (ls(FIX_KEY) === PAGE_BUILD + "|" + PKG_BUILD) {
      console.warn("[升级] 版本仍不一致，已停止自动纠正，等待下次部署修复");
      document.documentElement.dataset.yrbBuild = PAGE_BUILD;
      document.documentElement.dataset.yrbMixed = "1";
      return;
    }
    ls(FIX_KEY, PAGE_BUILD + "|" + PKG_BUILD);
    console.warn("[升级] 检测到新旧版本混载 页面=" + PAGE_BUILD + " 资源=" + PKG_BUILD + "，正在纠正");
    ss(DONE_KEY, PAGE_BUILD);
    location.reload();
  }

  /* ---------------- 2 & 3. 探测 + 提示 ---------------- */
  function safeToPrompt() {
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { return false; }
    var blocking = document.querySelector(
      "#loginSheet.open, #pubSheet.open, #funcAddSheet.open, #viewer.open, " +
      "#shareLayer.open, #adLayer.open, #shGuide.open, .sheet.open, .modal.open");
    if (blocking) { return false; }
    if (document.visibilityState !== "visible") { return false; }
    return true;
  }

  function ensureCard() {
    if (cardEl && document.body.contains(cardEl)) { return cardEl; }
    if (!document.getElementById("yrbUpgCss")) {
      var c = document.createElement("style");
      c.id = "yrbUpgCss";
      c.textContent =
        "#yrbUpg{position:fixed;left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:99997;" +
        "display:none;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;" +
        "background:#fff;border:1px solid #FFE0D0;box-shadow:0 10px 32px rgba(120,60,30,.18);" +
        "animation:upgIn .26s ease-out}" +
        "#yrbUpg.show{display:flex}" +
        "@keyframes upgIn{from{transform:translateY(18px);opacity:0}to{transform:none;opacity:1}}" +
        "#yrbUpg .up-ic{flex:none;font-size:20px;line-height:1}" +
        "#yrbUpg .up-tx{flex:1;min-width:0}" +
        "#yrbUpg .up-t{display:block;font-size:13.5px;font-weight:900;color:#3B2A20;line-height:1.35}" +
        "#yrbUpg .up-s{display:block;font-size:11.5px;color:#8C7A6E;margin-top:2px;line-height:1.4}" +
        "#yrbUpg button{flex:none;border:none;border-radius:99px;padding:9px 14px;font-size:13px;" +
        "font-weight:800;font-family:inherit;cursor:pointer}" +
        "#yrbUpg .up-go{background:linear-gradient(135deg,#F0543C,#F0803C);color:#fff}" +
        "#yrbUpg .up-later{background:#FFF3EC;color:#A8563C}" +
        "#phone[data-elder=\"1\"] #yrbUpg .up-t{font-size:16px}" +
        "#phone[data-elder=\"1\"] #yrbUpg .up-s{font-size:13.5px}" +
        "#phone[data-elder=\"1\"] #yrbUpg button{font-size:15px;padding:11px 16px}";
      document.head.appendChild(c);
    }
    var el = document.createElement("div");
    el.id = "yrbUpg";
    el.innerHTML = '<span class="up-ic">✨</span>' +
      '<span class="up-tx"><span class="up-t">有新版本啦</span>' +
      '<span class="up-s">更新后功能更稳，不会丢失您正在看的内容</span></span>' +
      '<button class="up-later" data-up="later">稍后</button>' +
      '<button class="up-go" data-up="go">立即更新</button>';
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-up]");
      if (!b) { return; }
      if (b.dataset.up === "later") {
        ls(SKIP_KEY, pendingBuild);
        hideCard();
      } else {
        apply();
      }
    });
    document.body.appendChild(el);
    cardEl = el;
    return el;
  }

  function hideCard() { if (cardEl) { cardEl.classList.remove("show"); } }

  function tryPrompt() {
    if (!pendingBuild || applying) { return; }
    if (ls(SKIP_KEY) === pendingBuild) { return; }     /* 用户已选「稍后」，本版本不再问 */
    if (!safeToPrompt()) { return; }                    /* 等安全时机（输入中/弹层中） */
    ensureCard().classList.add("show");
  }

  function check() {
    if (!PAGE_BUILD) { return; }
    fetch("/build.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.build) { return; }
        if (j.build !== PAGE_BUILD && j.build !== pendingBuild) {
          pendingBuild = j.build;
          tryPrompt();
        }
      })
      .catch(function () { /* 离线或未生成 build.json，静默 */ });
  }

  /* ---------------- 4. 落地更新 ---------------- */
  function apply() {
    if (applying) { return; }
    applying = true;
    ss(DONE_KEY, pendingBuild || PAGE_BUILD);
    hideCard();
    var done = false;
    function go() {
      if (done) { return; }
      done = true;
      location.reload();
    }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg && reg.waiting) {
            navigator.serviceWorker.addEventListener("controllerchange", go, { once: true });
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
            setTimeout(go, 1800);       /* SW 未响应也不能卡住用户 */
          } else {
            /* 没有等待中的 SW：清掉 SW 缓存后刷新，确保拿到新构建 */
            if (reg && reg.update) { reg.update().catch(function () {}); }
            setTimeout(go, 260);
          }
        }).catch(go);
        setTimeout(go, 3200);
      } else {
        go();
      }
    } catch (e) { go(); }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    consistencyGate();

    /* 上次刚更新完：只提示一次 */
    var doneTo = ss(DONE_KEY);
    if (doneTo) {
      ss(DONE_KEY, "");
      if (doneTo === PAGE_BUILD) {
        setTimeout(function () { say("已更新到最新版本 ✨", 2400); }, 1600);
      }
    }

    /* SW：发现新版本进入 waiting 也当作"有新版本" */
    try {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener("message", function (e) {
          if (e.data && e.data.type === "NEW_VERSION") { pendingBuild = pendingBuild || "sw"; tryPrompt(); }
        });
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (!reg) { return; }
          reg.addEventListener("updatefound", function () {
            var sw = reg.installing;
            if (!sw) { return; }
            sw.addEventListener("statechange", function () {
              if (sw.state === "installed" && navigator.serviceWorker.controller) {
                pendingBuild = pendingBuild || "sw";
                tryPrompt();
              }
            });
          });
        }).catch(function () {});
      }
    } catch (e) {}

    setTimeout(check, 4000);
    setInterval(function () {
      if (document.visibilityState === "visible") { check(); }
    }, CHECK_MS);

    /* 安全时机到来自动弹出（用户关掉了弹层/离开输入框） */
    setInterval(function () {
      if (pendingBuild && cardEl && !cardEl.classList.contains("show")) { tryPrompt(); }
    }, 6000);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { setTimeout(check, 800); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 300); });
  } else {
    setTimeout(boot, 300);
  }

  window.YRB_UPGRADE = {
    build: PAGE_BUILD,
    pkgBuild: PKG_BUILD,
    check: check,
    apply: apply,
    get pending() { return pendingBuild; }
  };
})();
