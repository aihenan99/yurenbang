#!/usr/bin/env node
/* ============================================================================
 * 育人帮 · 被白名单放行目录的独立泄密守卫（scripts/secret-hygiene.mjs）
 *
 * 为什么要有这个脚本：
 *   .gitleaks.toml 为了让全历史扫描能过，对 `tests/` 和 `docs/` 做了**整目录
 *   放行**——那里面确实有假 token、假手机号、公开的 publishable key，逐条列
 *   太脆。但整目录放行有个副作用：**以后真往这两个目录里写了真密钥，gitleaks
 *   也不会吭声**。白名单一旦变宽，守卫就必须变严，否则等于自己给自己开洞。
 *
 *   所以这里不看"值是不是假占位"，只看"形态是不是真凭据"，用一组**高精度、
 *   低误报**的规则独立扫一遍。真正的密钥形态（私钥块、云厂商 access key、
 *   各家 token 前缀）在测试与文档里没有任何正当理由出现，命中即失败。
 *
 * 豁免：行内写 `secret-hygiene:allow` 注释即可（仅当确实是格式相同的假数据，
 *      且要在同文件注释里写清为什么要豁免）。
 *
 * 只读文件，不联网。退出码：0 干净；1 有命中。
 * ========================================================================== */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* 扫描范围 = .gitleaks.toml 里被整目录放行的位置。别处由 gitleaks 自己管。 */
const SCOPE = ["tests", "docs", "temp"];

/* 该目录下这些子路径是产物/依赖/二进制，不扫 */
const SKIP_DIR = /(^|\/)(node_modules|\.cache|pw|pk|edgeprofile|screenshots|shots)(\/|$)/;
const SKIP_FILE = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|pptx?|docx?|xlsx?|mp[34]|wav|woff2?|ttf|otf)$/i;

/* 高精度规则：命中即真凭据形态。故意不放大而全的 "generic api key" ——那个误报太多，
   放行目录里本来就有大量假占位，会把守卫逼成摆设。 */
const RULES = [
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["openai-key", /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["slack-token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["stripe-live-key", /\bsk_live_[0-9A-Za-z]{20,}\b/],
  ["supabase-secret", /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
  ["supabase-token", /\bsbp_[0-9a-f]{40}\b/],
  /* JWT 里带 service_role = 能绕过 RLS 的钥匙，这在任何目录里都不该出现 */
  ["service-role-jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*"role"\s*:\s*"service_role"/],
];

const ALLOW_MARK = "secret-hygiene:allow";

/* 管理员手机号（2026-11-05 加）：唯一合法出处是 config/admin.local.json（.gitignore 已屏蔽），
   任何入库文件里出现真号都算泄露。加这条是因为 11-05 清理时发现 8 个历史诊断脚本
   把号写死在代码里 —— gitleaks 对 tests/ 整目录放行，谁都没报。号从配置读，不写进本脚本。 */
function adminPhoneDigits() {
  try {
    const p = join(ROOT, "config", "admin.local.json");
    if (!existsSync(p)) return "";
    const j = JSON.parse(readFileSync(p, "utf8"));
    const d = String((j.phones || [])[0] || "").replace(/\D/g, "");
    return d.length >= 7 ? d : "";
  } catch (_) {
    return "";
  }
}
const ADMIN_DIGITS = adminPhoneDigits();
const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", d: "", b: "", x: "" };

const findings = [];
let scanned = 0;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (SKIP_DIR.test(rel)) continue;
      walk(p);
      continue;
    }
    if (!e.isFile() || SKIP_FILE.test(e.name)) continue;
    if (statSync(p).size > 2 * 1024 * 1024) continue;   /* 超大文本不扫，避免卡死 */
    let text;
    try { text = readFileSync(p, "utf8"); } catch (_) { continue; }
    if (text.indexOf("\u0000") >= 0) continue;          /* 二进制 */
    scanned++;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(ALLOW_MARK)) continue;
      /* 手机号单独判：允许 +86 / 空格 / 横线等写法差异，所以先抹掉非数字再找 */
      if (ADMIN_DIGITS && line.replace(/\D/g, "").includes(ADMIN_DIGITS)) {
        findings.push({ rel, line: i + 1, rule: "admin-phone", preview: "管理员手机号(已隐去)" });
      }
      for (const [rule, re] of RULES) {
        const m = line.match(re);
        if (!m) continue;
        const s = m[0];
        findings.push({ rel, line: i + 1, rule, preview: s.slice(0, 8) + "…(" + s.length + ")" });
      }
    }
  }
}

console.log(C.b + "\n被白名单放行目录的独立泄密守卫" + C.x + C.d + "（范围：" + SCOPE.join(" / ") + "）" + C.x + "\n");

for (const d of SCOPE) walk(join(ROOT, d));

if (findings.length === 0) {
  console.log("  " + C.g + "✓" + C.x + " 未发现真凭据形态 " + C.d + "（" + scanned + " 个文本文件，规则 " +
    (RULES.length + (ADMIN_DIGITS ? 1 : 0)) + " 条" + (ADMIN_DIGITS ? "" : "；config/admin.local.json 缺失，手机号规则未启用") + "）" + C.x);
  console.log("\n" + C.g + "✓ 干净" + C.x + C.d + " —— tests//docs//temp/ 虽被 gitleaks 整目录放行，但这里独立把关" + C.x + "\n");
  process.exit(0);
}

for (const f of findings) {
  console.log("  " + C.r + "✗" + C.x + " " + f.rel + ":" + f.line + "  " + C.b + f.rule + C.x + C.d + "  " + f.preview + C.x);
}
console.log("\n" + C.r + "✗ " + findings.length + " 处像真凭据" + C.x +
  C.d + " —— 是假数据就加 " + ALLOW_MARK + " 行内注释；是真密钥就立刻轮换，并从历史里清掉（见 docs/安全基线.md）" + C.x + "\n");
process.exit(1);
