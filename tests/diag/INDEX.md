# tests/diag/ —— 诊断探针索引（85 个 + sdk-debug/）

> **用途**：疑难排查时的**参考手册**，不进门禁。遇到问题先查 `scenario/`、`core/` 的正式测试；
> 这里多数探针是历史上定位某个具体 bug 时写的，保留下来当"病历本"翻。
>
> **注意**：
> 1. 大部分探针内嵌的是**旧端口**（8791/8765/8766/8794 等，均已停用）。跑之前改文件内 BASE，
>    支持 `YRB_BASE` 环境变量的优先用它。现行端口：8796（源码）/ 8793（项目根，走 /deploy-cn/）。
> 2. 凡文件名带 `-live` / 目标是生产域的，**云隔离期禁跑**（同 `live/` 规矩），且多数是只读探针。
> 3. 一句话说明：有注释的照抄注释；无注释的按代码推断整理（2026-10-29），**以代码为准**。
> 4. 浏览器探针统一用 `temp/pw` 里的 playwright-core + 本机 Chrome，无头跑。

## A. 管理后台与权限

| 文件 | 类型 | 说明 |
|------|------|------|
| admin_jj_check.js | 浏览器 | 家教登记页签 + 扫码卡二维码上传更换 集成测试（桩 YRB_CLOUD：页签切换/名单渲染/删除复制/二维码上传→rpc→换新/长辈模式） |
| admin_login_check.js | 浏览器 | 后台登录/权限回归。核心：桩会话必须与真实 parseSession() 结构一致 {id,name,avatarUrl,isAnonymous,raw}，**不含 phone**（线上管理员误判的根源） |
| admin_visibility_check.js | 浏览器 | 后台入口显隐四态回归：未登录/普通账号看不到，管理员自动出现，退出即消失 |
| adminguard_check.js | 浏览器 | 管理密码二次验证集成（入口拦截/首次设置/弱密码拦截/错 5 次锁 5 分钟/TTL） |
| probe_ad_state.js | 浏览器 | 注入管理员会话（sessionStorage yrb_admin_unlock_at）诊断后台状态，打印 from() 读的表名 |
| probe_rpc.js | 浏览器 | RPC admin_set_setting 匿名可达性：应返回 42501（权限）而非 404（不存在） |

## B. 登录、门槛与资料

| 文件 | 类型 | 说明 |
|------|------|------|
| gate_check.js | 浏览器 | 访问门槛：浏览免费/发布与帮忙需登录。桩 YRB_CLOUD 验 ensureLogin 拦截与原动作重放 |
| gate_lock_check.js | 浏览器 | 「帮忙留言需登录才可看」真锁版：未登录连数据都拿不到（RLS），前端只显示条数 |
| check_locked.js | 浏览器 | 未登录点受限操作应弹登录层（#loginSheet.open） |
| me_guest_check.js | 浏览器 | 未登录「我的」页状态（等 cloud boot 与 profile.apply 跑完再查） |
| verify_agree.js | 浏览器 | 登录面板「已阅读并同意协议」勾选（桩 SDK，绝不真发短信） |
| otp_live_check.js | 浏览器 | 线上登录流程验收（.cn → 登录面板 → 获取验证码） |
| profile_check.js | 浏览器 | 个人资料编辑自检：入口/保存/持久化/作者名联动/长辈模式 |
| license_check.js | 浏览器 | 资质证照/用户协议 入口与展示自检 |

## C. 发布与上传链路

| 文件 | 类型 | 说明 |
|------|------|------|
| pub-probe.js | 浏览器 | 复现「+ → 图片/微视频/语音 → 上传」链路 |
| pub_media_check.js | 浏览器 | 媒体区回归：拍照/相册只在点选类型后出现；切类型/关面板立即暂停并清空播放器 |
| pub_toast_check.js | 浏览器 | 发布确认 toast 与确认行（#toast / #r23Confirm） |
| case_upload_check.js | 浏览器 | 复现「上传案例卡住」：模拟输入标题+选微视频+点发布 |
| case_mobile_probe.js | 浏览器 | 移动端触摸点按+逐字输入+长任务监测，定位上传案例面板卡顿 |
| cu-probe.js | 浏览器 | 案例广场上传全链路探针（本地 deploy-cn） |
| cu-types-probe.js | 浏览器 | PPT/视频类型经 label 选取 |
| verify_timeout.js | 浏览器 | 上传超时遮罩与关闭（#upMask/#upX/.up-note） |
| qr_shrink_check.js | 浏览器 | 图片压缩自检：三类样本（截图风噪点 PNG/纯二维码 PNG/照片风 JPEG） |
| stress_probe.js | 浏览器 | 压力测试：一次选 9 张 4032×3024 大图（模拟手机原图），量化压缩阻塞 |
| perf_probe.js | 浏览器 | 诊断：点 + 打开发布面板/选图上传的主线程卡顿 |
| solve_freeze_probe.js | 浏览器 | 复现「标记求助已解决」卡死：注入我的求助→详情→标记→确认 |

## D. 案例广场与 PPT/封面

| 文件 | 类型 | 说明 |
|------|------|------|
| case_open_check.js | 浏览器 | 逐类型点击案例卡片，检查打开行为与报错 |
| cover-live.js | 浏览器 | 线上验收：封面层在线 + 案例网格封面形态（生产域，云隔离期禁跑） |
| ppt-live.js | 浏览器 | 线上验收：PPT 全屏阅读（生产域，云隔离期禁跑） |

## E. 帮忙、答谢与激励

| 文件 | 类型 | 说明 |
|------|------|------|
| helper_card_check.js | 浏览器 | 帮忙者名片 + 送美食/送玫瑰 + 压缩 Worker 自检 |
| food_check.js | 浏览器 | 美食答谢自检：面板/满屏动画/收件箱/按钮接线/长辈模式 |
| food_where_check.js | 浏览器 | 「答谢大餐」按钮位置：详情页帮忙条目上（造一条有两位家长帮忙的求助再查） |
| thank_entry_check.js | 浏览器 | 答谢入口接线检查（data-act 按钮） |
| reward_titles_check.js | 浏览器 | 四维称号 + 欢迎玫瑰/掌声专项（四维格渲染/官爵连续到访/欢迎玫瑰层/长辈模式） |
| rose-live.js | 浏览器 | 线上验收：真实站点点赞是否送玫瑰（生产域，云隔离期禁跑） |

## F. 家教栏目

| 文件 | 类型 | 说明 |
|------|------|------|
| jiaojiao_check.js | 浏览器 | 家教栏目+需求登记专项：栏目入口/登记页结构/必填校验/登录门槛/云端入库/长辈模式 |
| jiaojiao_entry_check.js | 浏览器 | 家教入口 chip 渲染、点击后进入 #page-jiaojiao |
| jiaojiao_funcrow_diag.js | 浏览器 | 诊断 #funcrow 实际渲染状态、chip 是否被后续渲染覆盖 |
| probe_jj_elder.js | 浏览器 | 家教页长辈模式选项（.jj-opt）检查 |
| probe_qr.js | 浏览器 | 云端 jiaojiao_qr 有值后，家教页是否真换成新二维码（生产域） |

## G. 媒体、语音与摄像头权限

| 文件 | 类型 | 说明 |
|------|------|------|
| media_check.js | 浏览器 | 媒体清理 + 语音转文字防卡死自检 |
| mediafull-live.js | 浏览器 | 线上验收：视频全屏按钮/朗读按钮/案例图片放大（生产域，云隔离期禁跑） |
| probe_media.js | 浏览器 | headless 环境下 getUserMedia 是否可用 |
| probe_iframe.js | 浏览器 | 顶层窗口 vs 嵌入 iframe（无 allow 属性）：摄像头提示与应用自身提示 |
| verify_frame.js | 浏览器 | iframe 场景摄像头权限指引（.cap-help 系） |
| verify_media.js | 浏览器 | 切「微视频」后摄像头提示链路 |
| verify_cm.js | 浏览器 | 帮忙面板录语音（#cmCap → data-cap-aud） |
| probe_cm.js | 浏览器 | 帮忙面板 #cmVoice 点击前后状态 |
| check_live.js | 浏览器 | 线上顶层窗口摄像头权限询问态 → 点击后应出权限指引（.cap-warn） |
| edge-tts-probe.js | Node | Edge 神经语音 wss 直连 + Sec-MS-GEC 令牌算法验证（Worker 内复用同逻辑；variant: 180/300/both） |

## H. 内容保护与弹窗自愈

| 文件 | 类型 | 说明 |
|------|------|------|
| protect-hit.js | 浏览器 | img 被 pointer-events:none 后点击是否穿透到父容器（详情页看大图依赖此行为） |
| protect-live.js | 浏览器 | 线上验收：内容保护层是否真的在生效（生产域，云隔离期禁跑） |
| modal_selfheal_check.js | 浏览器 | 详情弹窗（[data-r23detail]）与「已解决」按钮（.r23-solve）自愈 |

## I. 闪屏与首页渲染

| 文件 | 类型 | 说明 |
|------|------|------|
| splash-rescue2.js | 浏览器 | 闪屏自救刷新 + 60s 防循环（连点仍进不去的场景） |
| check_render.js | 浏览器 | 首页基础渲染冒烟（#phone/#fab） |
| diag.js | 浏览器 | 首页控制台错误收集（PAGEERROR/CONSOLE-ERR/REQFAIL + #feed） |
| tab_check.js | 浏览器 | 底部页签切换（.tb-item[data-p] → #page-friends/#page-me） |
| wx_check.js | 浏览器 | 顶栏天气组件诊断（.wx/#wxI/#wxC、#topbar 高度；截图 temp/no_weather.png） |

## J. SEO 与分享

| 文件 | 类型 | 说明 |
|------|------|------|
| seo-check.js | 浏览器 | 无 JS 视角（模拟爬虫）：静态案例库 anli/ 内容必须可见 |
| seo_check.js | 浏览器 | 应用页 + share.html 的 SEO 检查（.go/.qr） |
| live_seo.js | 浏览器 | workbuddy host 闪屏 H1 与自动跳转检查（旧宿主时期） |
| where_share.js | 浏览器 | 「分享网址+二维码」入口位置查看 |
| deploy_check.js | 浏览器 | 本地部署包整包冒烟：标题/manifest/资源 4xx/分享层二维码（#slQr/#slUrl），当时端口 8766 |
| qr-decode-check.js | Node | 用 jsQR 解码验证生成的二维码内容 |

## K. 云 SDK 与旧宿主（workbuddy.host 时期，多已过时）

| 文件 | 类型 | 说明 |
|------|------|------|
| sdk_probe.js | 浏览器 | 旧宿主上 SDK 行为探针 |
| sdk_auth_api.js | Node | 静态分析 SDK 文件：列出 AuthModule 全部方法名（正则扫 sdk.js） |
| sdk-debug/（9 个文件） | 混合 | SDK 逐步探针：cn_cloud / probe_auth / probe_cn / probe_headers / probe_origin / probe_signin_real / sdk.js（抓包原文件）/ sdk.pretty.js（美化版）/ step1_send_proxy |
| verify_live.js | 浏览器 | 旧宿主线上域名全链路验证（只读探测，不发短信） |
| prod_smoke.js | 浏览器 | 旧宿主欢迎层/登录层冒烟（#adLayer/#adBody/#adLogin） |
| probe_wb_root.js | Node | 旧宿主根路径状态（status/title/meta refresh/#phone） |

## L. 域名与网络侦察（.com 跳转、DNS、CORS）

| 文件 | 类型 | 说明 |
|------|------|------|
| dns_probe.js | Node | 域名解析侦察：育人帮.cn / 育人帮.com（含 punycode） |
| doh_probe.js | Node | 用 Cloudflare DoH 权威查询，绕过本地 DNS 缓存 |
| doh_multi.js | Node | 四家 DoH（Cloudflare/Google/阿里/腾讯）对比解析 |
| poll_com.js | Node | 轮询 .com 的解析与 HTTP 跳转是否就绪 |
| verify_com_dns.js | Node | 系统解析器 + Google DoH 双路核对 |
| verify_com_e2e.js | Node | .com 最终跳转链 e2e（最终 status/url/title） |
| verify_com_live.js | Node | .com 各路径跳转响应头核对 |
| probe_com_now.js | Node | .com 当前状态快照（DNS + HTTP） |
| whois_probe.js | Node | WHOIS 查询：.com 的注册商/NS/状态 |
| fetch_probe.js | Node | 抓取线上页面，确认当前承载内容（.cn/.com 双域） |
| proxy_check.js | Node | .cn 同源代理与线上 cloud.js endpoint 检查 |
| cors_probe.js | Node | OPTIONS/POST 跨域响应头（acao）探针（旧宿主 vs .cn） |

## M. 综合回归（早期版本，已被 verify/scenario 取代）

| 文件 | 类型 | 说明 |
|------|------|------|
| regress.js | 浏览器 | 首页 + 家教 chip 早期回归 |
| verify.js | 浏览器 | 早期功能验证合集（自注「临时，存于 temp/」） |
| live_ui_check.js | 浏览器 | 育人帮.cn 线上真机验收：真实 Chrome 手机视图走一遍关键交互（生产域，云隔离期禁跑） |
