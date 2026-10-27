#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
育人帮 · 静态站点服务器（带智能兜底）
--------------------------------------------------
为什么需要它：
  家长常常手动输入或从收藏夹打开网址，很容易少写 ".html"（/yurenbang-app）
  或带着多余的路径（/yurenbang-app/），标准静态服务器会直接返回 404 错误页。
  本服务器在「请求的是页面、而该文件不存在」时，统一回退到应用入口页，
  让任何写法都能打开应用；同时保持静态资源（js/css/图片）缺失时如实 404，
  避免把 JS 请求错误地返回成 HTML。

部署要求：监听 $PORT，绑定 0.0.0.0
"""
import os
import posixpath
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
ENTRY = "yurenbang-app.html"
PAGE_EXT = {"", ".html", ".htm", ".php", ".asp", ".jsp"}


class Handler(SimpleHTTPRequestHandler):
    server_version = "YurenbangStatic/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- 核心：页面请求地址不对时，统一回到入口页 ----------
    def _coerce_to_entry(self):
        """返回 True 表示已处理（返回 None 代表已直接响应）；False 表示无需兜底。"""
        parsed = urllib.parse.urlparse(self.path)
        ext = posixpath.splitext(parsed.path)[1].lower()
        # 只对"看起来是在请求页面"的地址兜底；静态资源缺失时保持真实 404
        if ext not in PAGE_EXT:
            return False
        if not os.path.isfile(os.path.join(ROOT, ENTRY)):
            return False
        if parsed.path in ("/", "/index.html"):
            # 根路径直接返回入口页，网址保持简洁
            self.path = "/" + ENTRY
            return True
        # 其它写法（漏了 .html、多了层级、带多余斜杠）：跳转到入口页，
        # 这样相对路径资源（assets/...）一定落在正确目录
        self.send_response(302)
        self.send_header("Location", "/" + ENTRY)
        self.end_headers()
        return None

    def send_head(self):
        path = self.translate_path(self.path)
        missing_dir = os.path.isdir(path) and not os.path.isfile(
            os.path.join(path, "index.html")
        )
        if not os.path.exists(path) or missing_dir:
            if self._coerce_to_entry() is None:
                return None
        return super().send_head()

    # ---------- 缓存策略：页面不缓存，资源短缓存，避免家长看到旧版本 ----------
    def end_headers(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.endswith((".html", ".htm")) or parsed.path.endswith("/"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 保持日志安静


def main():
    port = int(os.environ.get("PORT", "3000"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("育人帮 static server on 0.0.0.0:%d (root=%s)" % (port, ROOT), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
