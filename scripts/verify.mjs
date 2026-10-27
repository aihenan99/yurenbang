#!/usr/bin/env node
/* ============================================================================
 * 育人帮 · 统一验证入口（verify.mjs）
 *
 * 目的：把散落在 temp/ 的 180+ 个检查脚本收成一个「一条命令就知道有没有事」的入口。
 * 以前的问题是：安全带很多，但没人系——测试跑不跑全看记性。
 *
 * 分级：
 *   --fast   语法 + 状态边界 + 敏感文件   （几秒，pre-commit 用）
 *   默认     再加部署一致性              （十几秒，pre-push / 手动用）
 *   --e2e    再加浏览器端到端            （需本地服务，CI 或发版前用）
 *
 * 退出码：0 全通过；1 有失败。CI 与 git hook 都靠这个判断。
 * ========================================================================== */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const T_START = Date.now();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "yurenbang-app");
const FAST = process.argv.includes("--fast");
const E2E = process.argv.includes("--e2e");

const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", d: "", b: "", x: "" };

const results = [];
let failed = 0;

function step(name, fn, { optional = false } = {}) {
  const t0 = Date.now();
  let r;
  try {
    r = fn();
  } catch (e) {
    r = { ok: false, msg: String(e && e.message ? e.message : e) };
  }
  const ms = Date.now() - t0;
  const ok = r && r.ok;
  if (!ok && !optional) failed++;
  results.push({ name, ok, ms, msg: r && r.msg, skipped: r && r.skipped });
  const tag = r && r.skipped ? C.y + "跳过" + C.x : ok ? C.g + "通过" + C.x : C.r + "失败" + C.x;
  console.log("  " + tag + "  " + name + C.d + "  " + ms + "ms" + C.x +
    (r && r.msg ? "\n        " + C.d + r.msg + C.x : ""));
  return ok;
}

function nodeCheck(file, esm = false) {
  if (!esm) {
    /* 进程内编译：只解析不执行，比起 28 个 node 子进程快两个数量级 */
    try {
      new vm.Script(readFileSync(file, "utf8"), { filename: file });
    } catch (e) {
      throw new Error(relative(ROOT, file) + ": " + e.message);
    }
    return;
  }
  const r = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: readFileSync(file, "utf8"), encoding: "utf8"
  });
  if (r.status !== 0) throw new Error((r.stderr || "").split("\n").slice(0, 3).join(" "));
}

console.log(C.b + "\n育人帮 · 工程验证" + C.x + C.d +
  "（" + (FAST ? "快速" : E2E ? "含端到端" : "标准") + "）" + C.x + "\n");

/* ---------- 1. 语法：所有浏览器端脚本 + Worker ---------- */
step("语法检查：功能层与 Service Worker", () => {
  const files = readdirSync(join(SRC, "assets"))
    .filter((f) => f.endsWith(".js"))
    .filter((f) => f !== "bundle.js");           /* bundle 是产物，不查 */
  const list = files.map((f) => join(SRC, "assets", f));
  if (existsSync(join(SRC, "sw.js"))) list.push(join(SRC, "sw.js"));
  for (const f of list) nodeCheck(f);
  nodeCheck(join(SRC, "assets", "state.schema.js"));
  return { ok: true, msg: list.length + " 个文件" };
});

step("语法检查：_worker.js（ES Module）", () => {
  const p = join(ROOT, "deploy-cn", "_worker.js");
  if (!existsSync(p)) return { ok: false, msg: "缺少 deploy-cn/_worker.js" };
  nodeCheck(p, true);
  return { ok: true };
});

step("安全响应头：真的调用一次 Worker 核对 CSP/HSTS", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "worker-headers.mjs")], {
    encoding: "utf8"
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) {
    const bad = out.split("\n").filter((l) => l.includes("✗")).map((l) => l.trim());
    throw new Error(bad.slice(0, 4).join(" / ") || out.trim().split("\n").pop());
  }
  const n = out.split("\n").filter((l) => l.includes("✓")).length;
  return { ok: true, msg: n + " 项响应头约束" };
});

/* ---------- 2. 状态边界：有没有层乱写全局状态 ---------- */
step("状态边界审计（契约 vs 实际写入）", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "state-audit.mjs")], {
    encoding: "utf8"
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const last = out.trim().split("\n").slice(-1)[0] || "";
  if (r.status !== 0) {
    const bad = out.split("\n").filter((l) => l.includes("✗")).join(" | ");
    throw new Error(bad || last);
  }
  return { ok: true, msg: last.replace(/^✓\s*/, "") };
});

/* ---------- 3. 仓库卫生：不该进版本库的东西 ---------- */
step("仓库卫生：无超大文件 / 无环境变量文件", () => {
  const bad = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch (_) { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (st.size > 8 * 1024 * 1024) bad.push(relative(ROOT, p) + " " + (st.size / 1048576).toFixed(1) + "MB");
      if (/^\.env(\.|$)/.test(name)) bad.push(relative(ROOT, p));
    }
  };
  walk(SRC);
  walk(join(ROOT, "scripts"));
  if (bad.length) throw new Error("请移出版本库或加进 .gitignore：" + bad.slice(0, 5).join(", "));
  return { ok: true };
});

/* ---------- 4. 部署一致性：源码与待部署包是否同源 ---------- */
if (!FAST) {
  const PY = process.platform === "win32" ? "python" : "python3";
  step("部署一致性：deploy-cn 与源码同步且域名适配正确", () => {
    const py = spawnSync(PY, [join(ROOT, "temp", "sync_deploy.py"), "--check"], {
      encoding: "utf8", cwd: ROOT
    });
    if (py.error) return { ok: false, msg: "无法执行 " + PY + "（部署脚本依赖 Python 3）" };
    const out = (py.stdout || "") + (py.stderr || "");
    if (py.status !== 0) {
      const bad = out.split("\n").filter((l) => l.includes("✗")).map((l) => l.trim());
      throw new Error(bad.slice(0, 6).join(" / ") || "校验未通过");
    }
    const m = out.match(/通过\s*(\d+)\s*项/);
    const drift = (out.split("\n").find((l) => l.includes("[漂移]")) || "").trim();
    return {
      ok: true,
      msg: (m ? m[1] + " 项部署约束" : "") +
        (drift ? "\n        " + C.y + drift + C.x + C.d + " → 跑 npm run sync 同步" : "")
    };
  });
}

/* ---------- 5. 端到端（可选）：真实浏览器跑一遍关键流程 ---------- */
if (E2E) {
  const URL_BASE = "http://127.0.0.1:8796/yurenbang-app.html";
  let alive = false;
  try {
    const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(2000) });
    alive = r.ok;
  } catch (_) { alive = false; }

  step("端到端：图文编辑器全流程", () => {
    if (!alive) return { ok: true, skipped: true, msg: "未检测到 8796 服务，跳过（npm run serve 可启动）" };
    const r = spawnSync(process.execPath, [join(ROOT, "temp", "casedit-test.js")], {
      cwd: join(ROOT, "temp"), encoding: "utf8"
    });
    const out = (r.stdout || "") + (r.stderr || "");
    const line = out.split("\n").filter((l) => l.includes("通过 /")).pop() || "";
    if (r.status !== 0) throw new Error(line || out.split("\n").slice(-3).join(" "));
    return { ok: true, msg: line.trim() };
  });
} else {
  console.log("  " + C.d + "跳过  端到端（加 --e2e 且本地 8796 服务已启动时才跑）" + C.x);
}

/* ---------- 汇总 ---------- */
const pass = results.filter((r) => r.ok).length;
const skip = results.filter((r) => r.skipped).length;
console.log("");
if (failed === 0) {
  console.log(C.g + "✓ 全部通过" + C.x + C.d + "（" + pass + " 项" + (skip ? "，跳过 " + skip : "") +
    "，共 " + (Date.now() - T_START) + "ms）" + C.x + "\n");
  process.exit(0);
}
console.log(C.r + "✗ " + failed + " 项失败" + C.x + " —— 先修好再提交/发布\n");
process.exit(1);
