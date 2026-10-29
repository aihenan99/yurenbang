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
 *          → 默认只报告；**到 P0_DEADLINE 自动转严格模式**，或手动加 --strict
 *
 * 为什么要期限（2026-10-29 审核 M14）：只提示不拦截的检查等于没有期限的欠条，
 * 云恢复后很容易「忘了开 strict」，P0 就永远挂着。到期自动收紧，逼一次明确决定：
 * 要么把 P0 清零，要么改日期并在提交信息里写清为什么还不行。
 *
 * 用法：
 *   node scripts/privacy-audit.mjs            报告 + 回归项门禁
 *   node scripts/privacy-audit.mjs --strict   连 P0 一起拦（不等期限，立即严格）
 * ========================================================================== */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "yurenbang-app");

/* P0 整改期限（M14）：到这天起自动按严格模式跑，P0 未清零即失败。
 * 依据：云额度预计 2026-11-01 恢复，留一个月做注销/导出/儿童留痕。
 * 要改日期，请在提交信息里写明原因——这条是提醒，不是枷锁，但必须是有意识的决定。 */
const P0_DEADLINE = "2026-12-01";
const TODAY = new Date().toISOString().slice(0, 10);
const P0_EXPIRED = TODAY >= P0_DEADLINE;
const STRICT_ARG = process.argv.includes("--strict");
const STRICT = STRICT_ARG || P0_EXPIRED;

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

/* 7. 设置页不得出现虚假状态（2026-10-28 整改后锁死，防回潮）
   只认 UI 文案，不认注释——注释里写「删掉了已实名标签」是事实描述，不是虚假状态 */
const FAKE_UI = [
  ["示例手机号", "138****8888"],
  ["微信绑定", 'chip:"已绑定"'],
  ["实名认证", 't:"实名认证"'],
  ["已认证标签", 'chip:"已认证"'],
  ["已实名标签", ">已实名<"],
];
const fakeHits = [];
for (const [f, t] of Object.entries(allAssets)) {
  for (const [name, pat] of FAKE_UI) {
    if (t.includes(pat)) fakeHits.push(name + " @" + f + ":" + findLine(t, pat));
  }
}
for (const [name, pat] of FAKE_UI) {
  if (idx.includes(pat)) fakeHits.push(name + " @yurenbang-app.html:" + findLine(idx, pat));
}
add(regress, "设置页零虚假状态（手机号 / 微信绑定 / 实名）", fakeHits.length === 0, fakeHits.join(" / "));

/* 8. 隐私页不得有装饰开关：没有真实字段支撑，就不该给用户一个点了没反应的开关 */
const privacyRow = (() => {
  const s = app.indexOf('privacy:{t:"隐私与个人信息"');
  const e = app.indexOf("\n  pay:{", s);
  return s >= 0 && e > s ? app.slice(s, e) : "";
})();
const swCount = (privacyRow.match(/sw\s*:/g) || []).length;
add(regress, "隐私页无装饰开关（只放真实正文入口）", swCount === 0,
  swCount ? swCount + " 个开关仍无字段支撑" : "0 个开关");

/* 8b. 全站设置子页也不许挂装饰开关（2026-10-29 审核：支付/通用/聊天/播放四页已清干净，锁死不许回潮） */
const swAll = (app.match(/sw\s*:\s*[01]/g) || []).length;
add(regress, "设置子页无装饰开关（全站 sw: 清零）", swAll === 0,
  swAll ? swAll + " 处仍挂点了没反应的开关" : "0 处");

/* 8c. 不得编造容量数字（"已清理 236 MB" 这类假进度条文案）——
   只匹配字符串字面量，注释里提到历史写法不算。 */
const fakeNum = /["'`]已清理\s*\d+\s*(?:MB|GB)|["'`]已释放\s*\d+\s*(?:MB|GB)/.test(app);
add(regress, "无编造的清理容量数字", !fakeNum, fakeNum ? "存在硬编码容量文案" : "");

/* 9. 政策必备条款（PIPL 17/31/52/57 + 审核口径）——v2 已补齐，此后不许再缺 */
const pStart = cloud.indexOf('privacy:{t:"育人帮隐私政策"');
const pEnd = cloud.indexOf('child:{t:"儿童个人信息处理规则"');
const policyText = pStart >= 0 && pEnd > pStart ? cloud.slice(pStart, pEnd) : "";
const required = [
  ["处理者身份", /运营主体|公司名称|处理者/],
  ["联系方式非示例邮箱", null],   // 反向：不得出现 example 邮箱
  ["保护负责人", /保护负责人|个人信息保护负责人/],
  ["第三方 SDK 清单", /SDK/],
  ["敏感信息单独同意", /单独同意/],
  ["跨境传输", /跨境|境外/],
  ["安全事件通知", /泄露|安全事件/],
  ["生效日期/版本", /生效日期|版本|v\d\.\d/],
  ["投诉渠道", /投诉|12377/],
  ["未成年人专节", /不满 14 周岁|儿童个人信息/]
];
const missing = required.filter(([n, re]) =>
  re ? !re.test(policyText) : (/support@|@yurenbang\.example/.test(policyText))
).map(([n]) => n);
add(regress, "隐私政策含 PIPL 必备条款", !!policyText && missing.length === 0,
  !policyText ? "未找到政策正文" : (missing.length ? "缺：" + missing.join("、") : required.length + " 项齐全"));

/* 10. 政策版本与设置页入口一致（改了正文要同步版本号，否则用户看到的版本是假的） */
const pTag = (policyText.match(/tag:"(v[\d.]+)"/) || [])[1] || "";
add(regress, "政策版本号与设置页一致", !!pTag && app.includes("隐私政策") && new RegExp(pTag.replace(/\./g, "\\.") + " ›").test(app),
  pTag ? "正文 " + pTag : "正文缺版本号");

/* ═══════════ 二、P0：承诺了但还没实现（审核硬伤） ═══════════ */

/* P0-1 注销账号：不能只是文案，必须有真实删除实现（恢复后第一批做） */
const hasDeleteImpl = /deleteAccount|yb_account_delete|purgeAccount|delete_my_account/.test(allText);
add(p0, "注销账号 / 自助删除账号", hasDeleteImpl,
  hasDeleteImpl ? "已实现" : "未实现；政策第十节已如实标注「过渡期经反馈渠道人工处理」，云恢复后第一批补");

/* P0-2 儿童信息：必须有监护人同意留痕机制 */
const childConsent = /监护人|guardian/i.test(allText) && /consent|同意记录|consented_at/.test(allText);
add(p0, "儿童信息监护人同意留痕", childConsent,
  childConsent ? "" : "仅提示文案，无同意记录字段（PIPL 31 单独同意）");

/* P0-3 数据导出（可携带权）：只认代码实现，政策里写「即将上线」不算 */
const canExport = /exportData|data_export|exportMyData|downloadMyData/.test(allText);
add(p0, "个人信息导出（可携带权）", canExport, canExport ? "" : "当前仅人工渠道，结构化导出待恢复后上线");

/* P0-4 不得从境外 CDN 加载脚本（IP/UA 出境 + 可用性） */
const foreign = [];
for (const [f, t] of Object.entries(allAssets)) {
  for (const m of t.matchAll(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|ajax\.googleapis\.com)/g)) {
    foreign.push(f + ":" + lineOf(t, m.index));
  }
}
add(p0, "零境外 CDN 加载", foreign.length === 0, foreign.slice(0, 4).join(", "));

/* ═══════════ 输出 ═══════════ */
let bad = 0;
const print = (bucket, tag, color) => {
  for (const r of bucket) {
    if (!r.ok) bad++;
    console.log("  " + (r.ok ? C.g + "✓" : color + "✗") + C.x + " [" + tag + "] " + r.name +
      C.d + (r.note ? "  " + r.note : "") + C.x);
  }
};

console.log(C.b + "\n育人帮 · 隐私合规自检" + C.x + C.d +
  (STRICT ? (STRICT_ARG ? "（严格模式）" : "（严格模式 · P0 期限 " + P0_DEADLINE + " 已到，自动收紧）") : "") + C.x + "\n");
print(regress, "回归", C.r);
print(p0, "P0", C.y);
if (!STRICT) {
  console.log(C.d + "  P0 整改期限 " + P0_DEADLINE + "：到期自动转严格模式（未清零即失败）" + C.x);
}

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
