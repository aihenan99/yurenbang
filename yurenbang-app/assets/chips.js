/* =========================================================
   育人帮 · 首页栏目配置层（chips.js，2026-10-23）
   背景：首页功能 chip（推荐/爆火/案例/成长录/拓展模块）原先写死在
         app.js 的 S.funcs/S.extra，运营想调整首页栏目必须改代码发版。
   做法（遵循增强层约定，不改 app.js 结构）：
     1) 云端 yb_settings 的 home_chips 键 = JSON {funcs:[...], extra:[...]}
        （后台 admin.js「🧩 首页栏目」页签维护；yb_settings 允许公开读）
     2) 本层读取配置 → 校验 → 覆写 S.funcs / S.extra → 调 app.js 全局
        renderFuncRow()/renderFeed() 重绘；localStorage 缓存兜底离线
     3) 后台保存后派发 yrb-chips 事件，当前页面立即生效
   注意：YRB_CLOUD 是异步加载的——必须运行时取值 + 监听 yrb-cloud-ready，
        不得在脚本顶层取 client（SDK 两条铁律）
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const LSKEY = "yrb_chips_v1";

  /* 与 app.js 的 renderFuncRow/funcAddSheet 能力对齐 */
  /* 成长录已从可选栏目撤下（2026-10-30，M2）：它没有任何数据源（种子数据 10-25 下线后永远空态），
     挂在栏目里等于对用户展示一个永远空白的页面。等记录功能上线后再加回来；
     旧配置里残留的 growth 会被 sanitize 的 CORE 过滤自动剔除 */
  const CORE = ["foryou", "hot", "cases"];                     // 可配置的核心栏目
  const EXTRA = ["名师课堂", "心理树洞", "爱心集市", "亲子地图", "公益图谱"]; // 拓展模块
  const DEFAULT = { funcs: ["foryou", "cases"], extra: [] };   // 默认：推荐 + 案例

  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(LSKEY) || "null"); } catch (e) { cfg = null; }
  if (!cfg || typeof cfg !== "object") cfg = JSON.parse(JSON.stringify(DEFAULT));

  function sanitize(c) {
    const out = { funcs: [], extra: [] };
    const f = (c && Array.isArray(c.funcs)) ? c.funcs : [];
    CORE.forEach(k => { if (f.indexOf(k) >= 0) out.funcs.push(k); });
    if (out.funcs.indexOf("foryou") < 0) out.funcs.unshift("foryou"); // 推荐必在，且排最前
    const x = (c && Array.isArray(c.extra)) ? c.extra : [];
    EXTRA.forEach(k => { if (x.indexOf(k) >= 0) out.extra.push(k); });
    return out;
  }

  /* 把配置套到 app.js 的全局状态并重绘（S/renderFuncRow/renderFeed 均为 app.js 顶层全局） */
  function apply() {
    try {
      if (typeof S === "undefined" || typeof renderFuncRow !== "function") return false;
      const c = sanitize(cfg);
      S.funcs = c.funcs.slice();
      S.extra = c.extra.slice();
      if (S.funcs.indexOf("hot") < 0) S.hotMode = false; // 爆火被移除时退出爆火模式
      renderFuncRow();
      if (typeof renderFeed === "function") renderFeed();
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 云端拉取 ---------- */
  let loading = false, pulled = false;
  /* 审核（2026-10-30）：后台保存会立刻触发 yrb-chips 事件并 apply 新栏目；若此时启动期
     发出的云端 pull 还在路上，回来会用云端**旧值**把刚保存的（含本会话新加的拓展）冲掉。
     置 userTouched 后，本会话内 pull 不再覆盖（云端新值下次启动自然拉到） */
  let userTouched = false;
  async function pull() {
    const C = window.YRB_CLOUD;
    if (loading || pulled || !C || !C.enabled || !C.enabled() || !C.client || !C.client.database) return;
    loading = true;
    try {
      const r = await C.client.database.from("yb_settings").select("key,value").eq("key", "home_chips").maybeSingle();
      const raw = r && r.data && r.data.value;
      if (raw && !userTouched) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        cfg = sanitize(parsed);
        try { localStorage.setItem(LSKEY, JSON.stringify(cfg)); } catch (e) {}
        apply();
      }
      pulled = true;
    } catch (e) { /* 离线/读不到时用缓存兜底 */ }
    loading = false;
  }

  /* SDK 异步：监听就绪事件 + 轮询兜底 */
  window.addEventListener("yrb-cloud-ready", pull);
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const C = window.YRB_CLOUD;
    if ((C && C.enabled && C.enabled() && C.client && C.client.database) || tries > 40) {
      clearInterval(timer); pull();
    }
  }, 300);

  /* 后台保存后即时生效（并保护本会话状态不被迟到的 pull 冲掉） */
  window.addEventListener("yrb-chips", e => {
    try {
      const d = e && e.detail;
      if (d) { cfg = sanitize(d); userTouched = true; try { localStorage.setItem(LSKEY, JSON.stringify(cfg)); } catch (e2) {} }
      apply();
    } catch (e3) {}
  });

  /* 对外接口：admin.js 读写、app.js funcAddSheet 取可用拓展清单 */
  window.YRB_CHIPS = {
    get: () => sanitize(cfg),
    extraAvail: () => {
      try { return sanitize(cfg).extra.slice(); } catch (e) { return []; }
    },
    apply: apply
  };
  /* 启动即套用（缓存值），等云端回来若有差异会再套一次 */
  apply();
})();
