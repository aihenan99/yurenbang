/* 育人帮 · 按需加载器（lazy.js，2026-11-05）
   ------------------------------------------------------------------
   为什么需要它：20 个功能层原本全部拼进 bundle.js，首开要下载并解析
   814.7KB（gzip 274KB），其中有些层只在特定操作时才用得上——比如
   pptview（只有打开 PPT 案例才需要）、casedit（只有编辑案例才需要）。
   把它们留在首屏包里，等于让每个人替少数操作付下载与解析成本。

   这一层只做一件事：给「按需层」一个统一入口，把它们的下载与解析
   推迟到真正用到的那一刻。它不改变任何业务层的内部结构。

   用法：
     YRB_LAZY.load("pptview").then(function(){ window.YRB_PPT.mount(...) })
     .catch(function(){ 走各层原有的降级分支 })
   约定：
     · 同一个层并发调用只发一次请求；成功后复用，失败后清掉缓存允许重试；
     · 加载地址带当前构建号（?v=），与 bundle 同版本，避免错层；
     · 不主动预热——预热就等于没按需，省流量是这一层存在的意义之一。
   ------------------------------------------------------------------ */
(function () {
  if (window.YRB_LAZY) { return; }

  var BUILD = String(window.YRB_BUILD || "").replace(/[^\d]/g, "");

  /* 按需层登记表：id → 文件 + 就位标记（与 health.js 的 LAYERS 同名同标记） */
  var MAP = {
    pptview: { js: "assets/pptview.js", flag: "YRB_PPT" }
  };

  var PENDING = {};   /* id → Promise（成功后保留） */
  var REQ = {};       /* id → 1（调用过，health 用它区分「没加载」与「加载失败」） */

  function load(id) {
    REQ[id] = 1;
    if (PENDING[id]) { return PENDING[id]; }

    var m = MAP[id];
    if (!m) { return Promise.reject(new Error("未知的按需层：" + id)); }
    /* 已经在包里（老缓存整包、或别处手动加载过）→ 直接当成功 */
    if (window[m.flag]) { return (PENDING[id] = Promise.resolve(window[m.flag])); }

    PENDING[id] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = m.js + (BUILD ? "?v=" + BUILD : "");
      s.async = true;
      s.onload = function () {
        if (window[m.flag]) { resolve(window[m.flag]); }
        else { reject(new Error(m.flag + " 未就位")); }
      };
      s.onerror = function () { reject(new Error("加载失败：" + m.js)); };
      (document.head || document.documentElement).appendChild(s);
    });

    /* 失败不锁死：清掉缓存，下次调用还能再试（弱网下的常规路径） */
    PENDING[id].catch(function () { delete PENDING[id]; });
    return PENDING[id];
  }

  window.YRB_LAZY = {
    load: load,
    isLoaded: function (id) { var m = MAP[id]; return !!(m && window[m.flag]); },
    isRequested: function (id) { return !!REQ[id]; },
    layers: function () { return Object.keys(MAP); },
    version: "1"
  };
})();
