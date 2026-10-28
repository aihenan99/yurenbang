#!/usr/bin/env node
/* ============================================================================
 * 隐私合规自检（privacy-audit.mjs）
 *
 * 为什么需要：隐私问题不是"写完文档就完了"——代码一改，承诺就可能悄悄失效。
 * 这个脚本把《隐私政策》里的承诺**变成可执行断言**，每次提交都验一遍。
 *
 * 两级：
 *   [回归] 已经做到、绝不允许退化的（同意闸门 / 政策正文 / 限时签名 / 脱敏）
 *          → 失败即 exit 1，接进 verify
 *   [P0]   承诺了但还没实现的（注销 / 虚假状态 / 假开关 / 政策缺项 / 境外 CDN）
 *          → 默认只报告，加 --strict 才失败（整改完成后开严格模式，从此锁死）
 *
 * 用法：
 *   node scripts/privacy-audit.mjs            报告 + 回归项门禁
 *   node scripts/privacy-audit.mjs --strict   连 P0 一起拦（整改完成后启用）
 * ========================================================================== */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "yurenbang-app");
const STRICT = process.argv.includes("--strict");

const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[1m", d: "\x1b[90m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", b: "", d: "", x: "" };

const read = (rel) => {
  const p = join(SRC, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
const lineOf = (txt, idx) => txt.slice(0, idx).split("\n").length;
const findLine = (txt, needle) => {
  const i = txt.indexOf(needle);
  return i < 0 ? 0 : lineOf(txt, i);
};

const allAssets = {};
for (const f of readdirSync(join(SRC, "assets"))) {
  if (f.endsWith(".js")) allAssets[f] = read(`assets/${f}`);
}
const allText = Object.entries(allAssets).map(([f, t]) => "/*" + f + "*/\n" + t).join("\n");
const cloud = allAssets["cloud.js"] || "";
const app = allAssets["app.js"] || "";
const account = allAssets["account.js"] || "";
const schema = read("assets/state.schema.js");
const idx = read("yurenbang-app.html");

const regress = [];   // {name, ok, note}
const p0 = [];        // {name, ok, note}
const add = (bucket, name, ok, note = "") => bucket.push({ name, ok, note });

/* ═══════════ 一、回归项：已做到，不许退化 ═══════════ */

/* 1. 登录明示同意闸门：至少 3 处 agreeOk/needAgree 拦截（发码/登录/注册） */
const gateCount = (cloud.match(/if\s*\(\s*!\s*agreeOK\(\)\s*\)/g) || []).length;
add(regress, "登录明示同意闸门（未勾选不发码/不登录）", gateCount >= 3,
  gateCount + " 处拦截" + (gateCount < 3 ? "，应 ≥3" : ""));

/* 2. 协议与隐私政策正文必须在站内（不能只有链接） */
add(regress, "用户协议 + 隐私政策正文内置",
  /terms\s*:\s*\{/.test(cloud) && /privacy\s*:\s*\{/.test(cloud),
  "LG_DOCS " + (/LG_DOCS/.test(cloud) ? "存在" : "缺失"));

/* 3. 媒体必须走限时签名，不得拼公开直链 */
const signed = (cloud.match(/createSignedUrl/g) || []).length;
add(regress, "媒体限时签名地址（非公开直链）", signed >= 2 && /createSignedUrl\([^)]*,\s*3600/.test(cloud),
  signed + " 处签名调用，TTL 3600s");

/* 4. 手机号展示必须脱敏 */
const masked = (account.match(/maskPhone/g) || []).length;
add(regress, "手机号展示脱敏（maskPhone）", masked >= 3, masked + " 处脱敏调用");

/* 5. 同意文案与入口必须可读（无障碍） */
add(regress, "同意勾选有无障碍语义（role=checkbox）",
  /role="checkbox"/.test(cloud) && /aria-checked/.test(cloud), "");

/* 6. 隐私政策必须有一等公民入口（我的-设置 内可见） */
add(regress, "协议/政策有站内常驻入口", /agreement\s*:\s*\{/.test(app), "app.js SETTINGS.agreement");

/* ═══════════ 二、P0：承诺了但没实现（审核硬伤） ═══════════ */

/* P0-1 注销账号：不能只是静态文案 */
const hasDeleteImpl = /deleteAccount|yb_account_delete|purgeAccount|delete_my_account/.test(allText);
const claimsDelete = /注销账号/.test(app);
add(p0, "注销账号真实可用（非静态文案）", !claimsDelete || hasDeleteImpl,
  claimsDelete && !hasDeleteImpl
    ? "app.js:" + findLine(app, "注销账号") + " 写了「注销账号」，全项目无删除逻辑——政策承诺 15 工作日删除"
    : hasDeleteImpl ? "已实现" : "未出现注销入口");

/* P0-2 设置页不得展示虚假状态 */
const fakeStatus = [];
for (const pat of ["138****8888", "已认证", "已绑定"]) {
  if (app.includes(pat)) fakeStatus.push(pat + " @app.js:" + findLine(app, pat));
}
add(p0, "设置页无虚假状态（手机号/微信/实名）", fakeStatus.length === 0, fakeStatus.join(" / "));

/* P0-3 隐私开关必须落地（有字段/有读写），否则就是装饰 */
const privacyRow = (app.match(/privacy\s*:\s*\{[\s\S]*?\}\]\)\}/) || [""])[0];
const swCount = (privacyRow.match(/sw\s*:/g) || []).length;
const backed = ["public", "comments_open", "personalized", "tongcheng"].some((k) => schema.includes(k) || allText.includes("privacy_prefs"));
add(p0, "隐私设置开关有真实效果", swCount === 0 || backed,
  swCount ? swCount + " 个开关，契约/存储中无对应字段" : "已移除装饰开关");

/* P0-4 隐私政策必备条款（PIPL 17/31/52/57 + 审核口径） */
const policyText = (cloud.match(/privacy\s*:\s*\{t:[\s\S]*?\}\s*\}\s*;/) || [cloud])[0];
const required = [
  ["处理者身份", /运营主体|公司名称|处理者/],
  ["联系方式非示例", /support@|@yurenbang\.example/],
  ["保护负责人", /保护负责人|个人信息保护负责人/],
  ["第三方 SDK 清单", /SDK/],
  ["敏感信息单独同意", /单独同意/],
  ["跨境传输", /跨境|境外/],
  ["安全事件通知", /泄露|安全事件/],
  ["生效日期/版本", /生效日期|版本|v\d\.\d/],
  ["投诉渠道", /投诉|12377/]
];
const missing = required.filter(([n, re]) => !re.test(policyText)).map(([n]) => n);
add(p0, "隐私政策含 PIPL 必备条款", missing.length === 0,
  missing.length ? "缺：" + missing.join("、") : "齐全");

/* P0-5 不得从境外 CDN 加载脚本（IP/UA 出境 + 可用性） */
const foreign = [];
for (const [f, t] of Object.entries(allAssets)) {
  for (const m of t.matchAll(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|ajax\.googleapis\.com)/g)) {
    foreign.push(f + ":" + lineOf(t, m.index));
  }
}
add(p0, "零境外 CDN 加载", foreign.length === 0, foreign.slice(0, 4).join(", "));

/* P0-6 儿童信息：必须有监护人同意留痕机制 */
const childConsent = /监护人|guardian/i.test(allText) && /consent|同意记录|consented_at/.test(allText);
add(p0, "儿童信息监护人同意留痕", childConsent,
  childConsent ? "" : "仅有文案提示，无同意记录字段（PIPL 31 单独同意）");

/* P0-7 数据导出（可携带权） */
const canExport = /exportData|导出.*数据|data_export/.test(allText);
add(p0, "个人信息导出（可携带权）", canExport, canExport ? "" : "仅「反馈与帮助」人工处理");

/* ═══════════ 输出 ═══════════ */
let bad = 0;
const print = (bucket, tag, color) => {
  for (const r of bucket) {
    if (!r.ok) bad++;
    console.log("  " + (r.ok ? C.g + "✓" : color + "✗") + C.x + " [" + tag + "] " + r.name +
      C.d + (r.note ? "  " + r.note : "") + C.x);
  }
};

console.log(C.b + "\n育人帮 · 隐私合规自检" + C.x + C.d + (STRICT ? "（严格模式）" : "") + C.x + "\n");
print(regress, "回归", C.r);
print(p0, "P0", C.y);

const regressBad = regress.filter((r) => !r.ok).length;
const p0Bad = p0.filter((r) => !r.ok).length;
console.log("");
console.log(C.d + "回归项 " + (regress.length - regressBad) + "/" + regress.length + " 通过；" +
  "P0 待整改 " + p0Bad + " 项（详见 docs/隐私与数据安全评估.md）" + C.x);

if (regressBad || (STRICT && p0Bad)) {
  console.log(C.r + "✗ 未通过" + C.x + (regressBad ? "（回归项退化必须立刻修）" : "（严格模式：P0 未清零）") + "\n");
  process.exit(1);
}
console.log(C.g + "✓ 通过" + C.x + "\n");
