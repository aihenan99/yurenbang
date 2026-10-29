/* ============================================================================
 * 育人帮 · 全局状态契约（唯一事实来源）
 *
 * 这份文件回答一个交接时最要紧的问题：**谁能改全局状态 S 的哪个字段。**
 *
 * 它同时被两处使用：
 *   1) 浏览器：assets/state.js 在开发模式下按此表拦截写入，越界即记录；
 *   2) Node：scripts/state-audit.mjs 静态扫描全部层的写入点，与白名单比对，
 *      在 CI / pre-commit 里拦下"新写的越界代码"。
 *
 * 改这个文件的规矩：
 *   - 想让某个层能写某字段 → 把它加到 writable，并在提交信息里说明理由；
 *   - 新增字段 → 必须同时登记 type / owner / writable，否则审计脚本报错；
 *   - owner 是"数据的主人"（负责加载、校验、落库），其余是"受限写入者"。
 * ========================================================================== */
(function (g) {
  var schema = {
    version: 2,
    updated: "2026-10-27",
    /* 约定：
     *   type     字段类型，运行时守卫用它做粗校验（不阻断，只告警）
     *   owner    数据主人：负责该字段的生命周期（加载 / 合并 / 落库）
     *   writable 允许写入的层文件名（不含 .js）；owner 必须在内
     *   note     为什么这么定，交接时看这一段就够
     */
    fields: {
      /* ---------- 界面偏好：只有 app 与适老层能动 ---------- */
      lang: { type: "string", owner: "app", writable: ["app"], note: "界面语言，i18n 唯一开关" },
      region: { type: "object", owner: "app", writable: ["app"], note: "地区/城市，含 flag/name/city" },
      theme: { type: "string", owner: "app", writable: ["app"], note: "深色模式偏好" },
      fs: { type: "string", owner: "access", writable: ["app", "access"], note: "字号档位；access 适老层是主要写入者，app 负责初始化" },
      elder: { type: "string", owner: "access", writable: ["app", "access"], note: "长辈模式开关" },
      myEffect: { type: "string", owner: "app", writable: ["app"], note: "个人主页动效偏好" },

      /* ---------- 栏目结构：app 定默认，chips 后台可改 ---------- */
      funcs: { type: "array", owner: "app", writable: ["app", "chips"], note: "首页栏目清单；chips 读后台配置后写回" },
      extra: { type: "array", owner: "app", writable: ["app", "chips"], note: "自定义栏目" },
      hotMode: { type: "boolean", owner: "app", writable: ["app", "chips", "refine23"], note: "热度排序开关；refine23 会按温度自动切换" },

      /* ---------- 发布/浏览上下文：谁开面板谁负责 ---------- */
      curPost: { type: "any", owner: "app", writable: ["app", "refine23"], note: "当前打开的文章" },
      curCaseFilter: { type: "string", owner: "app", writable: ["app"], note: "案例筛选（全部/图文/图片/视频）" },
      pubType: { type: "string", owner: "app", writable: ["app", "refine23"], note: "发布类型（img/video/ppt/doc）" },
      cuType: { type: "string", owner: "app", writable: ["app", "casedit"], note: "案例发布类型；casedit 切换图文时写" },
      pickedLang: { type: "string", owner: "app", writable: ["app"], note: "语言选择器临时值" },
      pickedLangN: { type: "string", owner: "app", writable: ["app"], note: "语言显示名" },
      pickedC: { type: "string", owner: "app", writable: ["app"], note: "地区选择临时值" },

      /* ---------- 激励数值：只由 app 初始化、由对应层递增 ---------- */
      published: { type: "number", owner: "app", writable: ["app", "refine23"], note: "发布计数" },
      roses: { type: "number", owner: "app", writable: ["app", "reward", "access"], note: "玫瑰余额；app 发玫瑰时递增，access 是本地存档的恢复通道（2026-10-29 审核正名，原 H2）" },
      badge: { type: "number", owner: "app", writable: ["app"], note: "徽章等级" },

      /* ---------- 云端数据投影：只许整体替换，禁止跨层改单条 ---------- */
      posts: {
        type: "array", owner: "cloud",
        writable: ["cloud", "refine23", "access", "app"],
        note: "信息流。铁律：写入必须是整体替换（=filter / =[新, ...旧]），" +
              "禁止原地 push/unshift 单条。" +
              "分工：cloud 拉取与对齐云端、refine23 合并增强字段、" +
              "access 打阅读标记（p.faved/p.seen）、app 仅做本地发布后的乐观插入"
      },
      cases: { type: "array", owner: "cloud", writable: ["app", "cloud", "casedit"], note: "案例广场；casedit 发布后局部刷新" },
      growth: { type: "array", owner: "cloud", writable: ["app", "cloud"], note: "成长记录" },
      msgs: { type: "array", owner: "cloud", writable: ["app", "cloud"], note: "消息" },

      /* ---------- 纯本地偏好：access 独占 ---------- */
      history: { type: "array", owner: "access", writable: ["access"], note: "浏览历史，仅存本机" },
      favIds: { type: "array", owner: "access", writable: ["access"], note: "收藏 id，仅存本机" },

      /* ---------- 运行时字段：由所属层在启动时挂到 S 上，不在 app.js 里初始化 ---------- */
      points: { type: "number", owner: "reward", writable: ["reward"], note: "成长积分；reward 层 load/syncState 时写入" },
      rank: { type: "any", owner: "reward", writable: ["reward"], note: "当前称号档位（RANKS 元素对象）" }
    },

    /* 运行时守卫的已知局限（写进契约，避免有人误以为它万能）：
     *   - 只能捕获 S.x = / S.x += 这类顶层赋值；
     *   - S.posts.push(x) 这类数组原地变更不可见，依靠长度快照提示；
     *   - 生产环境（bundle.js）默认不拦截，只在 ?stateaudit=1 时开启。 */
    limits: [
      "顶层赋值可精确捕获（含来源文件名与行号）",
      "数组原地变更只能靠长度快照发现，无法定位到具体层（静态审计已对 posts/cases 加方法黑名单兜底）",
      "对象深层字段（region.city）改动不触发，需显式走 YRB_STATE.set",
      "动态写法 S[k]=value 静态审计不可见（2026-10-29 审核记录）：合法用途必须先在 writable 里正名该层"
    ]
  };
  g.YRB_STATE_SCHEMA = schema;
  if (typeof module !== "undefined" && module.exports) module.exports = schema;
})(typeof globalThis !== "undefined" ? globalThis : this);
