# 育人帮 · 腾讯云轻量应用服务器部署

把 `deploy-cn/`（Cloudflare Pages 产物）原样搬到 Lighthouse 上跑，用 nginx 顶替 `_worker.js`。

## 为什么 nginx 就够

`deploy-cn/_worker.js` 只干四件事，其中三件 nginx 能做，剩一件走回源：

| worker 能力 | 服务器上的等价实现 |
|---|---|
| `/yrbapi*` → `yurenbang.app.workbuddy.host`（Origin 改写 + 同源校验 + 限流） | `location ^~ /yrbapi` + `proxy_set_header Origin` + `if` 同源判断 + `limit_req` |
| `/sbapi*` → `nyqpovygnwinjsjoiadw.supabase.co` | 同上，`location ^~ /sbapi` |
| `/yrbtts`（Edge TTS，需 Sec-MS-GEC 令牌 + WebSocket） | nginx 做不了 → 本机 Node 服务 `tts/yrbtts.mjs` 直连微软端点；服务挂了才回源 CF 兜底 |
| 静态资源 + 安全头 + Cache-Control | `root /var/www/yrb` + `include snippets/yrb-security.conf` |

**依赖极少**：nginx 一个包 + Node 22（只给语音合成用，装完 60MB 内存）。不需要数据库、
不需要编译。轻量服务器 2核2G 跑这个站绰绰有余（纯静态，主要开销是语音合成的出口流量）。

## 目录

```
deploy-tencent/
├── install.sh                  # 服务器上一键安装（幂等、先备份、nginx -t 不过就回滚配置）
├── nginx/
│   ├── yrb-site.conf           # 站点配置（三条代理 + 静态 + 缓存/错误页）
│   └── yrb-security.conf       # 安全响应头（照抄 worker 的 secure()）
└── tts/
    ├── yrbtts.mjs              # 本机语音合成服务（算法段自动生成，勿手改）
    ├── yrbtts.service          # systemd 单元
    └── README.md               # 接口约定、运维命令、排障对照
```

## 部署步骤

在**本地**准备站点包（内容就是 `deploy-cn/` 除 `_worker.js` 外的全部文件）：

```bash
cd E:/育人帮
tar czf .cache/yrb-site.tar.gz -C deploy-cn .
scp .cache/yrb-site.tar.gz root@<公网IP>:/tmp/
scp -r deploy-tencent root@<公网IP>:/tmp/
```

在**服务器**上执行：

```bash
mkdir -p /tmp/yrb-release && tar xzf /tmp/yrb-site.tar.gz -C /tmp/yrb-release
bash /tmp/deploy-tencent/install.sh /tmp/yrb-release
```

脚本会依次：装 nginx → 备份旧站点目录 → 铺文件 → 写 `/etc/nginx/conf.d/yrb.conf` → 停用默认站点 → 校验 → reload → 自检并打印公网地址。

## 验收清单

**一条命令跑完**（推荐，2026-11-04 起）：

```bash
.venv/Scripts/python.exe temp/check_cn_site.py                 # 默认 http://118.89.185.37
.venv/Scripts/python.exe temp/check_cn_site.py --base http://<IP或域名> --skip-tts
```

9 项：首页 200 且 no-cache、构建号与 `deploy-cn/build.json` 一致、首页资源全 200、
静态资源带缓存头、`/yrbtts` 真出声、`/sbapi` 带 Referer 200 / 不带 403、
云端帖子可读、404 落站内页、`/index.html` 可达。全通过才叫部署完成。

手工对照（排查单项时用）：

| 检查项 | 期望 |
|---|---|
| `curl -I http://<IP>/` | 200，含 `X-YRB-Edge: <构建号>`、`Cache-Control: no-cache` |
| `curl http://<IP>/build.json` | 返回构建号 JSON |
| `curl -I http://<IP>/不存在的路径` | 404，页面是站内 `error.html` |
| 浏览器打开 `http://<IP>/` | 首页正常，控制台无大量报错 |
| 首页留言区 | 能读到云端数据（说明 `/yrbapi` 或 `/sbapi` 通了） |
| 点卡片上的 🔊 | 能出声（说明 `/yrbtts` 回源通了） |

## 两个现实约束

1. **域名不能直接绑**：境内服务器对未备案域名会拦，先用 `http://<IP>/` 验证功能；要正式对外必须先完成 ICP 备案（备案主体、材料清单另出）。
2. **TTS 依赖 Cloudflare**：`/yrbtts` 目前靠回源原站，所以 Cloudflare 上的部署**不能删**。要让服务器完全独立，需要写一个 Node 版 TTS（`temp/edge-tts-v2.js` 里已有令牌算法源码），届时替换 `location = /yrbtts` 那一段即可。

## 回滚

```bash
# 配置回滚
cp -a /etc/nginx/conf.d/yrb.conf.bak-<时间戳> /etc/nginx/conf.d/yrb.conf && nginx -t && systemctl reload nginx
# 站点回滚
rm -rf /var/www/yrb && cp -a /var/www/yrb.bak-<时间戳> /var/www/yrb
```

（回滚命令里带 `rm -rf`，执行前请确认路径无误——脚本本身从不主动删文件。）

---

## 实际部署记录（2026-11-04）

- 实例：上海二区 `lhins-ow6yn7yi`，2核2G / 50G SSD，Ubuntu 24.04.4，nginx 1.24.0（腾讯云内网源安装）
- 站点根：`/var/www/yrb`（93 个文件）；配置：`/etc/nginx/conf.d/yrb.conf` + `/etc/nginx/snippets/yrb-security.conf`
- 镜像预装的 Caddy（只服务默认欢迎页）已 `systemctl disable --now caddy` 让出 80 端口，未卸载，可随时重启恢复
- 服务器到生产站连通良好，站点文件直接从线上拉取（见下），无需本地上行

### 三个实测坑（都已修进脚本/配置，别再踩）

1. **nginx `if` 的正则不插值变量**：`if ($http_origin ~* "^https?://$host$")` 里的 `$host`
   是编译期字面量，永远匹配不上 → 全站 403。同源校验必须用 `=` 全等比较（右侧变量会插值），
   Referer 侧用 `valid_referers server_names`（依赖 server_name 写真实 IP/域名，不能只写 `_`）
2. **停用默认站点不能只改名**：`mv default default.disabled-xxx` 留在 `sites-enabled/` 里，
   `include sites-enabled/*` 通配照样加载 → `duplicate default server`。必须移出该目录
3. **`proxy_pass` 里出现变量就必须配 `resolver`**：TTS 回源用 `https://$yrb_cf$request_uri`
   是为了避开 Cloudflare Anycast IP 变更后 nginx 拿着启动时解析的旧 IP 不放；没配 resolver
   会报 `no resolver defined to resolve ...` 并 502

### 日常更新流程（增量）

```bash
# 1) 服务器上更新静态文件（从线上站点拉最新，-L 必须带：/index.html 是 308 跳转）
cd /tmp/yrb-release
cat filelist.txt | xargs -P 8 -I{} sh -c 'mkdir -p "$(dirname "{}")"; curl -sSLf -o "{}" "https://<域名>/{}"'
# error.html 线上 404（worker 只内部供给），需单独从本地包补
rsync -a /tmp/yrb-release/ /var/www/yrb/
# 2) 配置变更：改 /etc/nginx/conf.d/yrb.conf → nginx -t → systemctl reload nginx
```

### 验收结果（2026-11-04 真浏览器）

首页 200/2.2s、31 个层全部加载、构建号 `20261103201845` 与生产一致；信息流 13 条真实云端帖子、
案例 7 张卡片；`/yrbapi/` 200、`/yrbtts` 200（audio/mpeg 11KB）；无同源放行漏洞
（无 Origin 无 Referer → 403）；唯一控制台提示是探针自己打的 `/sbapi/` 裸路径 404（Supabase 根路径本就 404，非错误）。
