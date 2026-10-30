# -*- coding: utf-8 -*-
"""把主应用（yurenbang-app）同步到部署包（deploy-cn），并**自动补回**域名适配。

存在这个脚本的原因：deploy-cn 与主应用共用大部分文件，但有几处必须指向
xn--gmqq09al6z.cn / 同源代理，直接复制会被覆盖（历史上踩过 4 次）。所以
复制之后统一重写这几处，并做断言，让"被覆盖"这件事再也发生不了。

用法： python temp/sync_deploy.py            # 同步 + 校验（只报告残留文件，不删）
      python temp/sync_deploy.py --check    # 只校验，不复制
      python temp/sync_deploy.py --prune    # 同步 + 真删源里已删的残留文件（删前备份到 .cache/）
"""
import io
import os
import re
import shutil
import time
import sys
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "yurenbang-app")
DST = os.path.join(ROOT, "deploy-cn")
CHECK_ONLY = "--check" in sys.argv
# --prune：删除对账时真删残留文件（默认只报告）。--check 时不说删就不删。
PRUNE = ("--prune" in sys.argv) and not CHECK_ONLY

CN = "https://xn--gmqq09al6z.cn/"
CN_HOST = "https://xn--gmqq09al6z.cn"
PROXY_ENDPOINT = CN_HOST + "/yrbapi"

# 必应 / IndexNow 的域名归属校验文件：站点根目录 /<key>.txt 内容必须等于 key 本身。
# 少了这个文件，IndexNow 推送会被拒（403 SiteVerificationNotPassed）。
INDEXNOW_KEY_FILE = "8f3c2a7d94b14e6f9a0c5d2e7b3f18a6.txt"
INDEXNOW_KEY = "8f3c2a7d94b14e6f9a0c5d2e7b3f18a6"

# 管理员私有配置（config/admin.local.json，已 gitignore，不入库）。
# 背景：源码 admin.js 不能硬编码管理员手机号（仓库公开 = 号码公开）。
# 做法：sync 时把 {"phones":[...]} 注入部署包 admin.js 开头的 window.YRB_ADMIN；
# 源码里 ADMIN_PHONES = (window.YRB_ADMIN && window.YRB_ADMIN.phones) || []。
# 配置文件缺失时注入空 phones（管理员识别走 ADMIN_IDS 主判据，不受影响）。
# 注意：部署产物是公开 JS，手机号在浏览器端本质藏不住——彻底方案是云端
# is_admin() RPC（见 admin.js 头部注释），此注入只为"仓库源码零手机号"。
ADMIN_CONFIG_PATH = os.path.join(ROOT, "config", "admin.local.json")


def admin_config_line():
    """返回注入 admin.js 开头的一行配置（确定性输出，供漂移检测复用）。"""
    phones = []
    try:
        with io.open(ADMIN_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        phones = [str(p) for p in (data.get("phones") or []) if str(p).strip()]
    except Exception:
        pass  # 无配置文件 / JSON 损坏：按空配置注入，宁可少一个兜底也不发坏包
    return "window.YRB_ADMIN=%s;\n" % json.dumps({"phones": phones}, ensure_ascii=False)

# 部署包 index.html 对应主应用的 yurenbang-app.html
RENAME = {"yurenbang-app.html": "index.html"}

# 需要同步的顶层文件（主应用里凡是站点入口/元数据都同步）
TOP_FILES = ["yurenbang-app.html", "share.html", "manifest.webmanifest", "sw.js",
             "robots.txt", "sitemap.xml", INDEXNOW_KEY_FILE,
             "baidu_verify_codeva-zN6rfBmxVp.html"]

# 域名适配规则（复制后重新套用）
REWRITES = {
    "assets/admin.js": [
        (r'const APP_URL = "https://yurenbang\.app\.workbuddy\.host/";',
         'const APP_URL = "%s";' % CN),
    ],
    "assets/capture.js": [
        (r'const LIVE_URL="https://yurenbang\.app\.workbuddy\.host/";',
         'const LIVE_URL="%s";' % CN),
    ],
    "assets/cloud.js": [
        (r'endpoint:"https://yurenbang\.app\.workbuddy\.host"',
         'endpoint:"%s"' % PROXY_ENDPOINT),
        (r'endpoint:"https://xn--gmqq09al6z\.cn/(?!yrbapi)', 'endpoint:"%s' % PROXY_ENDPOINT),
    ],
    "index.html": [
        # canonical 必须指向站点根（部署包里入口就是根路径）
        (r'<link rel="canonical" href="[^"]*">',
         '<link rel="canonical" href="%s">' % CN),
        # 主应用入口在部署包里叫 index.html，相对路径不变
        (r'yurenbang-app\.html', 'index.html'),
        (r'https://yurenbang\.app\.workbuddy\.host', CN_HOST),
    ],
    "share.html": [
        (r'https://yurenbang\.app\.workbuddy\.host', CN_HOST),
    ],
    "manifest.webmanifest": [
        (r'https://yurenbang\.app\.workbuddy\.host', CN_HOST),
    ],
    "sitemap.xml": [
        (r'https://yurenbang\.app\.workbuddy\.host', CN_HOST),
    ],
    "robots.txt": [
        (r'https://yurenbang\.app\.workbuddy\.host', CN_HOST),
    ],
}


def current_build():
    """本次部署的构建号 = 部署时刻（到秒，2026-10-30 从分钟收紧）。
    用它同时作为：index.html 的 meta、bundle.js 内的 window.YRB_BUILD、
    build.json 的内容、所有静态资源的 ?v= 戳。
    四处一致 → 运行时可判断"页面/资源"是否错层；任意两次部署之间必然不同 →
    用户不会长期卡在旧缓存。精确到秒是修「同分钟两次构建构建号相同」的碰撞——
    那会让升级层以为没有新版本，用户停在旧缓存。"""
    return time.strftime("%Y%m%d%H%M%S", time.localtime())


def write_build_json(build):
    """生成 /build.json：升级层用它探测"线上是否已有更新版本"。
    必须允许匿名 GET（_worker.js 白名单已加入），且不可被 CDN 长期缓存。"""
    data = {
        "build": build,
        "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "app": "育人帮",
        "layers": ["app", "state.schema", "state", "capture", "refine23", "access", "cloud",
                   "reward", "jiaojiao", "pptview", "admin", "adminguard", "gate", "license",
                   "profile", "food", "account", "chips", "rose", "protect", "mediafull", "cover",
                   "casedit", "longimg", "guard", "health", "upgrade"],
    }
    with io.open(os.path.join(DST, "build.json"), "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=1))
    return build


def stamp_assets(build=None):
    """给部署包 index.html 里的本地资源引用打上 ?v=<构建号>，并写死构建号 meta。
    手机浏览器把 assets 缓存 4 小时（Cloudflare Pages 的 max-age=14400），
    改了脚本用户却仍跑旧版 → 每次部署换一个戳，强制重新拉取。"""
    path = os.path.join(DST, "index.html")
    if not os.path.exists(path):
        return ""
    if not build:
        newest = 0
        for root, _dirs, files in os.walk(os.path.join(DST, "assets")):
            for f in files:
                newest = max(newest, int(os.path.getmtime(os.path.join(root, f))))
        build = time.strftime("%Y%m%d%H%M%S", time.localtime(newest))
    txt = io.open(path, encoding="utf-8").read()
    txt2 = re.sub(r'((?:src|href)="assets/[^"?]+\.(?:js|css))(?:\?v=\d+)?(")',
                  lambda m: m.group(1) + "?v=" + build + m.group(2), txt)
    # 构建号 meta 必须与资源戳、bundle 内常量一致（平稳升级层的错层检测依赖它）
    txt3 = re.sub(r'<meta name="yrb-build" content="[^"]*">',
                  '<meta name="yrb-build" content="%s">' % build, txt2)
    if not re.search(r'<meta name="yrb-build"', txt3):
        txt3 = txt3.replace("<meta charset=\"UTF-8\">",
                            "<meta charset=\"UTF-8\">\n<meta name=\"yrb-build\" content=\"%s\">" % build, 1)
    if txt3 != txt:
        io.open(path, "w", encoding="utf-8", newline="").write(txt3)
    return build


def rewrite_text(rel, txt):
    """对文本套用域名适配规则（纯函数，供文件改写与漂移检测复用）。"""
    for pat, rep in REWRITES.get(rel, []):
        txt = re.sub(pat, rep, txt)
    if rel == "assets/admin.js":
        # 管理员私有配置注入（见 ADMIN_CONFIG_PATH 注释）：只在部署包，源码保持零手机号
        txt = admin_config_line() + txt
    return txt


def apply_rewrites(rel):
    """对部署包内某个文件套用域名适配；返回改动次数。"""
    path = os.path.join(DST, rel)
    if not os.path.exists(path):
        return 0
    txt = io.open(path, encoding="utf-8").read()
    txt2 = rewrite_text(rel, txt)
    if txt2 != txt:
        io.open(path, "w", encoding="utf-8", newline="").write(txt2)
    return 0 if txt2 == txt else 1


def check_drift():
    """比对「源码 + 域名改写」与部署包内容，找出**改了源码却忘记同步**的文件。

    这是最容易被忽略的一类事故：本地改好、测试通过，但部署包里还是旧代码，
    发上去等于没改。--check 时一并报出来。
    2026-10-29 补 index.html：内联块改动会让 CSP hash 一起漂（P2.1），
    html 恰恰是最容易「改了忘同步」的文件。
    """
    bad = []
    # 顶层关键文件：index.html 不做全文比对——build_bundles 会把逐文件引用
    # 替换成 bundle 引用（结构性改写，非漂移）。改比对**内联脚本块指纹**：
    # 这是 CSP hash（P2.1）的输入，改了内联块忘 sync 才是真事故。
    import base64 as _b64
    import hashlib as _hl

    def _ih(text):
        return sorted(
            _b64.b64encode(_hl.sha256(m.group(1).encode("utf-8")).digest()).decode()
            for m in re.finditer(r"<script>(.*?)</script>", text, re.S)
        )
    for pair in (("yurenbang-app.html", "index.html"), ("share.html", "share.html")):
        sp = os.path.join(SRC, pair[0])
        dp = os.path.join(DST, pair[1])
        if os.path.exists(sp) and os.path.exists(dp):
            # 部署包是 rewrite 后的形态（域名适配可能落在内联块里），必须 rewrite 后再比
            src = rewrite_text(pair[1], io.open(sp, encoding="utf-8").read())
            if _ih(src) != _ih(io.open(dp, encoding="utf-8").read()):
                bad.append(pair[1] + "（内联脚本块与源码不一致）")
    sdir, ddir = os.path.join(SRC, "assets"), os.path.join(DST, "assets")
    if not os.path.isdir(sdir):
        return bad
    for name in sorted(os.listdir(sdir)):
        s = os.path.join(sdir, name)
        if not os.path.isfile(s) or not name.endswith((".js", ".css", ".json")):
            continue
        rel = "assets/" + name
        d = os.path.join(ddir, name)
        if not os.path.exists(d):
            bad.append(rel + "（部署包缺失）")
            continue
        src = io.open(s, encoding="utf-8").read()
        if rewrite_text(rel, src) != io.open(d, encoding="utf-8").read():
            bad.append(rel)
    return bad


def sync_assets():
    sdir, ddir = os.path.join(SRC, "assets"), os.path.join(DST, "assets")
    # 干净检出（如 CI）时 deploy-cn/assets 不存在，必须先建目录再复制
    os.makedirs(ddir, exist_ok=True)
    copied = []
    for name in sorted(os.listdir(sdir)):
        s = os.path.join(sdir, name)
        # gifts 目录里的原始 PNG 素材（每张 1-2MB）不上部署包，只发压缩后的 .webp
        if name == "gifts" and os.path.isdir(s):
            gd = os.path.join(ddir, "gifts")
            os.makedirs(gd, exist_ok=True)
            for g in sorted(os.listdir(s)):
                gs = os.path.join(s, g)
                if not os.path.isfile(gs) or not g.lower().endswith(".webp"):
                    continue
                gd_path = os.path.join(gd, g)
                if (not os.path.exists(gd_path)) or io.open(gs, "rb").read() != io.open(gd_path, "rb").read():
                    shutil.copy2(gs, gd_path)
                    copied.append("gifts/" + g)
            continue
        # vendor 目录：第三方渲染引擎整目录同步（如 pptx-preview，PPT 在线翻页用）
        if name == "vendor" and os.path.isdir(s):
            vd = os.path.join(ddir, "vendor")
            os.makedirs(vd, exist_ok=True)
            for v in sorted(os.listdir(s)):
                vs = os.path.join(s, v)
                if not os.path.isfile(vs):
                    continue
                vd_path = os.path.join(vd, v)
                if (not os.path.exists(vd_path)) or io.open(vs, "rb").read() != io.open(vd_path, "rb").read():
                    shutil.copy2(vs, vd_path)
                    copied.append("vendor/" + v)
            continue
        if not os.path.isfile(s):
            continue
        d = os.path.join(ddir, name)
        if (not os.path.exists(d)) or io.open(s, "rb").read() != io.open(d, "rb").read():
            shutil.copy2(s, d)
            copied.append(name)
    return copied


def sync_anli():
    """同步静态内容页（案例库 /anli/）：由 temp/gen_seo_anli.py 从 seo/anli/*.md 生成。
    这些页面是搜索引擎能直接读到正文的落点，必须随部署一起上线。"""
    sdir = os.path.join(SRC, "anli")
    if not os.path.isdir(sdir):
        return []
    ddir = os.path.join(DST, "anli")
    os.makedirs(ddir, exist_ok=True)
    copied = []
    for name in sorted(os.listdir(sdir)):
        s = os.path.join(sdir, name)
        if not os.path.isfile(s) or not name.endswith(".html"):
            continue
        d = os.path.join(ddir, name)
        if (not os.path.exists(d)) or io.open(s, "rb").read() != io.open(d, "rb").read():
            shutil.copy2(s, d)
            copied.append(name)
    return copied


def inject_worker_anli():
    """把案例库实际文件名注入 _worker.js 的白名单（ANLI 集合）。

    Pages 的 ASSETS 绑定对未命中路径会回落到 index.html，所以「文件是否存在」
    必须在 Worker 里用显式清单判断，否则 /anli/xxx.html 之类的死链也会 200。
    """
    wp = os.path.join(DST, "_worker.js")
    if not os.path.exists(wp):
        return 0
    adir = os.path.join(SRC, "anli")
    files = sorted(f for f in os.listdir(adir) if f.endswith(".html")) if os.path.isdir(adir) else []
    # 两种形态都要放行：无扩展名是规范地址（Pages 会把 /anli/x.html 308 到 /anli/x，
    # 若只放行 .html，浏览器跟完重定向就撞上 404）
    paths = []
    for f in files:
        paths.append("/anli/" + f)
        if f != "index.html":
            paths.append("/anli/" + f[:-5])
    txt = io.open(wp, encoding="utf-8").read()
    payload = "const ANLI = new Set(%s); /* __ANLI_INJECTED__ */" % json.dumps(paths, ensure_ascii=False)
    # 旧标记一并吞掉：此前每跑一次 sync 都会追加一个标记，越积越多
    txt2, n = re.subn(r"const ANLI = new Set\(.*?\);(?: /\* __ANLI_INJECTED__ \*/)*",
                      payload, txt, count=1, flags=re.S)
    if n and txt2 != txt:
        io.open(wp, "w", encoding="utf-8", newline="").write(txt2)
        return len(paths)
    return 0


def inject_csp_hashes():
    """把 index.html 静态内联 <script> 块的 SHA-256 注入 _worker.js 的 script-src，
    同时去掉 'unsafe-inline'（CSP 转强制预案 P2.1，2026-10-29）。

    背景：三段内联脚本里真正可执行的只有 2 段（SW 注册、启动屏自救），
    自愈/基础引导早已外置为 guard.js/health.js；JSON-LD（type 属性标签）不可
    执行，浏览器不拦。hash 由部署包 index.html 实算（脚本内容逐字节，
    含首尾换行），每次 sync 重算重写整个 script-src 值段，天然幂等，
    html 改了内联块而忘记 sync 时漂移会在 verify 一致性断言上现形。
    注意：新加内联块后必须重跑 sync，否则 Report-Only 立即报违规——
    这是有意为之的报警，比转强制后才发现要好。"""
    import base64
    import hashlib
    ipath = os.path.join(DST, "index.html")
    wp = os.path.join(DST, "_worker.js")
    if not (ipath and os.path.exists(wp)):
        return 0
    # hash 覆盖部署包**全部** html 的静态内联块（index/share/error + anli/*）：
    # 强制 CSP 的路径集合会扩大，任何页面将来冒出内联脚本都必须已被 hash 覆盖。
    hashes = []
    for root, _dirs, files in os.walk(DST):
        for f in files:
            if not f.endswith(".html"):
                continue
            html = io.open(os.path.join(root, f), encoding="utf-8").read()
            for m in re.finditer(r"<script>(.*?)</script>", html, re.S):
                d = hashlib.sha256(m.group(1).encode("utf-8")).digest()
                hashes.append("'sha256-" + base64.b64encode(d).decode() + "'")
    if not hashes:
        return 0
    txt = io.open(wp, encoding="utf-8").read()
    # CSP_POLICY 是数组 join("; ") 形态：script-src 是独立字符串元素（整行一个字面量）。
    # 必须按 "script-src ..." 引号内整段匹配——若按 "script-src [^;]*;" 跨引号匹配，
    # 会把数组后半段吞进替换里，worker 直接语法报错（2026-10-29 实测踩坑）。
    # 整段重写：旧 hash 一并清掉，幂等且集合自动跟随 html。
    txt2, n = re.subn(r'"script-src [^"]*"',
                      '"script-src \'self\' \'unsafe-eval\' ' + " ".join(hashes) + '"',
                      txt, count=1)
    if n and txt2 != txt:
        io.open(wp, "w", encoding="utf-8", newline="").write(txt2)
        return len(hashes)
    return 0


def rewrite_anli():
    """案例库静态页里的 canonical / og:url / JSON-LD 用的都是主应用域名，
    部署包里必须换成 .cn（否则 canonical 指错域名，收录会跑到别处）。"""
    ddir = os.path.join(DST, "anli")
    if not os.path.isdir(ddir):
        return 0
    n = 0
    for name in sorted(os.listdir(ddir)):
        if not name.endswith(".html"):
            continue
        p = os.path.join(ddir, name)
        txt = io.open(p, encoding="utf-8").read()
        txt2 = txt.replace("https://yurenbang.app.workbuddy.host", CN_HOST)
        if txt2 != txt:
            io.open(p, "w", encoding="utf-8", newline="").write(txt2)
            n += 1
    return n


def build_bundles(build=""):
    """把 index.html 引用的本地 CSS/JS 各合并成一个 bundle（2026-10-23 性能优化）。
    背景：国内访问 CF 边缘单请求 RTT 约 1s，首页原本 14 CSS + 14 JS 共 28 个请求，
    首开要 5-10s；合并后只剩 2 个请求。拼接顺序 = index.html 引用顺序，
    与原版逐文件加载语义一致（都是 body 末尾顺序执行）。
    单文件仍保留在部署包：SW 离线缓存清单引用它们，弱网自愈补载也按单文件补。"""
    ipath = os.path.join(DST, "index.html")
    txt = io.open(ipath, encoding="utf-8").read()
    css_files = re.findall(r'<link rel="stylesheet" href="(assets/[^"?]+?\.css)(?:\?v=\d+)?">', txt)
    js_files = re.findall(r'<script src="(assets/[^"?]+?\.js)(?:\?v=\d+)?"></script>', txt)
    if not css_files or not js_files:
        return "(index.html 无本地引用，跳过打包)"

    def cat(files, sep):
        parts = []
        for f in files:
            p = os.path.join(DST, f.replace("/", os.sep))
            body = io.open(p, encoding="utf-8").read() if os.path.exists(p) else ""
            parts.append("/* ==== %s ==== */\n%s" % (f, body))
        return sep.join(parts)

    css_txt = cat(css_files, "\n")
    js_txt = cat(js_files, "\n;\n")
    if build:
        # 构建号写在合并包最前面：升级层用它和 index.html 的 meta 比对是否错层。
        # 每次构建都从单文件重新拼接，不会累积重复。
        js_txt = ('/* 育人帮 构建号 %s —— 必须与 index.html 的 <meta name="yrb-build"> 一致 */\n'
                  'window.YRB_BUILD="%s";\n\n' % (build, build)) + js_txt
    io.open(os.path.join(DST, "assets", "bundle.css"), "w", encoding="utf-8", newline="").write(css_txt)
    io.open(os.path.join(DST, "assets", "bundle.js"), "w", encoding="utf-8", newline="").write(js_txt)

    first_css = [True]
    def css_sub(_m):
        if first_css[0]:
            first_css[0] = False
            return '<link rel="stylesheet" href="assets/bundle.css">'
        return ""
    first_js = [True]
    def js_sub(_m):
        if first_js[0]:
            first_js[0] = False
            return '<script src="assets/bundle.js"></script>'
        return ""
    txt2 = re.sub(r'<link rel="stylesheet" href="assets/[^"?]+?\.css(?:\?v=\d+)?">', css_sub, txt)
    txt2 = re.sub(r'<script src="assets/[^"?]+?\.js(?:\?v=\d+)?"></script>', js_sub, txt2)
    io.open(ipath, "w", encoding="utf-8", newline="").write(txt2)
    return "%d css + %d js → bundle.css %.0fKB / bundle.js %.0fKB" % (
        len(css_files), len(js_files),
        len(css_txt.encode("utf-8")) / 1024, len(js_txt.encode("utf-8")) / 1024)


def sync_top():
    copied = []
    for name in TOP_FILES:
        s = os.path.join(SRC, name)
        if not os.path.exists(s):
            continue
        d = os.path.join(DST, RENAME.get(name, name))
        if (not os.path.exists(d)) or io.open(s, "rb").read() != io.open(d, "rb").read():
            shutil.copy2(s, d)
            copied.append(RENAME.get(name, name))
    return copied


def verify():
    """校验部署包的关键约束，返回 (通过项, 失败清单)。"""
    ok, bad = [], []

    def need(cond, msg):
        (ok if cond else bad).append(msg)

    def read(rel):
        p = os.path.join(DST, rel)
        return io.open(p, encoding="utf-8").read() if os.path.exists(p) else ""

    admin = read("assets/admin.js")
    cap = read("assets/capture.js")
    cloud = read("assets/cloud.js")
    idx = read("index.html")

    need('APP_URL = "%s"' % CN in admin, "admin.js APP_URL → .cn")
    need("window.YRB_ADMIN=" in admin, "admin.js 已注入管理员私有配置（window.YRB_ADMIN，源码零手机号）")
    need('LIVE_URL="%s"' % CN in cap, "capture.js LIVE_URL → .cn")
    need('endpoint:"%s"' % PROXY_ENDPOINT in cloud, "cloud.js endpoint → 同源代理 /yrbapi")
    # ---- PWA 完整性（2026-10-23b）：部署包主页是 index.html，manifest/sw 不得残留 yurenbang-app.html ----
    mani = read("manifest.webmanifest")
    swjs = read("sw.js")
    need('"start_url": "/?source=pwa"' in mani and "yurenbang-app.html" not in mani,
         "manifest start_url → /?source=pwa（否则 PWA 安装/生成桌面图标失效）")
    need("'/yurenbang-app.html'" not in swjs and "'/', '/share.html'" in swjs,
         "sw.js 清单与离线兜底用 '/'（部署包无 yurenbang-app.html，残留会致离线打开失败）")
    need("yrb-cache-v" in swjs, "sw.js 缓存版本标记存在")
    need(os.path.exists(os.path.join(DST, "assets/icon-192.png"))
         and os.path.exists(os.path.join(DST, "assets/icon-512.png"))
         and os.path.exists(os.path.join(DST, "assets/icon-maskable-512.png")),
         "PWA 三个图标齐全（安装弹窗要求）")
    need(os.path.exists(os.path.join(DST, "_worker.js")), "同源代理 _worker.js 存在")
    # 恒真断言修正（2026-10-29 择机档）：read() 缺文件返回 ""，原写法 "in ... or True" 永远为真、
    # 等于没校验。改为实质检查「非空 + 含构建标记 + 含边缘标记头」
    _wjs = read("_worker.js")
    need(len(_wjs) > 1000 and "const BUILD_TAG" in _wjs and "x-yrb-edge" in _wjs,
         "_worker.js 内容完整（含 BUILD_TAG 与 x-yrb-edge 标记头）")
    need(re.search(r'src="assets/adminguard\.js(\?v=\d+)?"', idx) or "YRB_ADMINGUARD" in read("assets/bundle.js"),
         "adminguard 层已进入部署包（bundle 或单文件）")
    need(re.search(r'href="assets/adminguard\.css(\?v=\d+)?"', idx) or "adminguard" in read("assets/bundle.css"),
         "adminguard.css 已进入部署包")
    need(os.path.exists(os.path.join(DST, "assets/adminguard.js")), "adminguard.js 已同步")
    need(os.path.exists(os.path.join(DST, "assets/adminguard.css")), "adminguard.css 已同步")
    need(os.path.exists(os.path.join(DST, "assets/vendor/pptx-preview.umd.js")), "vendor 渲染引擎已同步（PPT 在线翻页）")
    need("YRB_PPT" in read("assets/pptview.js"), "pptview 层文件完整")
    # ---- 资源打包（性能）：index 只引 bundle，bundle 内容与单文件加载顺序一致 ----
    bundle_js = read("assets/bundle.js")
    need('href="assets/bundle.css' in idx and 'src="assets/bundle.js' in idx, "index.html 已引用合并 bundle")
    need(len(re.findall(r'src="assets/[a-z0-9]+\.js', idx)) <= 1, "index.html 不再逐个引用功能层 JS")
    need("YRB_APP" in bundle_js and "YRB_CLOUD" in bundle_js and "YRB_FOOD" in bundle_js, "bundle.js 含核心功能层")
    need(os.path.exists(os.path.join(DST, "assets/bundle.css")), "bundle.css 已生成")
    need("baidu_verify_" in read("_worker.js"), "worker 放行验证文件（bundle 兜底）")
    need('canonical" href="%s"' % CN in idx, "index.html canonical → .cn")
    need("<noscript>" in idx and "育人帮是什么" in idx, "index.html 含爬虫可读正文（noscript）")
    need("FAQPage" in idx, "index.html 含 FAQ 结构化数据")
    need('id="phone"' in idx, "index.html 含应用主体（#phone）")
    need("yurenbang-app.html" not in idx, "index.html 无 yurenbang-app.html 残留引用")
    need("yurenbang.app.workbuddy.host" not in admin + cap + idx,
         "无 workbuddy.host 残留（策略文案/入口）")
    need(os.path.exists(os.path.join(DST, "error.html")), "404 页面 error.html 存在")
    worker = read("_worker.js")
    need("x-yrb-edge" in worker and "notFound" in worker, "_worker.js 已启用严格 404（软 404 修复）")
    # ---- CSP 内联脚本 hash（预案 P2.1）：script-src 去 unsafe-inline，hash 与 html 实算一致 ----
    import base64 as _b64
    import hashlib as _hl
    live = set()
    for root, _dirs, files in os.walk(DST):
        for f in files:
            if not f.endswith(".html"):
                continue
            for m in re.finditer(r"<script>(.*?)</script>", io.open(os.path.join(root, f), encoding="utf-8").read(), re.S):
                live.add("'sha256-" + _b64.b64encode(_hl.sha256(m.group(1).encode("utf-8")).digest()).decode() + "'")
    ms = re.search(r'"script-src ([^"]*)"', worker)
    need(ms is not None, "_worker.js 含 script-src 指令")
    if ms:
        got = set(ms.group(1).split())
        need("'unsafe-inline'" not in got, "script-src 已去 unsafe-inline（P2.1 收紧）")
        need(live and live <= got, "CSP hash 与 index.html 内联块实算一致（%d 个）" % len(live))
        stale = got - live - {"'self'", "'unsafe-eval'"}
        need(not stale, "CSP 无过期 hash（html 改了内联块必须重跑 sync）")
    need("baidu_verify_" in worker, "_worker.js 已放行搜索引擎文件验证")
    # ---- 审核 M13（2026-10-29）：BUILD_TAG 版本戳与构建号一致 ----
    mtw = re.search(r'const BUILD_TAG = "([^"]*)"', worker)
    need(mtw is not None, "_worker.js 含 BUILD_TAG 版本戳")
    if mtw:
        try:
            bld2 = str(json.load(io.open(os.path.join(DST, "build.json"), encoding="utf-8")).get("build", ""))
        except Exception:
            bld2 = ""
        if bld2:  # 新检出且未跑过 sync 时 build.json 尚不存在，此时不判（CI 顺序保证先 sync）
            need(mtw.group(1) == bld2 + "-build",
                 "BUILD_TAG == 构建号+『-build』（worker=%s / build=%s）" % (mtw.group(1), bld2))
    swjs = read("sw.js")
    need(re.search(r"yrb-cache-v[34]" , swjs) and "isNav" in swjs, "sw.js 缓存清单 + isNav 兜底（v3/v4）")
    # ---- 审核 H8（2026-10-29）：预缓存容错与版本戳 ----
    need("allSettled" in swjs and "cache: 'reload'" in swjs,
         "sw.js 预缓存逐文件容错 + 绕 HTTP 缓存（防零缓存上线/旧 bundle 入缓存）")
    msw = re.search(r"const CORE_V = '(\d*)'", swjs)
    need(msw is not None, "sw.js 含 CORE_V 版本戳占位（源码里应有空字符串占位）")
    if msw:
        try:
            bjson = json.load(io.open(os.path.join(DST, "build.json"), encoding="utf-8"))
            bld = str(bjson.get("build", ""))
        except Exception:
            bld = ""
        need(bld != "" and msw.group(1) == bld,
             "sw.js CORE_V 版本戳 == build.json 构建号（sw=%s / build=%s）" % (msw.group(1) or "空", bld or "空"))
    need("YRB_HEALTH" in idx and "heal=" in idx, "内联自愈兜底（免疫系统拉不起来时补载）已内置")
    need("yrbSplashRescue" in idx, "启动屏自救（点按无反应自动刷新）已内置")

    # ---- 工程化：免疫系统 / 平稳升级 / 构建号一致性（2026-10-23）----
    need("YRB_HEALTH" in bundle_js, "免疫系统 health.js 已进入 bundle（功能级探针 + 自动补载）")
    need("YRB_UPGRADE" in bundle_js, "平稳升级 upgrade.js 已进入 bundle（新版本温和提示）")
    need("YRB_ROSE" in bundle_js, "玫瑰馈赠层 rose.js 已进入 bundle（点赞/收藏送玫瑰给发布者）")
    need("YRB_PROTECT" in bundle_js, "内容保护层 protect.js 已进入 bundle（禁复制/下载/打印，管理员豁免）")
    need("YRB_MEDIAFULL" in bundle_js, "媒体全屏与语音播读层 mediafull.js 已进入 bundle（视频全屏/案例图片放大/朗读）")
    need("YRB_COVER" in bundle_js and "thumb" in bundle_js, "案例封面层 cover.js + pptview.thumb 已进入 bundle（PPT 第一页封面）")
    need(os.path.exists(os.path.join(DST, "assets/cover.js")), "cover.js 单文件已同步（供自愈补载）")
    bundle_css = read("assets/bundle.css")
    need("pointer-events: auto" in bundle_css and "mf-vbtn" in bundle_css, "mediafull 样式已进入 bundle（视频可播 + 全屏按钮）")
    need(re.search(r"html\.yrb-guard video\s*\{[^}]*pointer-events:\s*auto", bundle_css, re.S) is not None,
         "保护层已放行视频原生控件（2026-10-24 修复真实视频点不动）")
    need("yrb-guard" in read("assets/bundle.css") or "yrb-guard" in bundle_js,
         "内容保护样式已进入 bundle（yrb-guard 选择器）")
    need(os.path.exists(os.path.join(DST, "assets/rose.js")), "rose.js 单文件已同步（供自愈补载）")
    need("'/assets/rose.js'" in swjs, "sw.js 离线清单含 rose 层")
    need(os.path.exists(os.path.join(DST, "assets/protect.js"))
         and os.path.exists(os.path.join(DST, "assets/protect.css")),
         "protect.js/css 单文件已同步（内容保护层，供自愈补载）")
    need("'/assets/protect.js'" in swjs, "sw.js 离线清单含内容保护层")
    need(os.path.exists(os.path.join(DST, "assets/health.js")), "health.js 单文件已同步（供自愈补载）")
    need(os.path.exists(os.path.join(DST, "assets/upgrade.js")), "upgrade.js 单文件已同步")
    mb = re.findall(r'<meta name="yrb-build" content="([^"]+)">', idx)
    need(len(mb) == 1 and mb[0] not in ("", "dev"), "index.html 已写入构建号 meta")
    if mb:
        need('window.YRB_BUILD="%s"' % mb[0] in bundle_js,
             "bundle.js 构建号与页面一致（新旧混载检测依赖）")
    need(os.path.exists(os.path.join(DST, "build.json")), "build.json 已生成（升级探测入口）")
    need('"/build.json"' in worker, "_worker.js 已放行 /build.json")
    need("SKIP_WAITING" in swjs and "skipWaiting" in swjs,
         "sw.js 支持平稳升级（不抢班，等页面放行）")
    need("'/assets/health.js'" in swjs and "'/assets/upgrade.js'" in swjs,
         "sw.js 离线清单含 health/upgrade 层")
    need(os.path.exists(os.path.join(DST, "baidu_verify_codeva-zN6rfBmxVp.html")), "百度文件验证文件已同步")
    _adir0 = os.path.join(DST, "anli")
    _cp0 = [f for f in os.listdir(_adir0) if f.endswith(".html")] if os.path.isdir(_adir0) else []
    need(_cp0 and all("/anli/" + f in worker for f in _cp0),
         "_worker.js 案例库白名单与 anli 目录一致（%d 条）" % len(_cp0))
    need(read(INDEXNOW_KEY_FILE).strip() == INDEXNOW_KEY, "IndexNow 校验文件 %s 已同步" % INDEXNOW_KEY_FILE)

    # ---- 静态案例库（/anli/）：搜索引擎的内容落点 ----
    anli_dir = os.path.join(DST, "anli")
    anli_idx = read("anli/index.html")
    case_pages = [f for f in os.listdir(anli_dir) if f.endswith(".html")] if os.path.isdir(anli_dir) else []
    need(len(case_pages) >= 11, "静态案例库已同步（index + %d 篇案例）" % max(0, len(case_pages) - 1))
    need("ItemList" in anli_idx and "FAQPage" in anli_idx, "案例库首页含 ItemList + FAQ 结构化数据")
    need(anli_idx.count('class="card"') >= 10, "案例库首页列出 ≥10 个案例卡片")
    need(os.path.exists(os.path.join(DST, "assets/seo.css")), "seo.css 已同步")
    need("/anli/" in read("sitemap.xml"), "sitemap 含案例库 URL")
    need('href="anli/"' in idx, "案例广场有指向案例库的内链")
    need("anli/" in idx, "首页 noscript 含案例库可抓取内链")
    need("yurenbang.app.workbuddy.host" not in anli_idx and
         all("workbuddy.host" not in read("anli/" + f) for f in case_pages),
         "案例库页 canonical/JSON-LD → .cn")

    return ok, bad


def stamp_sw(build):
    """审核 H8（2026-10-29）：sw.js 预缓存版本戳。
    源码里 CORE_V 留空；部署包注入构建号，预缓存请求带 ?v=构建号，
    避开 Pages 4h 资产缓存把旧 bundle 写进新版本缓存。
    返回 True=已注入/已是该值，False=占位缺失（verify 会拦）。"""
    p = os.path.join(DST, "sw.js")
    if not os.path.exists(p):
        return False
    txt = io.open(p, encoding="utf-8").read()
    want = "const CORE_V = '%s'" % build
    txt2 = re.sub(r"const CORE_V\s*=\s*'[^']*'", want, txt)
    if txt2 != txt:
        io.open(p, "w", encoding="utf-8", newline="").write(txt2)
        return True
    return want in txt


def stamp_worker_tag(build):
    """审核 M13（2026-10-29）：BUILD_TAG 过去写死 20261022 从未更新，
    x-yrb-edge 版本核对用途失效。sync 时重写为「构建号-build」。"""
    p = os.path.join(DST, "_worker.js")
    if not os.path.exists(p):
        return False
    txt = io.open(p, encoding="utf-8").read()
    want = 'const BUILD_TAG = "%s-build";' % build
    txt2 = re.sub(r'const BUILD_TAG = "[^"]*";', want, txt)
    if txt2 != txt:
        io.open(p, "w", encoding="utf-8", newline="").write(txt2)
        return True
    return want in txt


def expected_outputs():
    """部署包里「应该有」的相对路径集合——由源目录按同步规则推导。

    规则必须与 sync_assets / sync_top / sync_anli 保持一致，否则对账会误判。
    """
    want = set()
    for name in TOP_FILES:
        if os.path.exists(os.path.join(SRC, name)):
            want.add(RENAME.get(name, name))
    sdir = os.path.join(SRC, "assets")
    if os.path.isdir(sdir):
        for name in sorted(os.listdir(sdir)):
            p = os.path.join(sdir, name)
            if os.path.isdir(p):
                # gifts 只发压缩后的 .webp（原始 PNG 不上部署包）
                if name == "gifts":
                    for f in os.listdir(p):
                        if f.lower().endswith(".webp"):
                            want.add("assets/gifts/" + f)
                # vendor 整目录同步（第三方引擎）
                elif name == "vendor":
                    for f in os.listdir(p):
                        if os.path.isfile(os.path.join(p, f)):
                            want.add("assets/vendor/" + f)
                # 其余子目录不同步
            else:
                want.add("assets/" + name)
    adir = os.path.join(SRC, "anli")
    if os.path.isdir(adir):
        for f in os.listdir(adir):
            if f.endswith(".html"):
                want.add("anli/" + f)
    return want


# 部署包里由人工维护或由构建产出的文件：不对应任何源文件，对账时必须放过
PRUNE_KEEP = {
    "_worker.js",          # 人工源（Worker 高级模式）
    "error.html",          # 人工源（Pages 错误页）
    "build.json",          # 构建号产物
    "assets/bundle.css",   # build_bundles 产物
    "assets/bundle.js",    # build_bundles 产物
}


def reconcile(prune=False):
    """删除对账（2026-10-29 审核 M10）：找出「源里已删、部署包还留着」的文件。

    sync 历来只拷不删，于是源里删掉的东西会在生产上永久残留、仍可被访问
    （旧 JS、废弃图标、下线的案例页都踩过；案例广场改版时 /anli/ 死链就是这么来的）。
    默认**只报告**（删不删由人定，构建脚本不擅自删文件）；
    加 --prune 才真删，删前整份备份到 .cache/prune-<时间戳>/，可原样撤回。
    """
    want = expected_outputs()
    drift = []
    for root, _dirs, files in os.walk(DST):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), DST).replace("\\", "/")
            if rel in PRUNE_KEEP or rel in want:
                continue
            drift.append(rel)
    drift.sort()
    if not drift:
        print("[对账] 部署包与源一致，无残留文件 ✅")
        return []
    if not prune:
        print("[对账] 发现 %d 个残留文件（源里已删、部署包还在，生产上仍可访问）：" % len(drift))
        for rel in drift[:30]:
            print("   · " + rel)
        if len(drift) > 30:
            print("   … 另有 %d 个" % (len(drift) - 30))
        print("[对账] 确认无误后执行：python temp/sync_deploy.py --prune")
        return drift
    bak = os.path.join(ROOT, ".cache", "prune-" + time.strftime("%Y%m%d-%H%M%S"))
    for rel in drift:
        src = os.path.join(DST, rel)
        dst = os.path.join(bak, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
        print("   - 已移除 " + rel)
    print("[对账] 已移除 %d 个残留文件；备份在 %s（需要恢复就原样拷回）"
          % (len(drift), os.path.relpath(bak, ROOT)))
    return drift


def main():
    if not CHECK_ONLY:
        bld = current_build()
        a = sync_assets()
        t = sync_top()
        n = sync_anli()
        print("[同步] assets: %d 个文件更新 %s" % (len(a), ("→ " + ", ".join(a)) if a else "(无变化)"))
        print("[同步] 顶层: %d 个文件更新 %s" % (len(t), ("→ " + ", ".join(t)) if t else "(无变化)"))
        print("[同步] 案例库: %d 个静态页更新 %s" % (len(n), ("→ " + ", ".join(n)) if n else "(无变化)"))
        # 删除对账（M10）必须在 CSP hash 注入之前：残留 html 一带删掉，
        # 注入的 hash 集合才不会包含已消失页面的内联块（否则 verify 报「过期 hash」）
        reconcile(PRUNE)
        fixed = [rel for rel in REWRITES if apply_rewrites(rel)]
        na = rewrite_anli()
        nw = inject_worker_anli()
        nb = build_bundles(bld)
        nh = inject_csp_hashes()
        print("[性能] 资源打包: %s" % nb)
        print("[适配] _worker.js 案例库白名单: %d 条页面路径" % nw if nw else "[适配] _worker.js 白名单已是最新")
        print("[安全] CSP 内联脚本 hash: %s" % ("注入 %d 个（script-src 去 unsafe-inline）" % nh if nh else "已是最新"))
        print("[适配] 重新套用域名规则: %s；案例库页 %d 个已换域名"
              % (", ".join(fixed) if fixed else "(无需改动)", na))
        st = stamp_assets(bld)
        stamp_sw(st)
        stamp_worker_tag(st)
        write_build_json(st)
        print("[版本] 构建号: %s（meta / bundle / build.json / 资源戳 四处一致）" % st)

    if CHECK_ONLY:
        reconcile(False)          # 只校验模式：只报告残留，绝不删文件

    ok, bad = verify()
    print("\n[校验] 通过 %d 项" % len(ok))
    for m in ok:
        print("   ✓ " + m)
    drift = check_drift()
    if drift:
        # 只提示不拦截：允许"先改源码、稍后统一同步"的工作方式，但绝不让你忘了它
        print("[漂移] %d 个文件源码已改、部署包未同步：%s"
              % (len(drift), ", ".join(drift[:12]) + (" …" if len(drift) > 12 else "")))
    if bad:
        print("[校验] 失败 %d 项" % len(bad))
        for m in bad:
            print("   ✗ " + m)
        return 1
    print("[校验] 全部通过，可以部署 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
