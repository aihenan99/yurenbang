# -*- coding: utf-8 -*-
"""育人帮 · 一键发布（带自动体检与自动回滚）  2026-10-23
=================================================================
为什么需要它：以前发布 = 同步 + 部署 + 人工点几下确认。一旦新版本有
问题，用户先发现、再反馈、再排查、再改——中间这段时间线上是坏的。

现在发布是一个"有守卫的动作"：
  1. 备份当前线上内容（deploy-cn → .cache/deploy_prev）
  2. 同步源码 + 全量校验（sync_deploy.py，任何一项不过就直接中止，不部署）
  3. 部署到 Cloudflare Pages
  4. 用真实浏览器跑生产自检（prod-check.js：免疫系统各层、构建号、关键入口）
  5. **自检失败 → 自动恢复备份并重新部署 → 线上回到上一版，并明确告知**

用法：
  python temp/release.py                 # 完整发布（推荐）
  python temp/release.py --check         # 只跑生产自检，不发布
  python temp/release.py --no-rollback   # 发布但失败不回滚（排查用）
  python temp/release.py --skip-sync     # 跳过同步（部署包已就绪时）
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = r"E:/育人帮"
DST = os.path.join(ROOT, "deploy-cn")
PREV = os.path.join(ROOT, ".cache", "deploy_prev")
LASTGOOD = os.path.join(ROOT, ".cache", "deploy_lastgood")
TEMP = os.path.join(ROOT, "temp")
PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
NODE = r"C:/Users/a/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
SITE = "https://xn--gmqq09al6z.cn/"
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"

ARGS = sys.argv[1:]
CHECK_ONLY = "--check" in ARGS
NO_ROLLBACK = "--no-rollback" in ARGS
SKIP_SYNC = "--skip-sync" in ARGS


def say(msg):
    print("\n" + "=" * 62 + "\n" + msg + "\n" + "=" * 62, flush=True)


def run(cmd, timeout=900):
    """执行子进程，实时透传输出。返回 (ok, 输出文本)。"""
    # 2026-10-29 审核修复（C1）：脚本型命令先查文件在不在，缺失当场失败并说清，
    # 避免重演 prod-check.js 迁移后断链、部署成功后误回滚的事故
    if len(cmd) > 1 and cmd[0] in (NODE, PY, getattr(sys, "executable", "")) and os.path.splitext(cmd[1])[1]:
        if not os.path.exists(cmd[1]):
            print("[断链] 脚本不存在：%s（发布中止，别等部署后再炸）" % cmd[1], flush=True)
            return False, "[断链] 脚本不存在: " + cmd[1]
    print("$ " + " ".join(cmd), flush=True)
    p = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    lines = []
    try:
        for raw in iter(p.stdout.readline, b""):
            s = raw.decode("utf-8", "ignore")
            lines.append(s)
            sys.stdout.write(s)
            sys.stdout.flush()
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill()
        lines.append("\n[超时] 命令超过 %d 秒被终止\n" % timeout)
        return False, "".join(lines)
    return p.returncode == 0, "".join(lines)


def read_build(dirpath):
    p = os.path.join(dirpath, "build.json")
    if not os.path.exists(p):
        return ""
    try:
        return json.loads(io.open(p, encoding="utf-8").read()).get("build", "")
    except Exception:
        return ""


def _manifest(dirpath):
    """快照清单：相对路径 → 大小。回滚时按清单精确恢复，
    既能覆盖旧文件，又不需要"先删空目录"这种危险动作。"""
    out = {}
    for root, _dirs, files in os.walk(dirpath):
        for f in files:
            if f == ".manifest.json":
                continue
            p = os.path.join(root, f)
            out[os.path.relpath(p, dirpath).replace("\\", "/")] = os.path.getsize(p)
    return out


def _write_manifest(dirpath):
    try:
        with io.open(os.path.join(dirpath, ".manifest.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps(_manifest(dirpath), ensure_ascii=False))
    except Exception as e:
        print("[快照] 清单写入失败（不影响回滚，将退回整体覆盖）：%s" % e)


def _apply_snapshot(src):
    """把快照内容覆盖回 DST。全程不删除任何文件/目录。"""
    man_path = os.path.join(src, ".manifest.json")
    n = 0
    if os.path.exists(man_path):
        try:
            man = json.loads(io.open(man_path, encoding="utf-8").read())
        except Exception:
            man = None
        if man:
            for rel in man:
                s = os.path.join(src, rel.replace("/", os.sep))
                if not os.path.exists(s):
                    continue
                d = os.path.join(DST, rel.replace("/", os.sep))
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(s, d)
                n += 1
            return n
    shutil.copytree(src, DST, dirs_exist_ok=True)
    return len(_manifest(src))


def backup():
    """同步前留一份"改动前"的快照，只作为首次发布时的兜底。"""
    os.makedirs(PREV, exist_ok=True)
    shutil.copytree(DST, PREV, dirs_exist_ok=True)   # dirs_exist_ok → 不删目录
    _write_manifest(PREV)
    b = read_build(PREV)
    print("[备份] 改动前内容 → .cache/deploy_prev（构建号 %s，%d 个文件）"
          % (b or "未知", len(_manifest(PREV))))
    return b


def save_lastgood():
    """发布并自检通过后才写入"最后已知良好版本"——这才是回滚应该退回去的目标。
    之前只备份"同步前内容"有个致命问题：若本地已先同步过，备份里其实是未验证的新版，
    回滚等于原地转圈。"""
    os.makedirs(LASTGOOD, exist_ok=True)
    shutil.copytree(DST, LASTGOOD, dirs_exist_ok=True)
    _write_manifest(LASTGOOD)
    print("[快照] 已记录为「最后已知良好版本」（构建号 %s）" % (read_build(LASTGOOD) or "未知"))


def restore():
    """覆盖式恢复：绝不删除目录（批量删除既危险又会被安全策略拦截）。
    目标优先「最后已知良好版本」，其次才是同步前快照。"""
    src = LASTGOOD if os.path.exists(LASTGOOD) else (PREV if os.path.exists(PREV) else "")
    if not src:
        print("[回滚] 没有可用快照，放弃回滚")
        return False
    n = _apply_snapshot(src)
    print("[回滚] 已按清单恢复 %d 个文件（%s，构建号 %s）"
          % (n, "最后良好版本" if src == LASTGOOD else "改动前快照", read_build(DST) or "未知"))
    return True


def fetch_build(timeout=8):
    """轻量读线上构建号（不走浏览器，轮询传播状态用）。"""
    import urllib.request
    try:
        req = urllib.request.Request(SITE + "build.json?t=%d" % int(time.time() * 1000),
                                     headers={"User-Agent": UA, "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")).get("build", "")
    except Exception:
        return ""


def wait_for_build(expected, timeout=150):
    """部署完成后等待边缘生效：Cloudflare 上传成功 ≠ 全球边缘立刻切换。
    之前正是因为"上传完马上检查"，把传播延迟误判成发布失败。"""
    if not expected:
        return True
    t0 = time.time()
    seen = ""
    while time.time() - t0 < timeout:
        seen = fetch_build()
        if seen == expected:
            print("[传播] 线上已切到 %s（等待 %.0f 秒）" % (seen, time.time() - t0))
            return True
        time.sleep(3)
    print("[传播] 等待 %d 秒后线上仍是 %s（期望 %s）" % (timeout, seen or "读不到", expected))
    return False


def prod_check():
    ok, out = run([NODE, os.path.join(ROOT, "tests", "scenario", "prod-check.js"), "--json"], timeout=180)
    data = {}
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("{") and '"checks"' in line:
            try:
                data = json.loads(line)
            except Exception:
                pass
    return ok, data, out


def prod_check_retry(times=2, gap=10):
    """自检失败不立刻判死刑：浏览器缓存 / 边缘未完全一致都可能造成单次抖动。"""
    last = (False, {}, "")
    for i in range(times):
        ok, data, out = prod_check()
        last = (ok, data, out)
        if ok:
            return last
        if i < times - 1:
            print("[自检] 第 %d 次未通过，%d 秒后复检…" % (i + 1, gap))
            time.sleep(gap)
    return last


def deploy():
    return run([PY, "-u", os.path.join(TEMP, "cf_browser_deploy.py")], timeout=900)[0]


def main():
    # 审核 M11（2026-10-29）：并发发布锁——两个发布进程并行会互相污染备份/lastgood。
    # O_CREAT|O_EXCL 是原子的「存在即失败」，进程退出 finally 里删除。
    lock_path = os.path.join(TEMP, ".release.lock")
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    except FileExistsError:
        try:
            other = io.open(lock_path, encoding="utf-8").read().strip()
        except Exception:
            other = "?"
        print("[锁] 已有发布进程在跑（PID %s）。若是残留锁，确认没在发布后手动删 temp/.release.lock" % other)
        return 2
    try:
        return _main_unlocked()
    finally:
        try: os.remove(lock_path)
        except OSError: pass


def _main_unlocked():
    t0 = time.time()

    if CHECK_ONLY:
        say("只做生产自检")
        ok, data, out = prod_check_retry(2, 8)
        if data:
            for c in data.get("checks", []):
                print("   %s %s%s" % ("✓" if c.get("ok") else "✗", c.get("name"),
                                      ("（%s）" % c.get("detail")) if c.get("detail") else ""))
            print("\n线上构建号：%s" % (data.get("build") or "未知"))
        else:
            print(out[-1500:])
        return 0 if ok else 1

    prev_build = read_build(LASTGOOD) or read_build(DST)
    if os.path.exists(LASTGOOD):
        print("[备份] 已有「最后已知良好版本」（构建号 %s），本次跳过改动前备份" % (prev_build or "未知"))
    else:
        say("① 备份改动前内容（构建号 %s）" % (prev_build or "未知"))
        backup()

    if not SKIP_SYNC:
        say("② 同步源码并做全量一致性校验")
        ok, out = run([PY, os.path.join(TEMP, "sync_deploy.py")])
        if not ok:
            say("❌ 校验未通过，已中止发布（线上未改动）")
            return 1
        new_build = read_build(DST)
        print("[发布] 目标构建号：%s" % new_build)
    else:
        new_build = read_build(DST)

    say("③ 部署到 Cloudflare Pages")
    if not deploy():
        say("❌ 部署失败（线上仍是上一版）。可手动重试：python temp/cf_browser_deploy.py")
        return 1

    say("④ 等待边缘生效（构建号 %s）" % new_build)
    live_ok = wait_for_build(new_build)

    say("⑤ 生产环境自检（真实浏览器跑一遍所有功能层）")
    ok, data, out = prod_check_retry(2, 10)
    if not data:
        print(out[-1500:])
    else:
        for c in data.get("checks", []):
            print("   %s %s%s" % ("✓" if c.get("ok") else "✗", c.get("name"), ("（%s）" % c.get("detail")) if c.get("detail") else ""))

    if ok and live_ok:
        save_lastgood()
        say("✅ 发布成功（用时 %.0f 秒）\n线上构建号：%s" % (time.time() - t0, read_build(DST) or "未知"))
        return 0

    say("⚠️ 自检未通过 —— 新版本可能影响线上功能")
    if NO_ROLLBACK:
        print("（已指定 --no-rollback，保留新版本供排查）")
        return 1

    say("⑥ 自动回滚到最后一个已知良好版本（构建号 %s）" % (prev_build or "未知"))
    if not restore():
        return 1
    if not deploy():
        say("❌ 回滚部署失败，请立即手动执行：python temp/cf_browser_deploy.py")
        return 1
    wait_for_build(read_build(DST), 150)

    say("⑦ 回滚后复检")
    ok2, data2, out2 = prod_check_retry(2, 8)
    if ok2:
        say("✅ 已回滚，线上恢复正常（构建号 %s）\n请修复问题后重新发布。" % (read_build(DST) or "未知"))
    else:
        say("❌ 回滚后仍不健康，请立即人工介入")
        if data2:
            for c in data2.get("checks", []):
                if not c.get("ok"):
                    print("   ✗ %s（%s）" % (c.get("name"), c.get("detail")))
    return 1


if __name__ == "__main__":
    sys.exit(main())
