#!/usr/bin/env bash
# ============================================================
# 育人帮 · 轻量应用服务器一键安装（nginx 静态站 + 三条代理）
#
# 用法（在服务器上，root 执行）：
#   bash install.sh [站点包目录]        # 默认 /tmp/yrb-release
#
# 行为约定：
#   · 幂等：可重复执行，不会清空旧目录
#   · 不删除任何已有文件：旧站点目录先整份备份成 yrb.bak-<时间戳>
#   · 改 nginx 配置前先跑 nginx -t，不通过则回滚配置、不动线上
# ============================================================
set -euo pipefail

SRC="${1:-/tmp/yrb-release}"
SITE="/var/www/yrb"
SNIP="/etc/nginx/snippets/yrb-security.conf"
CONF="/etc/nginx/conf.d/yrb.conf"
TS="$(date +%Y%m%d%H%M%S)"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 root 执行（或 sudo bash install.sh）"
[ -f "$SRC/index.html" ] || die "站点包目录不对：$SRC 下没有 index.html"

# ---------- 1. 系统与包管理 ----------
say "识别系统"
if command -v apt-get >/dev/null 2>&1; then
  PKG="apt-get"; PM_INSTALL="apt-get install -y"
elif command -v dnf >/dev/null 2>&1; then
  PKG="dnf"; PM_INSTALL="dnf install -y"
elif command -v yum >/dev/null 2>&1; then
  PKG="yum"; PM_INSTALL="yum install -y"
else
  die "无法识别包管理器（只支持 apt/dnf/yum）"
fi
echo "包管理器：$PKG"
. /etc/os-release 2>/dev/null || true
echo "系统：${PRETTY_NAME:-unknown}"

# ---------- 2. 安装 nginx ----------
if command -v nginx >/dev/null 2>&1; then
  say "nginx 已存在：$(nginx -v 2>&1)"
else
  say "安装 nginx"
  if [ "$PKG" = "apt-get" ]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive $PM_INSTALL nginx
  else
    $PM_INSTALL nginx
  fi
fi

# ---------- 3. 构建号 ----------
BUILD="unknown"
if [ -f "$SRC/build.json" ]; then
  BUILD="$(sed -n 's/.*"build"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/build.json" | head -1)"
  [ -n "$BUILD" ] || BUILD="unknown"
fi
say "构建号：$BUILD"

# 站点主机名：IP 必须写进 server_name —— nginx 的 valid_referers server_names
# 要靠它判定 Referer 是否本站，只写 "_" 会把所有同源 GET 判成非法。
DOMAIN="${2:-}"
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP_ADDR" ] || IP_ADDR="_"
SERVER_NAME="$IP_ADDR${DOMAIN:+ $DOMAIN}"
say "server_name：$SERVER_NAME"

# ---------- 4. 铺静态文件（先备份，不删旧文件） ----------
say "部署静态文件到 $SITE"
mkdir -p "$SITE"
if [ -n "$(ls -A "$SITE" 2>/dev/null || true)" ]; then
  BK="$SITE.bak-$TS"
  cp -a "$SITE" "$BK"
  echo "旧站点已备份：$BK"
fi
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$SRC"/ "$SITE"/          # 不带 --delete：宁留冗余，不误删
else
  cp -a "$SRC"/. "$SITE"/
fi
chown -R www-data:www-data "$SITE" 2>/dev/null || chown -R nginx:nginx "$SITE" 2>/dev/null || true
find "$SITE" -type d -exec chmod 755 {} +
find "$SITE" -type f -exec chmod 644 {} +
echo "文件数：$(find "$SITE" -type f | wc -l)"

# ---------- 5. 写 nginx 配置 ----------
say "安装 nginx 配置"
mkdir -p /etc/nginx/snippets
# 注意：片段里也有 __BUILD__，必须一起 sed，否则响应头会原样吐出 __BUILD__（实测踩过）
sed "s/__BUILD__/$BUILD/g" "$(dirname "$0")/nginx/yrb-security.conf" > "$SNIP"
chmod 644 "$SNIP"
sed -e "s/__BUILD__/$BUILD/g" -e "s/__SERVER_NAME__/$SERVER_NAME/g" \
    "$(dirname "$0")/nginx/yrb-site.conf" > "$CONF.new"
if [ -f "$CONF" ]; then
  cp -a "$CONF" "$CONF.bak-$TS"
  echo "旧配置已备份：$CONF.bak-$TS"
fi
mv "$CONF.new" "$CONF"
# 默认站点会抢 default_server，改名让位（不删除，保留可回退）
# 停用默认站点有两个坑（都实测踩过）：
#   a) 不能写 `[ -f "$d" ] && mv ...`——在 set -e 下循环体最后一条返回 1 会让脚本提前退出
#   b) 不能只改名留在 sites-enabled/ 里——nginx 的 include sites-enabled/* 是通配，
#      default.disabled-xxx 照样被加载，直接报 duplicate default server
# 所以：先 if 包住，再搬到目录外。
mkdir -p /etc/nginx/disabled
for d in /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf; do
  if [ -f "$d" ]; then
    mv "$d" "/etc/nginx/disabled/$(basename "$d").$TS" && echo "已停用冲突的默认站点：$d"
  fi
done

# ---------- 6. SELinux（CentOS 系反代必需） ----------
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  say "SELinux 为 Enforcing，放行 nginx 出网"
  setsebool -P httpd_can_network_connect 1 || warn "setsebool 失败，反代可能 502"
fi

# ---------- 7. 校验并生效 ----------
say "nginx -t 校验"
if ! nginx -t 2>&1 | tee /tmp/yrb-nginx-test.log | tail -3; then
  warn "配置校验失败，回滚到上一版配置"
  [ -f "$CONF.bak-$TS" ] && cp -a "$CONF.bak-$TS" "$CONF"
  die "未生效，线上未变动。日志：/tmp/yrb-nginx-test.log"
fi

systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx
sleep 1
systemctl is-active --quiet nginx || die "nginx 未启动，查 journalctl -u nginx -n 50"

# ---------- 8. 自检 ----------
say "本机自检"
IP="$(curl -s --max-time 3 https://api.ipify.org || hostname -I | awk '{print $1}')"
for p in / /build.json /assets/app.css /yrbtapi-test; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1$p" || echo ERR)"
  printf '  %-22s %s\n' "$p" "$code"
done
echo
echo "站点根：$SITE"
echo "构建号：$BUILD"
echo "公网地址：http://$IP/"
echo
warn "还要去腾讯云控制台确认【防火墙】已放行 80 / 443（默认模板通常已开）"
warn "域名访问需先完成 ICP 备案；备案前请用 http://<公网IP>/ 访问"
