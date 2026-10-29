#!/usr/bin/env node
/* ============================================================================
 * 状态边界静态审计（state-audit.mjs）
 *
 * 回答一个问题：**有没有哪一层写了不该它写的全局状态字段？**
 *
 * 做法：扫描全部功能层源码里的 `S.xxx =` / `S.posts.push(` 这类写入，
 * 与 assets/state.schema.js 的 writable 白名单比对。不需要启动浏览器，
 * 几毫秒出结果，可以直接放在 pre-commit 里。
 *
 * 用法：
 *   node scripts/state-audit.mjs            # 人类可读
 *   node scripts/state-audit.mjs --json     # 机器可读（CI）
 *   node scripts/state-audit.mjs --verbose  # 连合规写入也列出来
 * ========================================================================== */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "yurenbang-app", "assets");
const schema = require(join(ASSETS, "state.schema.js"));

const JSON_OUT = process.argv.includes("--json");
const VERBOSE = process.argv.includes("--verbose");

/* 写入语法：赋值、自增、以及会改动数组内容的方法 */
const WRITE_RE =
  /\bS\.([A-Za-z_$][\w$]*)\s*(?:\+\+|--|=(?![=>])|\+=|-=|\*=|\/=|\.(?:push|splice|unshift|pop|shift|sort|reverse|fill|copyWithin)\s*\()/g;

/* 去掉行内注释，避免把说明文字当成代码 */
function stripComment(line) {
  const i = line.indexOf("//");
  if (i < 0) return line;
  /* 粗略判断：// 之前不能是 : （否则是 http:// 之类），够用 */
  const before = line.slice(0, i);
  if (/https?:$/.test(before.trim())) return line;
  return before;
}

const files = readdirSync(ASSETS)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => f !== "bundle.js" && f !== "state.js" && f !== "state.schema.js");

const findings = [];
for (const file of files) {
  const layer = file.replace(/\.js$/, "");
  const lines = readFileSync(join(ASSETS, file), "utf8").split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = stripComment(raw);
    if (!line || !line.includes("S.")) return;
    WRITE_RE.lastIndex = 0;
    let m;
    while ((m = WRITE_RE.exec(line))) {
      const field = m[1];
      findings.push({ layer, file, line: idx + 1, field, code: raw.trim().slice(0, 110) });
    }
  });
}

/* ---------- 比对契约 ---------- */
const unknown = [];
const illegal = [];
const legal = [];

/* 2026-10-29 审核修复（铁律机器化）：云投影数组是「整体替换」铁律管辖的字段——
   无论哪一层有 writable 权，都不许用 push/unshift/splice 这类原地方法改。
   （schema 里 note 写了铁律，但此前只是散文；这里让它真正拦得住，见审核报告 H1/H2） */
const METHOD_BAN = new Set(["posts", "cases"]);

for (const f of findings) {
  const def = schema.fields[f.field];
  if (!def) { unknown.push(f); continue; }
  if (METHOD_BAN.has(f.field) && /\.\s*(?:push|splice|unshift|pop|shift|sort|reverse|fill|copyWithin)\s*\(/.test(f.code)) {
    illegal.push({ ...f, allow: ["<整体替换>"], ban: true }); continue;
  }
  if (!(def.writable || []).includes(f.layer)) { illegal.push({ ...f, allow: def.writable }); continue; }
  legal.push(f);
}

/* ---------- 汇总：字段 × 写入层 ---------- */
const byField = new Map();
for (const f of findings) {
  if (!byField.has(f.field)) byField.set(f.field, new Map());
  const m = byField.get(f.field);
  m.set(f.layer, (m.get(f.layer) || 0) + 1);
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: unknown.length === 0 && illegal.length === 0,
    scanned: files.length,
    writes: findings.length,
    fields: byField.size,
    unknown, illegal,
    legalCount: legal.length
  }, null, 2));
  process.exit(unknown.length === 0 && illegal.length === 0 ? 0 : 1);
}

console.log("状态边界审计 · 契约 v" + schema.version + "（" + schema.updated + "）");
console.log("扫描 " + files.length + " 个功能层，命中 " + findings.length + " 处写入，涉及 " +
  byField.size + " 个字段\n");

/* 字段 × 层 矩阵 */
const rows = [...byField.entries()]
  .map(([field, m]) => ({
    字段: field,
    次数: [...m.values()].reduce((a, b) => a + b, 0),
    写入层: [...m.entries()].map(([l, n]) => l + ":" + n).join(" "),
    状态: schema.fields[field] ? "已登记" : "未登记"
  }))
  .sort((a, b) => b.次数 - a.次数);

const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
console.log(pad("字段", 16) + pad("次数", 6) + pad("状态", 8) + "写入层");
console.log("-".repeat(72));
for (const r of rows) {
  console.log(pad(r.字段, 16) + pad(r.次数, 6) + pad(r.状态, 8) + r.写入层);
}

if (VERBOSE) {
  console.log("\n合规写入明细：");
  for (const f of legal) console.log("  ✓ " + f.file + ":" + f.line + "  S." + f.field);
}

let bad = 0;
if (unknown.length) {
  bad += unknown.length;
  console.log("\n✗ 未登记字段 " + unknown.length + " 处（请先在 assets/state.schema.js 登记）：");
  for (const f of unknown) console.log("   " + f.file + ":" + f.line + "  S." + f.field + "   " + f.code);
}
if (illegal.length) {
  bad += illegal.length;
  console.log("\n✗ 越界写入 " + illegal.length + " 处（该字段只允许 " +
    [...new Set(illegal.map((f) => f.ban ? "<整体替换>（禁原地方法）" : (f.allow.join("/"))) )].join(" ; ") + " 写）：");
  for (const f of illegal) console.log("   " + f.file + ":" + f.line + "  S." + f.field + "   " + f.code);
}

if (bad === 0) {
  console.log("\n✓ 全部写入都在契约内（" + legal.length + " 处）");
  process.exit(0);
}
console.log("\n共 " + bad + " 处需要处理");
process.exit(1);
