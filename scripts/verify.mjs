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
 *   --e2e    再加浏览器端到端（8 组 / 124 断言，需 8796 与 8793 两个本地服务）
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

/* ---------- 3. 层登记一致性：加层四处登记有没有漏 ---------- */
step("层登记一致性（html / sw / health / build.json）", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "layers-audit.mjs")], {
    encoding: "utf8"
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) {
    const bad = out.split("\n").filter((l) => l.includes("✗")).map((l) => l.trim());
    throw new Error(bad.slice(0, 3).join(" / ") || "审计未通过");
  }
  const n = out.split("\n").filter((l) => l.includes("✓")).length;
  const m = out.match(/（(\d+) 层）/);
  return { ok: true, msg: n + " 项约束" + (m ? "，" + m[1] + " 层" : "") };
});

/* ---------- 4. 仓库卫生：不该进版本库的东西 ---------- */
step("仓库卫生：无超大文件 / 无环境变量 / temp 无测试脚本", () => {
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

  /* 目录边界守卫（2026-10-28 迁移后新增）：
     temp/ 只放构建发布工具与素材，测试脚本一律在 tests/。
     少了这条，过几个月又会有人把调试脚本丢回 temp/。 */
  const strayTests = readdirSync(join(ROOT, "temp"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => "temp/" + f);
  if (strayTests.length) {
    throw new Error("temp/ 里出现测试脚本，请移到 tests/scenario 或 tests/diag：" + strayTests.slice(0, 5).join(", "));
  }

  if (bad.length) throw new Error("请移出版本库或加进 .gitignore：" + bad.slice(0, 5).join(", "));
  return { ok: true, msg: "temp/ 无游离测试脚本" };
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
  /* 两条测试线：8796 跑源码（开发快、能测未打包的层）；
     8793 跑项目根（/deploy-cn/，验的是「打包产物能不能独立活起来」）。
     服务没起时整组跳过而不是失败——本机不想开服务也不该拦住提交。 */
  const LINES = [
    {
      port: 8796, base: "http://127.0.0.1:8796/yurenbang-app.html", label: "源码 8796",
      dir: "tests/core",
      tests: [
        ["图文编辑器全流程", "casedit-test.js"],
        ["状态守卫接管写入", "state-guard-test.js"],
        ["分享长图生成", "longimg-test.js"],
        ["举报落库与断网补发", "report-test.js"]
      ]
    },
    {
      port: 8793, base: "http://127.0.0.1:8793/deploy-cn/", label: "部署包 8793",
      dir: "tests/core",
      tests: [
        ["部署包冒烟（层完整/无404/无自愈）", "bundle-test.js"],
        ["首页栏目配置", "chips-test.js"],
        ["PPT 封面渲染与缓存", "cover-test.js"],
        ["全局异常兜底", "guard-test.js"],
        ["云端深度体检", "deepcheck-test.js"]
      ]
    }
  ];

  const alive = {};
  for (const line of LINES) {
    try {
      const r = await fetch(line.base, { signal: AbortSignal.timeout(2500) });
      alive[line.port] = r.status < 500;
    } catch (_) { alive[line.port] = false; }
  }

  /* 从测试输出里抽「N 通过, M 失败」——各脚本格式统一，一定在最后几行 */
  const summaryOf = (out) => {
    const m = [...out.matchAll(/(\d+)\s*通过[^\d]{0,6}(\d+)\s*失败/g)].pop();
    return m ? { pass: +m[1], fail: +m[2], text: m[1] + " 通过 / " + m[2] + " 失败" } : null;
  };

  for (const line of LINES) {
    if (!alive[line.port]) {
      console.log("  " + C.d + "跳过  " + line.label + " 整组（服务未启动：npm run serve 起 8796，" +
        "python -m http.server 8793 起根目录）" + C.x);
      continue;
    }
    for (const [name, file] of line.tests) {
      step("端到端：" + name + "（" + line.label + "）", () => {
        const t0 = Date.now();
        const r = spawnSync(process.execPath, [join(ROOT, line.dir, file)], {
          cwd: join(ROOT, line.dir), encoding: "utf8", timeout: 180000
        });
        const out = (r.stdout || "") + (r.stderr || "");
        const s = summaryOf(out);
        if (r.status !== 0) {
          const bad = out.split("\n").filter((l) => l.includes("✗")).map((l) => l.trim());
          const fatal = out.split("\n").filter((l) => /FATAL|Error:/.test(l)).slice(-1)[0] || "";
          throw new Error((bad.slice(0, 3).join(" / ") || fatal || "退出码 " + r.status).slice(0, 220));
        }
        return { ok: true, msg: (s ? s.text : "通过") + C.d + "  " + (Date.now() - t0) + "ms" + C.x };
      });
    }
  }
} else {
  console.log("  " + C.d + "跳过  端到端 8 项（加 --e2e 且 8796/8793 服务已启动时才跑）" + C.x);
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
