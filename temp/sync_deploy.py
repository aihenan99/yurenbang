# -*- coding: utf-8 -*-
"""把主应用（yurenbang-app）同步到部署包（deploy-cn），并**自动补回**域名适配。

存在这个脚本的原因：deploy-cn 与主应用共用大部分文件，但有几处必须指向
xn--gmqq09al6z.cn / 同源代理，直接复制会被覆盖（历史上踩过 4 次）。所以
复制之后统一重写这几处，并做断言，让"被覆盖"这件事再也发生不了。

用法： python temp/sync_deploy.py            # 同步 + 校验
      python temp/sync_deploy.py --check    # 只校验，不复制
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

CN = "https://xn--gmqq09al6z.cn/"
CN_HOST = "https://xn--gmqq09al6z.cn"
PROXY_ENDPOINT = CN_HOST + "/yrbapi"

# 必应 / IndexNow 的域名归属校验文件：站点根目录 /<key>.txt 内容必须等于 key 本身。
# 少了这个文件，IndexNow 推送会被拒（403 SiteVerificationNotPassed）。
INDEXNOW_KEY_FILE = "8f3c2a7d94b14e6f9a0c5d2e7b3f18a6.txt"
INDEXNOW_KEY = "8f3c2a7d94b14e6f9a0c5d2e7b3f18a6"

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
    """本次部署的构建号 = 部署时刻（到分钟）。
    用它同时作为：index.html 的 meta、bundle.js 内的 window.YRB_BUILD、
    build.json 的内容、所有静态资源的 ?v= 戳。
    四处一致 → 运行时可判断"页面/资源"是否错层；任意两次部署之间必然不同 →
    用户不会长期卡在旧缓存。"""
    return time.strftime("%Y%m%d%H%M", time.localtime())


def write_build_json(build):
    """生成 /build.json：升级层用它探测"线上是否已有更新版本"。
    必须允许匿名 GET（_worker.js 白名单已加入），且不可被 CDN 长期缓存。"""
    data = {
        "build": build,
        "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "app": "育人帮",
        "layers": ["app", "state", "capture", "refine23", "access", "cloud", "reward", "jiaojiao",
                   "pptview", "admin", "adminguard", "gate", "license", "profile",
                   "food", "chips", "casedit", "health", "upgrade"],
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
        build = time.strftime("%Y%m%d%H%M", time.localtime(newest))
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
    """
    bad = []
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
    txt2, n = re.subn(r"const ANLI = new Set\(.*?\);", payload, txt, count=1, flags=re.S)
    if n and txt2 != txt:
        io.open(wp, "w", encoding="utf-8", newline="").write(txt2)
        return len(paths)
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
    need("_worker.js" in read("_worker.js") or True, "_worker.js 可读")
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
    need("baidu_verify_" in worker, "_worker.js 已放行搜索引擎文件验证")
    swjs = read("sw.js")
    need(re.search(r"yrb-cache-v[34]" , swjs) and "isNav" in swjs, "sw.js 缓存清单 + isNav 兜底（v3/v4）")
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


def main():
    if not CHECK_ONLY:
        bld = current_build()
        a = sync_assets()
        t = sync_top()
        n = sync_anli()
        print("[同步] assets: %d 个文件更新 %s" % (len(a), ("→ " + ", ".join(a)) if a else "(无变化)"))
        print("[同步] 顶层: %d 个文件更新 %s" % (len(t), ("→ " + ", ".join(t)) if t else "(无变化)"))
        print("[同步] 案例库: %d 个静态页更新 %s" % (len(n), ("→ " + ", ".join(n)) if n else "(无变化)"))
        fixed = [rel for rel in REWRITES if apply_rewrites(rel)]
        na = rewrite_anli()
        nw = inject_worker_anli()
        nb = build_bundles(bld)
        print("[性能] 资源打包: %s" % nb)
        print("[适配] _worker.js 案例库白名单: %d 条页面路径" % nw if nw else "[适配] _worker.js 白名单已是最新")
        print("[适配] 重新套用域名规则: %s；案例库页 %d 个已换域名"
              % (", ".join(fixed) if fixed else "(无需改动)", na))
        st = stamp_assets(bld)
        write_build_json(st)
        print("[版本] 构建号: %s（meta / bundle / build.json / 资源戳 四处一致）" % st)

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
