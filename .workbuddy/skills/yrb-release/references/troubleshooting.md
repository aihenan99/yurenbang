# 育人帮 · 发布与线上疑难排查手册

发布流程本身看上一级 `SKILL.md`。这里只记「已经踩过的坑」和对应处置方式，遇到疑难先按这里对号入座，不要从零开始猜。

## 一、发布链路

### 1. 部署完立刻检查，构建号还是旧的 → 误判为失败
Cloudflare 上传成功 ≠ 全球边缘已切换。`release.py` 的 `wait_for_build()` 会轮询 `build.json` 最多 150 秒。
**处置**：不要重复部署。先 `--check` 只体检；超过 5 分钟仍是旧号，再考虑重新部署。

### 2. 部署失败（退出码非 0）
头号原因：wrangler OAuth 过期。
**处置**：跑一次
```
node C:/Users/a/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js whoami
```
触发刷新后重试。网络抖动重试 1~2 次即可。

### 3. 手动把主应用文件 cp 到 deploy-cn，线上就断了
`deploy-cn` 里有几处必须指向 `.cn` 的内容，直接复制会被主应用的 `workbuddy.host` 覆盖，历史上踩过 4 次：
- `assets/cloud.js` 的 endpoint 必须是 `https://xn--gmqq09al6z.cn/yrbapi`
- `assets/admin.js` 的 `APP_URL`、`assets/capture.js` 的 `LIVE_URL`
- `_worker.js` 的代理白名单
**处置**：永远用 `temp/sync_deploy.py`（它会复制后再重写并断言）。已发生覆盖时，重跑同步即可修复。

### 4. /x.html 被 308 到 /x
CF Pages 的 clean URL 行为。canonical、sitemap、内链统一用无扩展名形式，否则自检里会出现跳转告警。

### 5. 图片换了线上还是旧的
CF 边缘缓存 4 小时。**图片不能靠文件内容更新来生效，必须改引用 URL**，加 `?v=2` 之类版本戳即刻穿透。
同步脚本会自动给 index.html 里的引用加 `?v=mtime` 戳，但手写在 JS 字符串里的图片路径（如 admin.js 分享面板）需要自己加。

### 6. wrangler 部署后 functions/ 目录没生效
wrangler 会静默忽略中文路径下的 `functions/`。必须用根目录 `_worker.js` 高级模式，日志里要看到 `Compiled Worker successfully`。

### 7. `/api/*` 返回别人的响应
zone 里有旧 Trae 残留 Worker 占用 `/api/*`。代理前缀固定用 `/yrbapi`，不要改。

### 8. curl 访问 .cn 资源返回 403
CF bot 防护会拦非浏览器 UA。所有验证请求都要带 `User-Agent: Mozilla/5.0 ...`。

## 二、PWA / 安装

### 9. 微信里扫码「生成 APP」失效 / 无法安装
`manifest.webmanifest` 的 `start_url` 必须指向真实存在的页面。部署包主页是 `index.html`（不是 `yurenbang-app.html`），写成后者会 404 → 不可安装。
`sw.js` 的 `CORE` 缓存列表与导航回落也必须统一用 `/`，否则离线打开 504。
**当前版本**：`start_url=/?source=pwa`、`yrb-cache-v4`、install 不自动 skipWaiting，靠页面 `postMessage` 触发更新。

### 10. 升级提示不出现
构建号必须四处一致：页面 `<meta name="yrb-build">`、bundle 头 `YRB_BUILD`、`build.json`、资源引用 `?v=`。
只改一处，升级层会判定"没更新"。

## 三、登录与账号

### 11. 输入验证码仍提示"请先获取该手机号的验证码"
`pendingOtp`（verificationId）原先只存内存，弱网自愈、启动屏自救、SW 升级、切后台都会刷新丢失。
**已修**：存 `sessionStorage` 的 `ybp_otp_v1`，TTL 10 分钟，`openLogin` 自动回填手机号。

### 12. 匿名请求里 `auth.uid()` 返回字符串 `'anon'` 而不是 NULL
平台特性。任何"是否登录"的判断写 `if auth.uid() is null` 都是形同虚设，匿名也能写库（曾真的写进一条脏数据）。
**正确做法**：必须校验该 uid 在 `auth.users` 中真实存在。

### 13. 外部写 bcrypt 到 `auth.users.password` 无效
平台有自己的密码格式，直写会得到 `invalid_username_or_password`。
设/改密只能走：`signUp` 带 password，或 `/.cloud/auth/v1/reset` 传 `{phone_number, new_password, verification_token}`。

### 14. auth 请求 401 / 「session is invalid, expired or issued for another client」
- 端点前缀是 `/.cloud/auth`，不是 `/auth`
- 认证请求头是 `x-wb-webapp-access-key`，不是 `apikey`
- 该报错族是云服务令牌交换被拒，头号嫌疑是 `.cn` 代理三次请求出口 IP 不一致；已做中文引导 + 自动重试

## 四、云 SDK

### 15. `client.from is not a function`，而且被 try/catch 静默吞掉
必须写 `YRB_CLOUD.client.database.from(...)` / `.database.rpc(...)`。写成 `client.from(...)` 会报错且不显眼——曾导致证照、资料、礼物、二维码云端全部不通。

### 16. 脚本启动时 `YRB_CLOUD.client` 是 null
SDK 异步加载。禁止 `if (!C.client) return;` 一走了之，要监听 `yrb-cloud-ready` 事件或轮询重试。
另外 `cloud.js` 在 `refine23.js` 之后加载，任何层读 `window.YRB_CLOUD` 都必须在**运行时**取值，不能在脚本顶层取。

### 17. 测试里 mock 接口不生效
Service Worker 接管了 fetch，绕过了 `page.route`。测试上下文必须加 `serviceWorkers: 'block'`。

## 五、免疫系统 / 自检

### 18. 健康探针把功能层拉了两遍
对 `degraded` 状态重拉脚本会导致二次初始化。探针必须区分三态：`ok` / `degraded`（脚本在但 DOM 被覆盖 → 只原地重建，绝不重拉）/ `missing`（才补载，带 `?heal=ts` 且退避 4 轮）。

### 19. 生产自检报"全部功能层健康"失败并点名某个层
说明该层的 `YRB_*` 标记没出现。按顺序查：脚本 404？初始化抛错？被后续层覆盖了 DOM？
新增功能层时**必须**在 `assets/health.js` 的 `LAYERS` 里登记，否则自检根本不覆盖它。

### 20. 自检偶发单次失败
浏览器缓存与边缘未完全一致会造成抖动。`release.py` 内置 10 秒后复检一次；连续两次失败才判不健康。
