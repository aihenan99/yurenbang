# 育人帮 · 架构与交接手册

> 目标读者：接手这个项目的工程师（也可能是三个月后的你自己）。
> 读完这份文档，你应该能：独立改一个功能、加一个新层、安全地发一版、出问题时知道去哪查。
> 最后更新：2026-10-27

---

## 0. 三分钟理解

育人帮是**一个网址、两半东西**：

| | 静态半边 | 动态半边 |
|---|---|---|
| 是什么 | HTML / CSS / JS / 图片 | 帖子、留言、案例、账号、上传的文件 |
| 放在哪 | Cloudflare Pages（项目 `yurenbang`） | WorkBuddy 云服务（数据库 + 存储 + 账号） |
| 怎么到达浏览器 | 直接下载文件 | 页面跑起来后用 `/yrbapi` 同源代理去取 |
| 谁付费 | 免费、不限流量 | 按资源点计费，按月刷新 |
| 坏了的表现 | 白屏 / 404 | 页面能打开，但**没有内容**，显示"系统维护中" |

> 2026-10 的停站事故就是右半边额度耗尽（`credits_exhausted`），左半边一直正常。
> 恢复步骤见根目录《恢复清单-额度刷新当天.html》。

**技术栈刻意保持极简**：没有框架、没有构建工具、没有 npm 依赖。
25 个脚本按固定顺序加载，全部挂在两个全局对象上。这是缺点也是优点——
优点是断网、弱网、老手机都能跑，改一行刷新就见效；缺点是规模上去后需要纪律。

---

## 1. 目录地图

```
E:\育人帮\
├── yurenbang-app\          ← 源码主体（改这里）
│   ├── yurenbang-app.html   主应用入口（26 个 script 按序加载）
│   ├── index.html           纯 SEO 落地页（不加载 app.js，爬虫读它）
│   ├── share.html           分享页（微信里打开的那一页）
│   ├── sw.js                Service Worker：离线缓存 + 弱网兜底
│   ├── anli\                静态案例库（搜索引擎的内容落点）
│   ├── seo\                 案例库的 markdown 源
│   └── assets\              25 个功能层 + 样式 + 图标 + gifts/vendor
│
├── deploy-cn\              ← 待部署包（产物，只有两个文件是源）
│   ├── _worker.js           ★ 源文件：边缘代理/限流/安全头/404，唯一副本
│   ├── error.html           ★ 源文件：404 页
│   └── 其余全部由 temp/sync_deploy.py 生成，不进版本库
│
├── tests\                  ← 测试脚本（161 个，按用途分五类）
│   ├── core\               8 个：门禁内，npm run verify:e2e 必跑
│   ├── scenario\           31 个：功能专项，改到相关功能时手动跑
│   ├── live\               12 个：直连生产，云隔离期禁跑
│   ├── diag\               103 个：一次性诊断探针，遇疑难时当参考
│   └── tools\              7 个：SDK 试验、截图、TTS 令牌生成
│
├── temp\                   ← 构建发布工具与素材（不是测试）
│   ├── release.py           发布：备份→校验→部署→自检→失败自动回滚
│   ├── sync_deploy.py       同步：源码→部署包 + 域名适配 + 打包 + 漂移检测
│   ├── pw\                  playwright 运行时（测试脚本按相对路径引用它）
│   └── ppt-test\ / *.sql    测试素材与数据库迁移
│
├── scripts\                ← 新增：工程化脚本
│   ├── verify.mjs           统一验证入口（npm run verify）
│   ├── state-audit.mjs      状态边界静态审计
│   └── worker-headers.mjs   真的调一次 Worker 核对安全响应头
│
├── .githooks\              ← 提交门禁（pre-commit / pre-push）
├── .github\workflows\      ← 远端兜底 CI
└── 迁移评估-*.md / 恢复后待办.md    决策文档
```

**判断一个文件该不该进版本库**：能由脚本重新生成的 → 不进；人写的、丢了就回不来的 → 必须进。
`_worker.js` 属于后者，它在 `deploy-cn/` 里但**不是产物**，`sync_deploy.py` 会改写它的案例库白名单。

---

## 2. 运行时：26 个脚本按序加载

顺序写在 `yurenbang-app.html` 末尾，**顺序本身就是依赖关系**：

| # | 层 | 职责 | 挂了会怎样 |
|---|---|---|---|
| 1 | `app.js` | 定义 `S`、页面骨架、信息流渲染、发布入口 | 全站白屏 |
| 2 | `state.schema.js` | 状态契约（谁能改哪个字段） | 仅守卫失效，功能正常 |
| 3 | `state.js` | 状态守卫（开发期越界检测） | 仅守卫失效 |
| 4 | `capture.js` | 拍照/录像/录音、媒体压缩 | 发布媒体不可用 |
| 5 | `refine23.js` | 信息流增强（排序、卡片细节、热度） | 列表少了增强效果 |
| 6 | `access.js` | 适老层：字号、长辈模式、侧边操作列、本地收藏 | 老年人体验退化 |
| 7 | `cloud.js` | **云服务唯一出口**（`YRB_CLOUD`） | 动态内容全失效 |
| 8 | `reward.js` | 积分、称号、玫瑰 | 激励不显示 |
| 9 | `jiaojiao.js` | 教学引导 | 引导不出 |
| 10 | `pptview.js` | PPT 在线翻页（pptx-preview 懒加载） | PPT 打不开 |
| 11 | `admin.js` | 后台（数据/案例/栏目管理） | 后台不可用 |
| 12 | `adminguard.js` | 后台第二道门（管理密码 bcrypt） | 后台无密码保护 |
| 13 | `gate.js` | 访问门槛：看免费，回帖/发布需登录 | 匿名可发布 |
| 14 | `license.js` | 未成年人保护公约 | 发布前无确认 |
| 15 | `profile.js` | 个人主页 | 个人页空 |
| 16 | `food.js` | 家常菜（独立小功能） | 该页不可用 |
| 17 | `account.js` | 自建账号体系（注册/登录/改密） | 登录不可用 |
| 18 | `chips.js` | 首页栏目配置（后台可改） | 栏目固定 |
| 19 | `rose.js` | 点赞送玫瑰给发布者 | 无赠礼 |
| 20 | `protect.js` | 内容保护（禁复制/下载/打印，管理员豁免） | 内容可被复制 |
| 21 | `mediafull.js` | 视频全屏、图片放大、**全文朗读**（`/yrbtts`） | 朗读失效 |
| 22 | `cover.js` | 案例封面（PPT 首页栅格化） | 封面缺省 |
| 23 | `casedit.js` | 图文案例编辑器（粘贴清洗、插图、发布） | 该发布方式不可用 |
| 24 | `longimg.js` | 分享长图（canvas 现生成，不落库；`YRB_LONGIMG`） | 长图分享入口消失 |
| 25 | `guard.js` | 全局异常兜底 | 异常不收敛 |
| 26 | `health.js` | 免疫系统：探针 + 自动补载 | 弱网缺层无人补救 |
| 27 | `upgrade.js` | 构建号一致性 + 新版本温和提示 | 用户可能长期跑旧缓存 |

### 三条铁律

1. **`cloud.js` 必须在 `refine23` 之后**：增强层里凡是读 `YRB_CLOUD` 的，都要**运行时**取，不能模块加载时缓存。
2. **`health.js` / `upgrade.js` 必须最后**：它们要能看到全部层才能探活。
3. **新增层要同时改四处**，漏一处就会在弱网里悄悄消失：
   - `yurenbang-app.html` 的 `<script>`
   - `sw.js` 的 `CORE` 清单（离线缓存）
   - `assets/health.js` 的 `LAYERS`（探针 + 自动补载）
   - `temp/sync_deploy.py` 的 `layers`（build.json 元信息）

   这四处由 `scripts/layers-audit.mjs` 自动比对（已并入 `npm run verify:fast`）：
   顺序不一致、漏登记、build.json 少声明、层体积超预算，都会直接红。
   `LAYERS` 的顺序必须与 html 的 `<script>` 顺序一致——自愈补载按这张表的顺序重来。

### 层的写法（照抄这个骨架）

```js
/* ===== xxx 层：一句话说清职责 ===== */
(function () {
  "use strict";
  var API = { ready: true };        /* 供 health 探针检测 */
  window.YRB_XXX = API;

  function boot() { /* 只做「注入 DOM + 事件委托」，不改别人的结构 */ }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
```

**定位是"增强"，不是"重写"**：只往页面里注入自己的块、只在 `document` 上挂委托监听。
不要去改 `app.js` / `refine23.js` 的内部结构——那是所有层的共同地基。

---

## 3. 层间只走三样东西

| 通道 | 用法 | 规矩 |
|---|---|---|
| **DOM** | `data-*` 属性 + 事件委托 | 唯一推荐的跨层交互方式 |
| **`window.YRB_*`** | 各层对外暴露的 API 对象 | 只能调公开方法，不许碰对方私有变量 |
| **全局状态 `S`** | 见下一节 | 有契约，受审计 |

> `S` 是脚本顶层的 `const`，是**词法全局**，不在 `window` 上。
> 所以 `window.S` 永远是 `undefined`——这是新人最常踩的坑。

---

## 4. 全局状态 `S`：谁能改哪个字段

**这是全项目最需要纪律的地方，也是"换人就不敢改"的根源。**

契约在 `assets/state.schema.js`，23 个字段逐个登记了 `type / owner / writable / note`。

### 四条规矩

1. **只许整体替换，不许原地改**
   ```js
   S.posts = [p, ...S.posts];          // ✅
   S.posts.unshift(p);                 // ❌ 其它层拿不到变更信号
   ```
2. **想写新字段，先在 schema 里登记**，否则 `npm run verify` 会失败。
3. **要放宽某层的写权限，改 `writable` 并说明理由**（写进提交信息）。
4. **对象深层字段**（如 `S.region.city`）走 `YRB_STATE.set("region", {...})`，
   直接赋值不会被拦截。

### 关键字段的所有权

| 字段 | owner（数据主人） | 其他可写者 | 说明 |
|---|---|---|---|
| `posts` | `cloud` | `refine23` `access` `app` | 云端拉取/增强/阅读标记/本地发布乐观插入 |
| `cases` | `cloud` | `app` `casedit` | 案例广场 |
| `growth` `msgs` | `cloud` | `app` | 成长记录、消息 |
| `fs` `elder` `history` `favIds` | `access` | — | 适老与本地偏好 |
| `funcs` `extra` `hotMode` | `app` | `chips` `refine23` | 首页栏目 |
| `points` `rank` | `reward` | — | 积分与称号（运行时挂到 S 上） |

### 两套检查

```bash
npm run audit:state     # 静态：扫全层写入，比对契约（0.2 秒）
```

浏览器里（开发环境自动开启）：
```js
YRB_STATE.report()      // 打印越界清单：哪个文件哪一行写了不该写的字段
YRB_STATE.set("lang", "en", "app")   // 显式写，来源可信
```

> 守卫**只记录不阻断**，永远不会让业务崩掉。
> 生产默认不装拦截，排查线上问题时加 `?stateaudit=1`。

**已知局限**（写进契约，别指望它万能）：数组原地 `push` 看不见（靠 3 秒一次的长度快照提示，但定位不到层）；对象深层字段不拦截。

---

## 5. 加一个新层：7 步

以"新增 `notice.js` 公告层"为例：

1. 写 `assets/notice.js` + `assets/notice.css`，用第 2 节的骨架，挂 `window.YRB_NOTICE`。
2. `yurenbang-app.html` 里按依赖顺序插 `<link>` 和 `<script>`（通常放在 `cover.js` 之后、`guard.js` 之前）。
3. `sw.js` 的 `CORE` 数组加两个路径。
4. `assets/health.js` 的 `LAYERS` 加一条探针。
5. `temp/sync_deploy.py` 的 `layers` 列表加名字（build.json 元信息）。
6. 跑 `npm run sync` → `npm run verify`。
7. 本地起服务看效果：`python -m http.server 8796 --directory yurenbang-app`，访问 `/yurenbang-app.html`。

> 不需要改 `_worker.js`：静态资源走 `allowed()` 白名单，`/assets/` 整段已放行。
> 只有**新增路由**（比如 `/api/xxx`）才要动 `_worker.js`。

---

## 6. 一条帖子的完整旅程

```
用户点「发布」
  └→ app.js: 收集文本/媒体 → S.posts = [p, ...S.posts]（乐观插入）
     → cloud.js: uploadItems()（压缩后的 Blob 上传到存储）→ 拿到签名 URL
     → cloud.js: database.from("yb_posts").insert(...)  ← 唯一落库点
     → 触发器 yb_comments_sync_helps 维护 helps 计数（客户端**不要**自己维护）
     → 刷新页面时：cloud.js loadPosts() → S.posts = [云端数据]
        → refine23.js 增强 → access.js 渲染（侧边操作列、字号）
        → health.js 发现某层没加载 → 自动补载
```

**读的路径**：`page.html` → `sw.js` 命中缓存就直接返回，未命中走网络 → `cloud.js` 用 `/yrbapi` 同源代理请求云服务（避免跨域和 SDK 域名变动）。

**发布案例（图文）的路径**：`casedit.js` 编辑器 → 粘贴白名单清洗 → 插图压缩（1280/q0.78）→ `cloud.js publishCase` 带 `content_html` → 落 `yb_cases`。查看时 `casedit.js` 接管渲染，正文走白名单过滤后输出，图片按 `data-yrb-media` 序号填签名地址。

---

## 7. 云服务接口面

| 类别 | 内容 |
|---|---|
| 数据表（8） | `yb_posts` `yb_comments` `yb_cases` `yb_profiles` `yb_gifts` `yb_settings` `yb_tutor_req` `yb_accounts` |
| RPC（5） | `yb_post_solve` `admin_verify_password` `admin_set_password` `admin_guard_status` `admin_set_setting` |
| 存储 | `upload` / `remove` / `createSignedUrl(s)` / `sharedPath` |
| 账号 | 手机号 OTP、密码登录、微信 OAuth 均由平台托管 |

**两条硬规矩**：

1. 只能用 `YRB_CLOUD.client.database.from()/rpc()`。
   `client.from()` 会**静默失败**（不报错、不返回数据），排查起来极耗时。
2. SDK 是异步加载的，**不要写 `if (!C.client) return`**。
   要么等 `yrb-cloud-ready` 事件，要么轮询。

---

## 8. 发布、同步、回滚

| 要做的事 | 命令 | 说明 |
|---|---|---|
| 源码 → 部署包 | `npm run sync` | 复制 + 域名适配 + 打包 + 构建号 + 白名单注入 |
| 只看不改 | `npm run sync:check` | 65 项约束校验 + 漂移检测 |
| 发布上线 | `npm run deploy` | 备份→校验→部署→线上自检→**失败自动回滚** |
| 本地预览 | `python -m http.server 8796 --directory yurenbang-app` | 源码直跑，改完刷新即可 |

**发布脚本会做什么**：先把 `deploy-cn` 备份成带时间戳的目录，再校验 65 项约束（域名、bundle、构建号一致性、层完整性…），然后上传，最后请求线上做自检；任何一步失败自动回滚到备份。

**四条禁令**：

- 不要手工 `cp` 到 `deploy-cn`——域名适配会被覆盖（历史上踩过 4 次）。
- 不要手工改 `deploy-cn` 里的产物文件，改源码再同步。
- 云服务停服期间**不要发版**（恢复前改代码可以，发版不行）。
- 大图片写 `yb_settings` 前必须压到 ≤200KB。

---

## 9. 测试与门禁

```bash
npm run verify:fast    # 0.4s  语法 + 状态边界 + 仓库卫生   （pre-commit 自动跑）
npm run verify         # 1.2s  + 部署一致性 + 漂移检测       （pre-push 自动跑）
npm run verify:e2e     # +30s  + 真实浏览器端到端            （需 8796 服务在跑）
```

**门禁怎么装**（clone 后只需一次）：

```bash
npm run hooks          # = git config core.hooksPath .githooks
```

**已有的验证资产**：`tests/` 下 161 个 Playwright 脚本（8 个进门禁、31 个专项、12 个线上、103 个诊断、7 个工具），覆盖发布、案例、后台、登录、TTS、PPT 等流程。它们是踩坑记录，不是摆设——改相关功能时先跑一遍对应的脚本。

**两个易错点**：

- 测试上下文要 `serviceWorkers: "block"`，否则 SW 缓存会让你测到旧代码。
- 云端隔离期，端到端用例会因 402 + 登录门禁失败，那是环境问题不是回归。

---

## 10. 安全模型

| 层次 | 措施 | 位置 |
|---|---|---|
| 数据库 | RLS：`yb_cases` 全员可读 / 仅作者可插 / 管理员或作者可删 | 云端 |
| 后台 | 两道门：登录态 + 管理密码（bcrypt） | `admin.js` + `adminguard.js` |
| 访问 | 看内容免费；回帖/发布/回应需登录 | `gate.js` |
| XSS | 用户内容进 `innerHTML` 前必须过 `esc()`；富文本走白名单清洗 | 全项目 |
| 响应头 | nosniff / DENY / Referrer / Permissions / **CSP（Report-Only）** / HSTS | `_worker.js` |
| 限流 | `/yrbtts` 20 次/分、`/yrbapi` 120 次/分（每实例） | `_worker.js` |

**CSP 现状**：观测模式，不阻断。确认一周控制台无违规后，把 `_worker.js` 里
`CSP_HEADER` 的值改成 `"content-security-policy"` 即转强制模式（只改一个字符串）。

**别忘了**：`protect.css` 里 video 必须保持 `pointer-events: auto`，否则原生播放控件失效（已踩过）。

---

## 11. 故障排查

| 症状 | 先查什么 | 常见原因 |
|---|---|---|
| 页面能开但没内容 | `/yrbapi` 返回码；`billingStatus` | 云额度耗尽/数据库隔离 → 见恢复清单 |
| 白屏 | 控制台第一个报错；`build.json` 能否访问 | 某层语法错误 / 部署包不完整 |
| 改了代码没生效 | `npm run sync:check` 看漂移 | 忘了同步 deploy-cn |
| 弱网下某功能消失 | `YRB_HEALTH.sweep()` 的输出 | 该层没进 sw.js CORE 或 health LAYERS |
| 用户长期看到旧版 | `build.json` 的 build 与页面 meta 是否一致 | 缓存未更新 / SW 未放行 |
| 后台上不去 | `YRB_CONSOLE.isAdmin()`；`yb_admin_guard` 表 | 管理员未登录 / 管理密码丢了（删表重设） |
| 发布按钮一直转 | 网络面板 `/yrbapi` 请求 | 云端超时（已有 8 秒兜底） |
| 视频点不动 | `protect.css` 的 video 规则 | pointer-events 被覆盖 |

---

## 12. 已知技术债（按该修的顺序）

| # | 债 | 影响 | 建议时机 |
|---|---|---|---|
| 1 | 27 个脚本靠加载顺序维系，顺序错了静默失效 | 加层容易漏改四处 | **已闭环**：`scripts/layers-audit.mjs` 自动比对四处 + 顺序 + 体积预算 |
| 2 | `S` 仍是共享可变对象 | 深层写与数组原地改仍需靠人守纪律 | 新代码一律走 `YRB_STATE.set`，逐步收 |
| 3 | 125 处 `innerHTML` 拼字符串 | 漏一处 `esc()` 就是 XSS | CSP 转强制后可显著降低风险 |
| 4 | 测试有 180+ 个但缺统一命名与断言规范 | 新人不知道跑哪个 | 已在 `verify` 收了口，逐步把关键用例迁进去 |
| 5 | 无 TypeScript / 无构建 | 重构缺静态保障 | **不建议现在上**，0 真实用户时是纯浪费 |
| 6 | 云服务绑定平台账号体系 | 迁移成本高（短信资质、微信认证） | 见《迁移评估-Cloudflare-D1R2.md》 |

---

## 13. 交接清单：第一周做什么

**第 1 天：能跑起来**

- [ ] `npm run hooks` 装门禁
- [ ] `python -m http.server 8796 --directory yurenbang-app`，打开 `/yurenbang-app.html`
- [ ] 打开控制台，确认看到 `[状态边界] 守卫已启用 · 已接管 N 个字段`
- [ ] `npm run verify` 全绿

**第 2–3 天：能读懂一条链路**

- [ ] 跟着第 6 节，从"发布一条帖子"读到"它出现在信息流"
- [ ] 在 `cloud.js` 里找到 `loadPosts`，看它怎么用 `/yrbapi`
- [ ] 用 `YRB_STATE.report()` 看一次越界报告（可故意写一行 `S.lang = 1` 试试）

**第 4–5 天：能安全改一处**

- [ ] 改一个文案 → `npm run sync` → 本地刷新确认
- [ ] 跑 `npm run verify`，确认没引入漂移
- [ ] 读《恢复清单-额度刷新当天.html》，知道云服务恢复时该做什么

**永远不要做的事**

- 不要手工改 `deploy-cn` 里的产物文件
- 不要在云服务停服期间发版
- 不要为了"看起来更现代"引入框架重写——这套代码的价值在于极简和可预测
- 不要在没有备份的情况下动数据库结构（迁移 SQL 都放在 `temp/*.sql`）
