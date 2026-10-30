#!/usr/bin/env node
/* z-index 层级审计（2026-10-30）
 *
 * 为什么要有它：项目一直有一条口头约定「#modal 96 最高，新全屏层不得超」，
 * 但没有任何东西在守——`#vpFull` 早就悄悄到了 200，而 `#toast` 还是 75。
 * 结果就是：PPT 全屏里点任何按钮，提示都被压在下面，用户（尤其长辈）看到的是
 * 「点了没反应」。这类问题肉眼很难发现，静态扫描一次就能抓住。
 *
 * 规则：
 *   1. 层级必须落在下面的阶梯里（阶梯本身就是可读的架构文档）
 *   2. 任何超过「顶层内容面板」上限（96）的值，必须在 REGISTRY 里登记并写明理由；
 *      没登记 = 红，防止下次又有人随手写个 9999
 *   3. 登记表里过期（代码里已不存在）的条目也算问题——契约要说真话
 *
 * 用法：node scripts/zindex-audit.mjs [--verbose]
 */
"use strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "yurenbang-app");
const ASSETS = join(SRC, "assets");

/* ---------- 层级阶梯（唯一的真相来源） ---------- */
const TIERS = [
  { name: "层内装饰", min: 0, max: 9, note: "容器内部的叠加元素，不参与全局竞争" },
  { name: "页面骨架", min: 10, max: 39, note: "#app / #funcrow / 悬浮按钮" },
  { name: "全局浮层", min: 40, max: 59, note: "遮罩 / 标签栏 / 下拉 / 抽屉 / 半屏页" },
  { name: "面板与详情", min: 60, max: 79, note: "详情页 / 登录 / 礼物 / 举报 / 评论面板" },
  { name: "顶层内容", min: 80, max: 96, note: "#modal 是这里的上限，普通浮层不许越过它" },
  { name: "全屏媒体", min: 97, max: 999, note: "PPT 全屏 #vpFull 等独占屏幕的阅读层" },
  { name: "系统提示", min: 90000, max: 99996, note: "toast / 满屏感谢：必须盖过全屏媒体层" },
  { name: "强制提示", min: 99997, max: 99999, note: "升级提示 / 健康探针：盖过一切，含 toast" }
];

/* ---------- 超过 96 的登记表（改这里必须同时改代码） ---------- */
const REGISTRY = [
  { sel: "#vpFull", value: 200, why: "PPT 全屏阅读层，独占屏幕，必须盖住 #modal 与详情层" },
  { sel: "#toast", value: 99990, why: "提示条：全屏阅读里操作失败也要看得见，但仍在强制升级提示之下" },
  { sel: "#gift", value: 99989, why: "满屏感谢动画：同上，全屏里点赞也要有反馈" },
  { sel: "#yrbUpg", value: 99997, why: "强制升级面板：不许被任何页面内容或提示条遮住" },
  { sel: "#yrbHealthBar", value: 99998, why: "健康探针条：仅 ?health=1 时出现，排障时需要压住一切" },
  { sel: "#yrbUpgToast", value: 99991, why: "升级层的兜底提示气泡（window.toast 缺失时用），必须低于升级面板本身" }
];

/* ---------- 采集 ---------- */
function readTexts() {
  const out = [];
  for (const f of readdirSync(ASSETS)) {
    if (/\.(css|js)$/.test(f)) out.push({ name: "assets/" + f, text: readFileSync(join(ASSETS, f), "utf8") });
  }
  const html = join(SRC, "yurenbang-app.html");
  if (existsSync(html)) out.push({ name: "yurenbang-app.html", text: readFileSync(html, "utf8") });
  return out;
}

/* CSS：取每个声明块的选择器；JS/HTML 内联：取同一行里最近的 `#id{` 或类选择器 */
function cssSelectorAt(text, offset) {
  const upto = text.slice(0, offset);
  const open = upto.lastIndexOf("{");
  if (open < 0) return "";
  /* 块的起点：上一个 } 之后，或者上一个 { 之后（嵌套时取最近层的选择器） */
  const prevClose = upto.lastIndexOf("}", open);
  const prevOpen = upto.lastIndexOf("{", open - 1);
  const from = Math.max(prevClose, prevOpen) + 1;
  const sel = upto.slice(from, open).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  return sel.split("\n").pop().trim().slice(0, 60);
}

function inlineSelectorAt(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const line = text.slice(lineStart, offset);
  /* 就近取 `#id{` / `.cls{` 形式（同一行就有选择器的情况，如 health.js 的样式串） */
  const m = line.match(/([#.][A-Za-z][\w-]*)\s*\{/g);
  if (m && m.length) return m[m.length - 1].replace(/\s*\{/, "").trim();
  /* 同一行没有：往上找最近一次 `el.id = "x"` 赋值（动态创建的浮层大多这么写） */
  const back = text.slice(Math.max(0, lineStart - 800), offset);
  const ids = back.match(/\.id\s*=\s*["']([\w-]+)["']/g);
  if (ids && ids.length) return "#" + ids[ids.length - 1].replace(/.*["']([\w-]+)["']/, "$1");
  const sels = back.match(/#([A-Za-z][\w-]{2,})\s*\{/g);
  if (sels && sels.length) return sels[sels.length - 1].replace(/\s*\{/, "").trim();
  return "(内联样式)";
}

function collect() {
  const items = [];
  for (const { name, text } of readTexts()) {
    const re = /z-index\s*:\s*(-?\d+)/g;
    let m;
    while ((m = re.exec(text))) {
      const value = +m[1];
      const line = text.slice(0, m.index).split("\n").length;
      const sel = name.endsWith(".css") ? cssSelectorAt(text, m.index) : inlineSelectorAt(text, m.index);
      items.push({ value, file: name, line, sel: sel || "(未知选择器)" });
    }
  }
  return items;
}

/* ---------- 判定 ---------- */
const verbose = process.argv.includes("--verbose");
const items = collect();
const problems = [];
const notes = [];

function tierOf(v) {
  return TIERS.find((t) => v >= t.min && v <= t.max) || null;
}

/* 1) 每个值都要落在阶梯里 */
for (const it of items) {
  if (!tierOf(it.value)) {
    problems.push(`${it.file}:${it.line} ${it.sel} → z-index ${it.value} 不在任何层级区间（可能是随手写的「比谁都大」）`);
  }
}

/* 2) 超过 96 必须登记 */
const regKeys = new Set();
for (const it of items) {
  if (it.value <= 96) continue;
  const hit = REGISTRY.find((r) => r.sel === it.sel && r.value === it.value);
  if (hit) { regKeys.add(hit.sel + "|" + hit.value); continue; }
  /* 同一选择器登记过但值变了：明确指出漂移，比笼统的「未登记」好修 */
  const stale = REGISTRY.find((r) => r.sel === it.sel);
  if (stale) {
    problems.push(`${it.file}:${it.line} ${it.sel} → z-index ${it.value}，但契约登记的是 ${stale.value}：层级漂移，请同步 REGISTRY 与本文件`);
  } else {
    problems.push(`${it.file}:${it.line} ${it.sel} → z-index ${it.value} 越过 #modal(96) 且未登记理由`);
  }
}

/* 3) 登记表不许留过期条目 */
for (const r of REGISTRY) {
  if (!regKeys.has(r.sel + "|" + r.value)) {
    problems.push(`REGISTRY 里的 ${r.sel} = ${r.value} 在代码里找不到（已被删或改了值）：契约要删干净`);
  }
}

/* 4) 关键关系：提示层必须高于全屏媒体层（这是本轮真 bug 的回归锁） */
function zOf(sel) {
  const found = items.filter((it) => it.sel === sel).map((it) => it.value);
  return found.length ? Math.max.apply(null, found) : null;
}
const zToast = zOf("#toast"), zGift = zOf("#gift"), zFull = zOf("#vpFull"), zModal = zOf("#modal"), zUpg = zOf("#yrbUpg");
if (zToast !== null && zFull !== null && zToast <= zFull) {
  problems.push(`#toast(${zToast}) 必须高于 #vpFull(${zFull})：否则全屏阅读里的提示用户看不见`);
}
if (zGift !== null && zFull !== null && zGift <= zFull) {
  problems.push(`#gift(${zGift}) 必须高于 #vpFull(${zFull})：全屏里点赞的满屏感谢会被吞掉`);
}
if (zToast !== null && zUpg !== null && zToast >= zUpg) {
  problems.push(`#toast(${zToast}) 不该高于强制升级提示 #yrbUpg(${zUpg})`);
}
if (zModal !== null && zFull !== null && zModal >= zFull) {
  problems.push(`#modal(${zModal}) 应在全屏媒体层 #vpFull(${zFull}) 之下`);
}

/* ---------- 输出 ---------- */
const byValue = new Map();
for (const it of items) {
  if (!byValue.has(it.value)) byValue.set(it.value, []);
  byValue.get(it.value).push(it);
}

console.log("层级阶梯：");
for (const t of TIERS) {
  const hit = items.filter((it) => it.value >= t.min && it.value <= t.max).length;
  console.log(`  ${String(t.min).padStart(5)}-${String(t.max).padEnd(5)} ${t.name.padEnd(6, "　")} ${String(hit).padStart(3)} 处   ${t.note}`);
}

if (verbose) {
  console.log("\n分布明细：");
  for (const v of Array.from(byValue.keys()).sort((a, b) => a - b)) {
    const arr = byValue.get(v);
    console.log(`  ${String(v).padStart(6)} ×${String(arr.length).padStart(2)}  ` +
      arr.slice(0, 4).map((a) => `${a.file}:${a.line}${a.sel ? " " + a.sel : ""}`).join("  ") +
      (arr.length > 4 ? `  …另 ${arr.length - 4} 处` : ""));
  }
}

console.log(`\n采集 ${items.length} 处 z-index，跨 ${byValue.size} 个不同值；超 #modal(96) 的有 ${REGISTRY.length} 处（均已登记）。`);

if (problems.length) {
  console.log("\n发现问题：");
  for (const p of problems) console.log("  ✗ " + p);
  console.log(`\n合计 ${problems.length} 项未通过`);
  process.exit(1);
}

if (notes.length) for (const n of notes) console.log("  ! " + n);
console.log("✓ 层级契约通过：" + TIERS.length + " 段阶梯全覆盖，高层级全部登记在案");
