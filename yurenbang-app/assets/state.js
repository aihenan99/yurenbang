/* ============================================================================
 * 育人帮 · 状态边界守卫（state.js）
 *
 * 作用：把「谁能改全局状态 S 的哪个字段」从口头约定变成可执行的检查。
 *
 * 它的定位是**开发期的仪表盘**，不是生产拦路虎：
 *   - 本地开发（localhost / 127.0.0.1 / file:）自动开启；
 *   - 线上默认关闭，零开销；排查线上问题时加 ?stateaudit=1 打开；
 *   - 发现越界只记录 + 控制台告警，**绝不阻断**业务逻辑。
 *
 * 契约来源：assets/state.schema.js（浏览器与 CI 共用同一份）。
 * 静态审计：scripts/state-audit.mjs（提交前就会拦下新增的越界写入）。
 *
 * 已知局限（见契约 limits）：只能捕获顶层赋值；数组原地 push 不可见，
 * 靠长度快照提示；对象深层字段需显式走 YRB_STATE.set。
 * ========================================================================== */
(function () {
  "use strict";

  var schema = window.YRB_STATE_SCHEMA || null;
  var API = { version: "2", enabled: false, violations: [] };
  window.YRB_STATE = API;

  /* 注意：这里绝不能声明名为 S 的局部变量——那会遮蔽脚本顶层的词法 S，
   * typeof 永远返回 undefined。用 ST 承接。 */
  var ST = null;
  try { ST = (typeof S !== "undefined") ? S : null; } catch (_) { ST = null; }

  function isDev() {
    try {
      var q = String(location.search || "");
      if (/[?&]stateaudit=1/.test(q)) return true;
      var h = String(location.hostname || "");
      if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return true;
      if (String(location.protocol) === "file:") return true;
    } catch (_) { }
    return false;
  }

  /* ---------- 从调用栈里认出「哪个层」在写 ---------- */
  function origin() {
    var stack = "";
    try { stack = String(new Error().stack || ""); } catch (_) { return { file: "?", line: 0 }; }
    var lines = stack.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/([A-Za-z0-9_\-]+)\.js:(\d+):(\d+)/);
      if (!m) continue;
      var f = m[1];
      if (f === "state") continue;             /* 跳过本文件自身的帧 */
      return { file: f, line: parseInt(m[2], 10) || 0 };
    }
    return { file: "?", line: 0 };
  }

  var seen = {};          /* 去重：field|kind|file|line → 记录 */
  function record(field, kind, file, line, detail) {
    var key = field + "|" + kind + "|" + file + "|" + line;
    if (seen[key]) { seen[key].n++; return; }
    var item = {
      field: field, kind: kind, file: file, line: line, n: 1,
      at: new Date().toISOString(), detail: detail || ""
    };
    seen[key] = item;
    if (API.violations.length < 200) API.violations.push(item);
    try {
      console.warn("[状态越界] " + field + " ← " + file + ".js:" + line +
        (detail ? "（" + detail + "）" : ""));
    } catch (_) { }
  }

  function typeOf(v) {
    if (Array.isArray(v)) return "array";
    if (v === null) return "any";
    var t = typeof v;
    return (t === "object" || t === "string" || t === "number" || t === "boolean") ? t : "any";
  }

  function check(field, val) {
    var def = schema.fields[field];
    if (!def) { var o0 = origin(); record(field, "unknown", o0.file, o0.line, "字段未登记"); return; }
    var allow = def.writable || [];
    var o = origin();
    if (allow.indexOf(o.file) < 0) {
      record(field, "owner", o.file, o.line, "只允许 " + allow.join("/"));
    }
    var want = def.type;
    if (want && want !== "any" && val !== null && typeOf(val) !== want) {
      record(field, "type", o.file, o.line, "期望 " + want + "，实际 " + typeOf(val));
    }
    markSet(field);
  }

  /* ---------- 装访问器：S.x = v 都会被看见 ---------- */
  function install() {
    var list = Object.keys(schema.fields), n = 0;
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (!(k in ST)) continue;                /* 尚未创建的字段不接管，避免凭空造出属性 */
      var d = Object.getOwnPropertyDescriptor(ST, k);
      if (d && d.configurable === false) continue;
      (function (key) {
        var box = { v: ST[key] };
        Object.defineProperty(ST, key, {
          configurable: true,
          enumerable: true,
          get: function () { return box.v; },
          set: function (nv) {
            if (API._bypass && API._bypass.field === key) {
              /* 经 YRB_STATE.set 写入：来源可信，只做类型校验 */
              var def = schema.fields[key];
              if (def && def.type !== "any" && nv !== null && typeOf(nv) !== def.type) {
                record(key, "type", "state", 0, "期望 " + def.type + "，实际 " + typeOf(nv));
              }
              markSet(key);
            } else {
              check(key, nv);
            }
            box.v = nv;
          }
        });
      })(k);
      n++;
    }
    return n;
  }

  /* ---------- 数组原地变更：只能靠长度快照发现 ---------- */
  var lens = null;
  function snapLen() {
    lens = {};
    var list = Object.keys(schema.fields);
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (schema.fields[k].type !== "array" || !(k in ST)) continue;
      lens[k] = Array.isArray(ST[k]) ? ST[k].length : -1;
    }
  }
  function diffLen() {
    if (!lens) { snapLen(); return; }
    var list = Object.keys(lens);
    for (var i = 0; i < list.length; i++) {
      var k = list[i], v = ST[k], now = Array.isArray(v) ? v.length : -1;
      if (now === lens[k]) continue;
      /* 长度变了且 400ms 内没有对应 setter 记录 → 原地 push/splice */
      if (!recentSet(k)) {
        var key = k + "|inplace|?|0";
        if (!seen[key] && API.violations.length < 200) {
          seen[key] = {
            field: k, kind: "inplace", file: "?", line: 0, n: 1,
            at: new Date().toISOString(), detail: "长度 " + lens[k] + " → " + now + "（无法定位到层）"
          };
          API.violations.push(seen[key]);
          try {
            console.warn("[状态] " + k + " 发生原地变更（" + lens[k] + " → " + now +
              "），建议改为整体替换");
          } catch (_) { }
        }
      }
      lens[k] = now;
    }
  }
  var setLog = {};
  function recentSet(k) { var t = setLog[k]; return !!t && (Date.now() - t) < 400; }
  function markSet(k) { setLog[k] = Date.now(); }

  /* ---------- 对外 API ---------- */
  API.fields = function () { return schema ? Object.keys(schema.fields) : []; };
  API.report = function () {
    var rows = API.violations.map(function (v) {
      return { 字段: v.field, 类型: v.kind, 来源: v.file + ".js:" + v.line, 次数: v.n, 说明: v.detail };
    });
    if (!rows.length) {
      try { console.log("[状态边界] 未发现越界写入 ✅"); } catch (_) { }
      return [];
    }
    try {
      if (console.table) console.table(rows); else console.log(rows);
    } catch (_) { }
    return rows;
  };
  API.clear = function () { API.violations.length = 0; seen = {}; setLog = {}; };
  API.set = function (field, value, writer) {
    if (!ST) return false;
    var def = schema && schema.fields[field];
    if (!def) {
      try { console.warn("[状态边界] 未登记字段：" + field + "，请先写进 state.schema.js"); } catch (_) { }
    } else if (writer && (def.writable || []).indexOf(writer) < 0) {
      try { console.warn("[状态边界] " + writer + " 无权写 " + field); } catch (_) { }
      return false;
    }
    API._bypass = { field: field };
    try { ST[field] = value; } finally { API._bypass = null; markSet(field); }
    return true;
  };
  API.get = function (field) { return ST ? ST[field] : undefined; };

  /* ---------- 启动 ---------- */
  function boot() {
    if (!schema) {
      try { console.warn("[状态边界] 缺少 state.schema.js，守卫未启用"); } catch (_) { }
      return;
    }
    if (!ST) {
      try { console.warn("[状态边界] 未找到全局状态 S，守卫未启用（检查脚本加载顺序）"); } catch (_) { }
      return;
    }
    API.enabled = true;
    if (!isDev()) return;                 /* 生产：只留 API，不装拦截，零开销 */

    var n = install();
    snapLen();
    try { setInterval(diffLen, 3000); } catch (_) { }
    try {
      console.log("%c[状态边界] 守卫已启用 · 已接管 " + n + " 个字段 · 契约 v" + schema.version,
        "color:#2b7a4b");
      console.log("[状态边界] 执行 YRB_STATE.report() 查看越界清单");
    } catch (_) { }
  }

  try { boot(); } catch (e) {
    try { console.warn("[状态边界] 初始化失败（不影响功能）：" + e); } catch (_) { }
  }
})();
