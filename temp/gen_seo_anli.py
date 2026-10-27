# -*- coding: utf-8 -*-
"""把 seo/anli/*.md 渲染成**搜索引擎可直接读取的静态页**。

为什么需要它：育人帮本身是 SPA，案例/求助都在 JS 里渲染，爬虫首页只能看到壳。
这里把编辑型长文案例生成真正的静态 HTML（含 Article / ItemList / FAQPage
结构化数据、canonical、sitemap 条目），让百度/必应能像抓普通网站一样抓到内容。

输入： yurenbang-app/seo/anli/*.md   （front matter + 正文 Markdown 子集）
输出： yurenbang-app/anli/index.html  （案例库首页，ItemList）
      yurenbang-app/anli/<slug>.html （每篇案例，Article）
      yurenbang-app/sitemap.xml      （含全部案例页）

用法： python temp/gen_seo_anli.py
      python temp/gen_seo_anli.py --check   # 只检查一致性，不写文件
"""
import html
import io
import json
import os
import re
import sys
import time

ROOT = r"E:/育人帮"
SRC = os.path.join(ROOT, "yurenbang-app")
MD_DIR = os.path.join(SRC, "seo", "anli")
OUT_DIR = os.path.join(SRC, "anli")
HOST = "https://yurenbang.app.workbuddy.host"   # 部署时由 sync_deploy 统一改写为 .cn
SITE = "育人帮"
CHECK_ONLY = "--check" in sys.argv

TAG_ORDER = ["学习习惯", "情绪与沟通", "手足与隔代", "社交与品格", "入学适应"]

FAQ = [
    ("这些案例是真实发生的吗？",
     "是。全部来自育人帮家长的真实求助与后续调整记录，成文时已隐去孩子姓名、学校、住址等可识别信息，并征得当事人同意。"),
    ("案例里的方法适合多大的孩子？",
     "每篇顶部都标注了年龄段。同一个方法在不同年龄要调整力度，比如「计时器分段」在三年级有效，到了初中更该让他自己排计划。"),
    ("我可以把自己的经历也写下来吗？",
     "可以。在育人帮发一条求助或成长记录，说明愿意被整理成案例，管理员会联系你确认细节和匿名范围。"),
    ("看案例能代替专业诊断吗？",
     "不能。案例是同伴经验，不是医疗或心理诊断。如果孩子出现持续情绪低落、拒学、自伤等情况，请及时寻求专业帮助。"),
]


# ---------------- 解析 ----------------
def parse_md(path):
    txt = io.open(path, encoding="utf-8").read().replace("\r\n", "\n")
    if not txt.startswith("---"):
        raise SystemExit("front matter 缺失: %s" % path)
    end = txt.find("\n---", 3)
    meta_raw = txt[3:end].strip()
    body = txt[end + 4:].lstrip("\n")
    meta = {}
    for line in meta_raw.split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    for need in ("title", "slug", "summary", "date", "tag"):
        if not meta.get(need):
            raise SystemExit("%s 缺少字段 %s" % (path, need))
    meta["body"] = body
    meta["file"] = os.path.basename(path)
    return meta


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
    return s


def md_to_html(md):
    out, buf, mode = [], [], None

    def flush_p():
        if buf:
            out.append("<p>%s</p>" % inline("".join(buf).strip()))
            del buf[:]

    def flush_list():
        nonlocal mode
        if mode:
            out.append("</%s>" % mode)
            mode = None

    for raw in md.split("\n"):
        line = raw.rstrip()
        if not line.strip():
            flush_p()
            flush_list()
            continue
        if line.startswith("### "):
            flush_p(); flush_list()
            out.append("<h3>%s</h3>" % inline(line[4:].strip()))
        elif line.startswith("## "):
            flush_p(); flush_list()
            out.append("<h2>%s</h2>" % inline(line[3:].strip()))
        elif line.startswith("# "):
            flush_p(); flush_list()
            out.append("<h2>%s</h2>" % inline(line[2:].strip()))
        elif line.startswith("> "):
            flush_p(); flush_list()
            out.append("<blockquote>%s</blockquote>" % inline(line[2:].strip()))
        elif re.match(r"^- ", line):
            flush_p()
            if mode != "ul":
                flush_list(); out.append("<ul>"); mode = "ul"
            out.append("<li>%s</li>" % inline(line[2:].strip()))
        elif re.match(r"^\d+\. ", line):
            flush_p()
            if mode != "ol":
                flush_list(); out.append("<ol>"); mode = "ol"
            out.append("<li>%s</li>" % inline(re.sub(r"^\d+\. ", "", line).strip()))
        else:
            if mode:
                flush_list()
            buf.append(line.strip())
    flush_p(); flush_list()
    return "\n".join(out)


# ---------------- 模板 ----------------
def head(title, desc, canonical, keywords, extra_ld, og_type="article"):
    ld = json.dumps(extra_ld, ensure_ascii=False, separators=(",", ":"))
    return """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<meta name="keywords" content="%(kw)s">
<meta name="author" content="育人帮">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="%(url)s">
<meta property="og:type" content="%(ogtype)s">
<meta property="og:site_name" content="育人帮">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:url" content="%(url)s">
<meta property="og:image" content="%(host)s/assets/icon-512.png">
<meta property="og:locale" content="zh_CN">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon-192.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/seo.css">
<script type="application/ld+json">%(ld)s</script>
</head>
<body>
<header class="site-head"><div class="in">
  <a class="brand" href="/"><span class="dot">帮</span>育人帮</a>
  <nav>
    <a href="/">社区首页</a>
    <a class="on" href="/anli/">家庭教育案例</a>
    <a href="/#page-cases">案例广场</a>
  </nav>
</div></header>
""" % {"title": html.escape(title), "desc": html.escape(desc), "kw": html.escape(keywords),
       "url": canonical, "ogtype": og_type, "host": HOST, "ld": ld}


def foot():
    return """
<footer class="site-foot">
  <span>© 2026 育人帮 · 家长互助社区</span>
  <a href="/anli/">全部案例</a>
  <a href="/">回到社区</a>
  <a href="/share.html">分享给朋友</a>
</footer>
</body>
</html>
"""


def render_case(c, rel):
    url = "%s/anli/%s" % (HOST, c["slug"])
    title = "%s｜家庭教育案例 · 育人帮" % c["title"]
    desc = c["summary"]
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": c["title"],
                "description": c["summary"],
                "inLanguage": "zh-CN",
                "datePublished": c["date"],
                "dateModified": c["date"],
                "articleSection": c["tag"],
                "keywords": c.get("keywords", ""),
                "url": url,
                "mainEntityOfPage": {"@type": "WebPage", "@id": url},
                "author": {"@type": "Organization", "name": "育人帮", "url": HOST + "/"},
                "publisher": {
                    "@type": "Organization", "name": "育人帮",
                    "logo": {"@type": "ImageObject", "url": HOST + "/assets/icon-512.png"},
                },
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "育人帮", "item": HOST + "/"},
                    {"@type": "ListItem", "position": 2, "name": "家庭教育案例", "item": HOST + "/anli/"},
                    {"@type": "ListItem", "position": 3, "name": c["title"], "item": url},
                ],
            },
        ],
    }
    rel_html = "\n".join(
        '<li><span>%s</span><a href="/anli/%s">%s</a></li>'
        % (html.escape(r["tag"]), r["slug"], html.escape(r["title"])) for r in rel
    ) or '<li><span>更多</span><a href="/anli/">进入家庭教育案例库</a></li>'

    return "".join([
        head(title, desc, url, c.get("keywords", ""), ld),
        '<main class="wrap">',
        '<nav class="crumb"><a href="/">首页</a> › <a href="/anli/">家庭教育案例</a> › <span>%s</span></nav>'
        % html.escape(c["tag"]),
        '<article class="post">',
        "<h1>%s</h1>" % html.escape(c["title"]),
        '<div class="post-meta"><b>%s</b><b>%s</b><span>%s 更新</span><span>约 %d 字</span></div>'
        % (html.escape(c.get("age", "全年龄")), html.escape(c["tag"]), c["date"], c["words"]),
        '<p class="lead-box">%s</p>' % html.escape(c["summary"]),
        '<div class="body">%s</div>' % md_to_html(c["body"]),
        '<div class="cta"><b>你家也有类似的情况吗？</b>'
        "<p>在育人帮发一条求助，把事情说清楚一点，会有经历过同样阶段的家长来回应。</p>"
        '<a class="btn" href="/">免费发布求助 →</a></div>',
        '<section class="rel"><h2>同一主题的其他案例</h2><ul>%s</ul></section>' % rel_html,
        "</article></main>",
        foot(),
    ])


def render_hub(cases):
    url = HOST + "/anli/"
    title = "家庭教育案例库：%d 个真实家庭的做法与调整｜育人帮" % len(cases)
    desc = ("家庭教育案例库，收录 %d 个真实家庭的做法：孩子写作业拖拉、沉迷手机、青春期不沟通、"
            "二孩争宠、隔代养育冲突、考砸情绪崩溃……每篇都有具体步骤和后来的变化，按年龄段与主题分类。"
            % len(cases))
    kw = "家庭教育案例,家庭教育案例库,育儿案例,真实育儿经验,小学生教育案例,青春期教育案例,家庭教育方法"

    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "name": "家庭教育案例库",
                "url": url,
                "inLanguage": "zh-CN",
                "description": desc,
                "isPartOf": {"@type": "WebSite", "name": SITE, "url": HOST + "/"},
                "mainEntity": {
                    "@type": "ItemList",
                    "numberOfItems": len(cases),
                    "itemListElement": [
                        {"@type": "ListItem", "position": i + 1, "name": c["title"],
                         "url": "%s/anli/%s" % (HOST, c["slug"])}
                        for i, c in enumerate(cases)
                    ],
                },
            },
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "育人帮", "item": HOST + "/"},
                {"@type": "ListItem", "position": 2, "name": "家庭教育案例", "item": url},
            ]},
            {"@type": "FAQPage", "inLanguage": "zh-CN",
             "mainEntity": [{"@type": "Question", "name": q,
                             "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
        ],
    }

    parts = [head(title, desc, url, kw, ld, og_type="website"),
             '<main class="wrap">',
             '<nav class="crumb"><a href="/">首页</a> › <span>家庭教育案例</span></nav>',
             '<section class="hero">',
             "<h1>家庭教育案例库：%d 个真实家庭的做法与调整</h1>" % len(cases),
             '<p class="lead">这里没有专家讲课，只有家长把自己踩过的坑写下来：当时怎么错的、后来怎么改、'
             "改了多久见效。每篇都标注了年龄和主题，按你家孩子的情况挑着看。</p>",
             '<div class="stat"><b><i>%d</i> 个案例</b><b><i>%d</i> 个主题</b>'
             "<b>全部来自真实求助记录</b><b>已隐去孩子可识别信息</b></div>"
             % (len(cases), len({c["tag"] for c in cases})),
             "</section>"]

    for tag in TAG_ORDER:
        group = [c for c in cases if c["tag"] == tag]
        if not group:
            continue
        parts.append('<div class="sect-h"><h2>%s</h2><em>%d 篇</em></div><div class="cards">'
                     % (html.escape(tag), len(group)))
        for c in group:
            parts.append(
                '<div class="card"><div class="tags"><b>%s</b><span>%s</span></div>'
                '<h3><a href="/anli/%s">%s</a></h3><p>%s</p>'
                '<a class="more" href="/anli/%s">看完整案例 →</a></div>'
                % (html.escape(tag), html.escape(c.get("age", "")), c["slug"],
                   html.escape(c["title"]), html.escape(c["summary"]), c["slug"]))
        parts.append("</div>")

    parts.append('<section class="note"><h2>怎么用这个案例库</h2><ol>'
                 "<li>先按主题找：<strong>学习习惯</strong>（作业拖拉、写作、手机）／"
                 "<strong>情绪与沟通</strong>（考砸了、青春期不开口）／"
                 "<strong>手足与隔代</strong>（二孩争宠、老人带娃）／"
                 "<strong>社交与品格</strong>（被孤立、撒谎）／"
                 "<strong>入学适应</strong>（早晨磨蹭、不肯上学）。</li>"
                 "<li>再看年龄段。同样一个方法，三年级和初二要用完全不同的力度。</li>"
                 "<li>只挑一件先试两周。同时改五件事，孩子和你都会崩。</li>"
                 "<li>没有对口的案例，就在社区里发一条求助，把孩子的年龄、具体表现写清楚。</li>"
                 "</ol></section>")

    parts.append('<section class="note"><h2>常见问题</h2>')
    for q, a in FAQ:
        parts.append("<h3>%s</h3><p>%s</p>" % (html.escape(q), html.escape(a)))
    parts.append("</section>")

    parts.append('<div class="cta"><b>想说说你家的情况？</b>'
                 "<p>发一条求助，不用写得漂亮，把「孩子几岁、发生了什么、你试过什么」说清楚就够了。</p>"
                 '<a class="btn" href="/">打开育人帮 →</a></div>')
    parts.append("</main>")
    parts.append(foot())
    return "".join(parts)


def render_sitemap(cases):
    rows = [("", "1.0", "daily"), ("anli/", "0.9", "weekly"),
            ("share", "0.6", "monthly")]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           "<!-- 育人帮 · 站点地图（由 temp/gen_seo_anli.py 生成，新增案例后重新运行即可） -->",
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    today = time.strftime("%Y-%m-%d")
    for path, pri, freq in rows:
        out.append("  <url><loc>%s/%s</loc><lastmod>%s</lastmod><changefreq>%s</changefreq>"
                   "<priority>%s</priority></url>" % (HOST, path, today, freq, pri))
    for c in cases:
        out.append("  <url><loc>%s/anli/%s</loc><lastmod>%s</lastmod>"
                   "<changefreq>monthly</changefreq><priority>0.8</priority></url>"
                   % (HOST, c["slug"], c["date"]))
    out.append("</urlset>")
    return "\n".join(out) + "\n"


# ---------------- 主流程 ----------------
def main():
    files = sorted(f for f in os.listdir(MD_DIR) if f.endswith(".md"))
    if not files:
        raise SystemExit("没有找到 seo/anli/*.md")
    cases = [parse_md(os.path.join(MD_DIR, f)) for f in files]
    slugs = [c["slug"] for c in cases]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("slug 重复：%s" % slugs)
    for c in cases:
        c["words"] = len(re.sub(r"\s", "", c["body"]))
        if c["words"] < 500:
            print("  ! %s 正文偏短（%d 字），建议补到 800 字以上" % (c["file"], c["words"]))

    pages = {"index.html": render_hub(cases)}
    for c in cases:
        rel = [x for x in cases if x["tag"] == c["tag"] and x["slug"] != c["slug"]][:4]
        if len(rel) < 2:
            rel += [x for x in cases if x["slug"] != c["slug"] and x not in rel][:2]
        pages[c["slug"] + ".html"] = render_case(c, rel)

    if CHECK_ONLY:
        bad = [n for n, s in pages.items()
               if not os.path.exists(os.path.join(OUT_DIR, n))
               or io.open(os.path.join(OUT_DIR, n), encoding="utf-8").read() != s]
        print("检查：%d 个页面，%d 个需重新生成" % (len(pages), len(bad)))
        for b in bad:
            print("  - " + b)
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, content in pages.items():
        io.open(os.path.join(OUT_DIR, name), "w", encoding="utf-8", newline="").write(content)
    io.open(os.path.join(SRC, "sitemap.xml"), "w", encoding="utf-8", newline="").write(render_sitemap(cases))

    total = sum(c["words"] for c in cases)
    print("生成完成：%d 篇案例 + 1 个案例库首页，正文合计 %d 字" % (len(cases), total))
    print("输出目录：%s" % OUT_DIR)
    print("sitemap：%s/sitemap.xml（%d 条 URL）" % (SRC, 3 + len(cases)))


if __name__ == "__main__":
    main()
