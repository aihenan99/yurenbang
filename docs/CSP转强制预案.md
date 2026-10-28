# CSP 转强制预案

> 对应《工程总纲.md》M2（安全加固）。**本文只做方案，不含任何生产代码改动**——
> 云恢复前不发版、不动 `deploy-cn/_worker.js`。恢复后按本文顺序执行。

---

## 一、现状（2026-10-28 实测）

| 项 | 值 |
|----|-----|
| 头部模式 | `content-security-policy-report-only`（只报不拦） |
| 策略 | 13 条指令：`default-src 'self'`；`script-src 'self' 'unsafe-inline' 'unsafe-eval'`；`style-src 'self' 'unsafe-inline'`；`img/media-src 'self' data: blob: https:`；`object-src 'none'`；`frame-ancestors 'none'` |
| 校验手段 | `node scripts/worker-headers.mjs`（真调 Worker 核对 13 项响应头，当前全绿） |
| 切换开关 | `CSP_HEADER` 一个常量（第 292 行），改字符串即强制 |

### 真实违规面盘点（决定收紧难度）

| 攻击面 | 数量 | 结论 |
|--------|------|------|
| 内联事件属性（`onclick=` 等） | **0** | 好消息：不需要为事件属性做 hash |
| 内联 `<script>` 块 | 3（自愈兜底、启动屏自救、基础引导） | 需 hash 或外置 |
| 内联 `style="..."` 属性 | 6 | `style-src` 保留 `'unsafe-inline'` 更稳妥（见下） |
| JSON-LD | 1 | `type="application/ld+json"` 不执行，不受 `script-src` 限制 |
| `eval` / `new Function` | 仅 `vendor/jszip.min.js`、`vendor/pptx-preview.umd.js` | PPT 引擎硬需求，短期不能去 |
| 外部资源域 | 0（`workbuddy.host` 只出现在文案/URL 里，`schema.org` 只是 JSON-LD 的 @context） | 无需放宽任何白名单 |

## 二、为什么要分阶段，而不是直接改一个字符串

转强制后违规**静默失败**——脚本被拦不报错给用户，只表现为"某功能没反应"。站内 27 层是叠加式，
一旦某层被拦，老年人只会觉得"点了没用"，排查成本极高。所以策略是：**先看真实违规，再按页面危险度从低到高逐块强制**。

## 三、四阶段执行

### P0 固化现状（已完成，本地可做）
- ✅ 策略写好、Report-Only 上线代码就位、13 项响应头有自动校验
- ✅ 本文档即基线记录

### P1 观察（恢复发版后第 1 周）
1. 发版后确认响应头存在：`node scripts/worker-headers.mjs`
2. 自用机（安卓 Chrome + iPhone Safari + 微信内置）各走一遍主流程：
   首页浏览 → 查看详情 → 点赞/收藏 → 朗读 → 发图文 → PPT 查看 → 分享长图 → 案例广场
3. 每台设备开一次控制台，搜索 `Content Security Policy`，把违规原文记到 `.workbuddy/memory/`
4. **判据**：连续 7 天零违规，且没有用户反馈"功能没反应"
5. 不做 report-uri 端点收集——省一个攻击面，人工观察已足够（用户量小）

### P2 收紧策略（不转强制，仍 Report-Only）
按"改动小 → 收益大"的顺序，**每步单独发版、观察 2 天**：

| 步骤 | 改什么 | 怎么改 | 风险 |
|------|--------|--------|------|
| 2.1 | `script-src` 去 `'unsafe-inline'` | 3 段内联脚本外置为小文件（自愈脚本必须保留 fail-safe 语义：外置后失败要能重试）；或由 `sync_deploy.py` 计算 SHA-256 写入 `'sha256-...'` | 中：自愈脚本失效会导致弱网无法补载 |
| 2.2 | 增加 `'strict-dynamic'` | 配合 2.1，允许脚本动态插入的脚本执行（health 自动补载依赖此能力） | 中 |
| 2.3 | `script-src` 保留 `'unsafe-eval'` | **不去**：PPT 引擎需要，删除即 PPT 打不开；在注释里写明原因 | 低（维持现状） |
| 2.4 | `style-src` 保留 `'unsafe-inline'` | **不去**：6 处内联 style + 各层大量 `style.cssText`（CSSOM 写入虽多不被拦，但 setAttribute 会被拦） | 低（维持现状） |
| 2.5 | `img/media-src` 收紧 `https:` | 改为云端存储具体域名 + `https://*.workbuddy.host`？——**暂不做**，签名地址域名随平台可能变化，收紧即断图 | 高，不建议 |

结论：真正要动的只有 2.1 + 2.2（内联脚本外置/哈希 + strict-dynamic）。

### P3 分路径强制（关键设计）

`secure()` 目前无路径参数，但资产响应只有一个调用点（`_worker.js` 第 396 行），改造量极小：

```js
// 恢复后实施（示例，非当前代码）
const CSP_ENFORCE = new Set(["/anli/", "/share.html"]);   // 逐批加入
function cspHeaderFor(path) {
  return CSP_ENFORCE.has(path) ? "content-security-policy" : "content-security-policy-report-only";
}
```

强制顺序（危险度从低到高）：

1. **静态案例库 `/anli/*`** —— 纯静态页、无交互、无 PPT，坏了不影响使用 → 观察 3 天
2. **分享落地页 `/share.html`** —— 只有一个二维码与复制按钮 → 观察 3 天
3. **首页 `/`** —— 全功能，风险最高 → 观察 7 天
4. **全站** —— 把 `CSP_HEADER` 常量改为强制，删除分路径逻辑（收敛回一个字符串）

### P4 回滚

- 触发条件：任一页面出现"点了没反应"且控制台有 CSP 违规
- 回滚动作：`CSP_HEADER` 改回 `content-security-policy-report-only` → `npm run sync` → `npm run deploy`（release.py 自带校验与自动回滚）
- 预期耗时：约 1 分钟；无数据影响

## 四、验收标准（M2 完成定义）

1. `node scripts/worker-headers.mjs` 13 项全绿，且报告的头名为 `content-security-policy`
2. `script-src` 不含 `'unsafe-inline'`（含 hash 或 nonce 或 strict-dynamic）
3. 全流程走查零违规：首页/详情/发布图文/PPT/长图/案例库
4. 一周内无"功能没反应"类反馈
5. 回滚开关仍是一个常量（不引入配置系统）

## 五、明确不做的事

- ❌ 不引入 `report-uri` 收集端点（新增公开写入面，收益不抵风险）
- ❌ 不给 HSTS 加 `includeSubDomains` / `preload`（难回退）
- ❌ 不为 `style-src` 去 `'unsafe-inline'`（改造成本远大于收益）
- ❌ 不在云恢复前改 `_worker.js`（冻结期铁律）
