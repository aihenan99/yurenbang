# 育人帮 · 项目长期笔记（精简版，细节看 .workbuddy/memory/2026-10-*.md 日志）

## 项目概况
- 家长互助社区移动端（Cloudflare Pages 生产站 https://xn--gmqq09al6z.cn/），源码 `yurenbang-app/`，部署包 `deploy-cn/`
- 三层核心：app.js（核心，顶层 const S 是**词法全局非 window.S**）→ refine23.js（IIFE 私有）→ access.js（适老层）；CSS 同层对应
- 加载序：app→capture→refine23→access→cloud→reward→jiaojiao→admin→adminguard→gate→license→profile→food→account→chips→rose→protect→mediafull→cover→pptview→health→upgrade（health/upgrade 必须最后）
- 20 层均接 health.js 探针 + sw.js CORE + sync_deploy 校验三件套

## ⚠️ 铁律（违反即翻车）
1. `YRB_CLOUD.client.database.from()/rpc()`——`client.from()` 会静默失败；SDK 异步加载，禁止 `if(!C.client) return`，要等 `yrb-cloud-ready` 或轮询
2. cloud.js 在 refine23 之后加载：任何层读 YRB_CLOUD 必须**运行时**取
3. protect.css 的 video 保持 `pointer-events:auto`（否则原生控件失效）
4. `#modal` z-index 96 最高，新全屏层不得超
5. 浮层显隐统一 `.open`/.show；#cmList 锁面板只能插兄弟节点（防 observer 死循环）
6. 发布唯一入口：后台跑 `python temp/release.py`（备份→校验→部署→自检→自动回滚）；同步用 `temp/sync_deploy.py`，勿手动 cp
7. 增强层只注入+委托，不改 app.js/refine23 结构；用户文本进 innerHTML 前过 esc()
8. yb_posts.helps 由触发器 yb_comments_sync_helps 维护，客户端勿自行维护
9. 平台会话/JWT 无手机号（auth.users.phone_number 列）；SECURITY DEFINER 判登录查 auth.users 实存（anon uid 非 NULL）；设密走 /v1/.cloud/auth/v1/reset

## 关键机制速记
- **TTS**：全部朗读走 `/yrbtts`（_worker.js Edge TTS 代理，zh-CN-YunyangNeural；Sec-MS-GEC v2 令牌 JS 移植在 temp/edge-tts-v2.js）。workerd 三坑：出站 WS 用 fetch(https,…,{headers:{Upgrade:"websocket"}}) 取 resp.webSocket；101 时 ok=false；ws.accept() 后无 open 事件、消息立即发。分 ≤180 字链式播，测试替身要异步触发 onend
- **PPT**：pptx-preview 引擎懒加载（vendor/）；渲染产物是**内联 SVG**（thumb 需栅格化）；pagesFor 解 ppt/slides/slideN.xml `<a:t>` 读全文；测试必须用 temp/ppt-test/sample_fixed.pptx 真实文件（合成 pptx 引擎不认）
- **卡片**：access.js 建幂等 .p-side（♥/⭐/🔊 右侧竖排，垂直居中）；卡片头部小字淡化、底部操作行单行紧凑（access.css「卡片侧边操作列」区块）；真实视频 .m-realvideo 通栏（cloud.css）。点赞点击触发 renderFeed 整卡重建，测试须重查询
- **案例广场**：yb_cases RLS=SELECT 全员 / INSERT 作者 / DELETE 管理员(is_admin())或作者本人；后台「🎬 案例管理」页签删除（YRB_CLOUD.deleteCase 删行+storage.remove 清素材）；PPT 封面 cover.js；应用内入口链接静态案例库 anli/（temp/gen_seo_anli.py 生成）
- **后台**：两道门（登录+管理密码 yb_admin_guard/bcrypt）；admin.js 全 IIFE 私有，测试经 YRB_CONSOLE.openAdmin()，桩需 signedIn/who；忘记管理密码 `DELETE FROM public.yb_admin_guard WHERE id=1` 重设；大图片写 yb_settings 必须压 ≤200KB
- **访问门槛 gate.js**：看内容免费；看留言/发布/帮忙回应需登录；新回应类入口要补 gate()
- **弱网**：sw.js v3 导航请求才回落 HTML；bundle.css/js 打包；自愈内联脚本补载缺层
- 「首页＋添加按钮」「PPT 打开文件」等管理能力仅 YRB_CONSOLE.isAdmin() 可见
- **种子假数据已全量下线（2026-10-25）**：S.posts/cases/growth/msgs 为空数组，信息流/案例只显示云端真实数据；autoHelp 模拟帮忙已删除；测试一律自注桩帖（9101/9102/9401/9501/990001），勿再依赖种子内容；meStats/roses/badge 均真实起步

## 工程化基线（2026-10-27 建立，交接必读）
- git：`main` 分支，基线 tag `v0.1.0-baseline`；`deploy-cn` **只跟踪 `_worker.js` + `error.html`**（人工源文件，其余是 sync 产物）
- 一条命令验证：`npm run verify`（默认含部署一致性；`--fast` 0.6s；`--e2e` 加浏览器）；门禁已装 `.githooks`（pre-commit=fast、pre-push=标准），换机器后跑 `npm run hooks`
- 状态边界：`assets/state.schema.js` 契约（25 字段 owner/writable）+ `assets/state.js` 守卫（dev 拦截并记录来源行号，生产零开销，线上加 `?stateaudit=1` 可开）+ `scripts/state-audit.mjs` 静态审计。**改 S 之前先看契约**
- 加载序新增两层：app → **state.schema → state** → capture …（必须在 app 之后、其它层之前）
- 安全头：`_worker.js` 的 `secure()` 已含 CSP（当前 **Report-Only**，转强制只改 `CSP_HEADER` 一个字符串）+ HSTS 180 天；改完必跑 `node scripts/worker-headers.mjs` 实测
- 交接文档：`ARCHITECTURE.md`。加新层要同时改四处：html 的 script / sw.js 的 CORE / health.js 的 LAYERS / sync_deploy.py 的 layers
- `sync_deploy.py` 的 ROOT 已改为按脚本位置推导（不再硬编码 E:\育人帮），并新增漂移检测

## 域名与部署
- 育人帮.cn→CF Pages 项目 yurenbang（_worker.js 高级模式）；/yrbapi 同源代理云端（SDK 版本锁定 0.1.4-dev.ca27990）；/api 被占勿改；育人帮.com 301→.cn；部署必须 run_in_background
- 本地测试服务：8794（--directory deploy-cn）与 8793（项目根，测试走 /deploy-cn/）；测试上下文 serviceWorkers:'block'

## 2026-10 云额度事件与后续路线
- 10-26 起云服务 credits_exhausted、DB 隔离（402）；数据保留 15 天；11-01 09:30 自动复查、每月 3/20 体检两个 automation 已挂
- 路线：先观察不迁（报告=根目录《迁移评估-Cloudflare-D1R2.md》，结论：D1+R2 可行约 3 周、账号体系是最大障碍、数据导不出前不动）；恢复后按根目录《恢复后待办.md》四步走（观察期→PPT 三选一→分享长图→迁移决策）；恢复当天操作看《恢复清单-额度刷新当天.html》（电子勾选版，localStorage 存档）
- 产品决策已定：PPT 功能暂保留待数据；站内永远纯文字（TTS/SEO/省流量），仅微信分享场景用 canvas 现生成长图（不落库不占存储）

## 用户偏好
- 虚拟环境 .venv；中间文件 temp/ 或 .cache/；**未经明确同意禁止删除/移动/重命名任何文件**
- 关键词：严谨、可行、科学、便利、老年人可用；界面要求清爽不拥挤、内容只许看不许下载、管理功能仅管理员可见
- 激励体系：四维称号（玫瑰/帮忙/连续到访/语音视频）各 5 级
