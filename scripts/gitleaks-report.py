#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 gitleaks 的 JSON 报告转成「看得见」的 CI 输出。

为什么需要这个脚本：
  gitleaks 自己只在终端里打印命中项，而 GitHub Actions 的日志要登录才能看；
  非维护者（比如你手机上、或以后交接给别人）只能看到一个红叉，不知道命中了什么。
  这里把每条命中转成 ::error 注解（公开页面就能看见规则/文件/行号），
  同时写一份 Markdown 表进 Job Summary。

用法：python3 scripts/gitleaks-report.py <report.json>
退出码：有命中 → 1；零命中 → 0；报告文件缺失 → 2（说明扫描本身没跑起来）
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: gitleaks-report.py <report.json>")
        return 2
    path = sys.argv[1]
    if not os.path.exists(path):
        print("找不到报告文件：%s —— 说明扫描没跑起来（多为二进制下载或配置错误）" % path)
        return 2

    with open(path, encoding="utf-8") as fh:
        try:
            findings = json.load(fh)
        except Exception as exc:  # noqa: BLE001
            print("报告不是合法 JSON：%s" % exc)
            return 2

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not findings:
        print("gitleaks 零命中（全历史）")
        if summary:
            with open(summary, "a", encoding="utf-8") as out:
                out.write("## gitleaks 零命中（全历史）\n")
        return 0

    print("命中 %d 条：" % len(findings))
    rows = ["| 规则 | 文件 | 行 | 提交 | 说明 |", "|---|---|---|---|---|"]
    for item in findings[:50]:
        rule = item.get("RuleID") or item.get("ruleID") or "?"
        file = item.get("File") or item.get("file") or "?"
        line = item.get("StartLine") or 1
        commit = (item.get("Commit") or "")[:7]
        desc = (item.get("Description") or "").replace("|", "/")
        print("  %s  %s:%s  (%s)" % (rule, file, line, desc))
        # 注解：公开仓库页面直接可见，无需登录看日志
        print("::error file=%s,line=%s::%s %s" % (file, line, rule, desc))
        rows.append("| %s | %s | %s | %s | %s |" % (rule, file, line, commit, desc))

    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("## gitleaks 命中 %d 条\n\n" % len(findings))
            out.write("\n".join(rows) + "\n\n")
            out.write("> 真泄密：立即吊销该凭据并清理历史；误报：把特征加进 `.gitleaks.toml` 的 allowlist 并注明原因。\n")

    return 1


if __name__ == "__main__":
    sys.exit(main())
