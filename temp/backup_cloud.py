#!/usr/bin/env python3
"""
育人帮 · 云端数据紧急导出（2026-11-04）

为什么有这份脚本：
  云应用 wbapp_ 计费隔离从 2026-10-26 起算 15 天，11-10 前后存在数据销毁风险，
  而平台侧一直导不出数据（402）。2026-11-01 迁到自建 Supabase 后，
  轻量云的 /sbapi 代理可以直连 PostgREST —— 用前端那枚 publishable key 就能
  读到 RLS 允许匿名读的部分。11-04 实测确实读得到（20 帖 + 案例 7 个）。

做三件事：
  1. 逐表分页拉全量（RLS 允许多少拉多少），落盘 JSON
  2. 每表记录「拿到几行 / HTTP 状态 / 是否被 RLS 挡住」，写进 _summary.json
  3. 打印一张人看的汇总表

输出目录默认 .cache/cloud-backup-<日期>/（.cache/ 在 gitignore 里，
  备份里可能有家长昵称与内容，不进公开仓库）。

用法：
  python temp/backup_cloud.py                     # 走轻量云 /sbapi
  python temp/backup_cloud.py --base http://...   # 换端点
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASE = "http://118.89.185.37/sbapi"


def resolve_key():
    """publishable key 不在这里再抄一份 —— 从源码唯一出处 cloud.js 读，
    环境变量 YRB_SB_KEY 优先（换库/轮换时不用改代码）。"""
    env = os.environ.get("YRB_SB_KEY")
    if env:
        return env.strip()
    src = os.path.join(ROOT, "yurenbang-app", "assets", "cloud.js")
    try:
        with open(src, encoding="utf-8") as f:
            m = re.search(r'sbKey\s*:\s*"([^"]+)"', f.read())
        if m:
            return m.group(1)
    except OSError:
        pass
    sys.exit("找不到 publishable key：设置 YRB_SB_KEY 环境变量，或确认 yurenbang-app/assets/cloud.js 存在")


KEY = resolve_key()

# 前端公开读的表（RLS 允许匿名 SELECT）。管理类表一并试，拿不到就如实记录。
TABLES = [
    ("yb_posts", "id"),
    ("yb_comments", "id"),
    ("yb_cases", "id"),
    ("yb_gifts", "id"),
    ("yb_settings", "key"),
    ("yb_profiles", "user_id"),     # 主键是 user_id，不是 id
    ("yb_tutor_req", "id"),
    ("yb_reports", "id"),
    ("yb_admins", "user_id"),       # 同上
    ("yb_admin_guard", "id"),
    ("yb_errlog", "id"),
]
PAGE = 1000


def fetch_page(base, table, order_col, offset):
    url = f"{base}/rest/v1/{table}?select=*&limit={PAGE}&offset={offset}&order={order_col}.asc"
    req = urllib.request.Request(url, headers={
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Referer": "http://118.89.185.37/",
        "Accept": "application/json",
        "Range-Unit": "items",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


def dump_table(base, table, order_col, outdir):
    rows, offset, status, err = [], 0, None, None
    while True:
        try:
            status, page = fetch_page(base, table, order_col, offset)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            status, err = e.code, (body or e.reason)
            break
        except Exception as e:  # 网络/超时
            status, err = -1, f"{type(e).__name__}: {e}"
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
        if offset > 100000:  # 防跑飞
            break

    if rows:
        with open(os.path.join(outdir, table + ".json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
    return {"table": table, "rows": len(rows), "status": status, "error": err,
            "file": (table + ".json") if rows else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    outdir = a.out or os.path.join(ROOT, ".cache", f"cloud-backup-{stamp}")
    os.makedirs(outdir, exist_ok=True)

    print(f"导出端点 {a.base}\n输出目录 {outdir}\n")
    results = []
    for table, col in TABLES:
        t0 = time.time()
        r = dump_table(a.base, table, col, outdir)
        r["seconds"] = round(time.time() - t0, 2)
        results.append(r)
        if r["rows"]:
            print(f"  ✓ {table:<16} {r['rows']:>5} 行   {r['seconds']}s")
        else:
            why = f"HTTP {r['status']}" + (f" {str(r['error'])[:60]}" if r["error"] else "")
            print(f"  · {table:<16}    0 行   {why}（多半是 RLS 只允许登录用户读，属预期）")

    summary = {
        "exported_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "base": a.base,
        "tables": results,
        "total_rows": sum(r["rows"] for r in results),
    }
    path = os.path.join(outdir, "_summary.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)

    print(f"\n合计 {summary['total_rows']} 行，汇总写入 {path}")
    return 0 if summary["total_rows"] > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
