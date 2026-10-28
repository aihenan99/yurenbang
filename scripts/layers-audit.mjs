#!/usr/bin/env node
/* ============================================================================
 * 育人帮 · 层登记一致性审计（scripts/layers-audit.mjs）
 *
 * 为什么有这个脚本：
 *   加一个新层要同时改四处 —— ① html 的 <script> ② sw.js 的 CORE
 *   ③ health.js 的 LAYERS ④ sync_deploy.py 的 layers。
 *   以前全靠人记，漏一处不会立刻报错，而是「弱网时离线缺文件」「某层挂了没人
 *   知道」「build.json 对外声明少几层」这类很久以后才发作的病。这个脚本把
 *   「四处对齐」变成一条命令。
 *
 * 只读静态文件，不执行任何业务代码。退出码：0 全通过；1 有不一致。
 * ========================================================================== */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "yurenbang-app");
const read = (p) => readFileSync(p, "utf8");

const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", d: "", b: "", x: "" };

let bad = 0;
const ok = (m, extra) => console.log("  " + C.g + "✓" + C.x + " " + m + (extra ? C.d + "  " + extra + C.x : ""));
const no = (m, extra) => { bad++; console.log("  " + C.r + "✗" + C.x + " " + m + (extra ? C.d + "  " + extra + C.x : "")); };
const warn = (m, extra) => console.log("  " + C.y + "!" + C.x + " " + m + (extra ? C.d + "  " + extra + C.x : ""));

/* ---------- 1. 从四处抽出层清单 ---------- */
const html = read(join(SRC, "yurenbang-app.html"));

/* ① html 里的 <script src="assets/X.js"> 顺序（这是真实的加载顺序） */
const htmlLayers = [...html.matchAll(/<script\s+src="assets\/([A-Za-z0-9._-]+)\.js"/g)].map((m) => m[1]);
/* html 里的 <link href="assets/X.css"> */
const htmlCss = [...html.matchAll(/<link[^>]+href="assets\/([A-Za-z0-9._-]+)\.css"/g)].map((m) => m[1]);

/* ② sw.js 的 CORE 预缓存清单 */
const sw = read(join(SRC, "sw.js"));
const coreBlock = (sw.match(/const\s+CORE\s*=\s*\[([\s\S]*?)\]/) || [, ""])[1];
const coreJs = [...coreBlock.matchAll(/['"]\/assets\/([A-Za-z0-9._-]+\.js)['"]/g)].map((m) => m[1]);
const coreCss = [...coreBlock.matchAll(/['"]\/assets\/([A-Za-z0-9._-]+\.css)['"]/g)].map((m) => m[1]);

/* ③ health.js 的 LAYERS 登记表（id + file，顺序有意义） */
const health = read(join(SRC, "assets", "health.js"));
const healthLayers = [...health.matchAll(/id:\s*"([^"]+)",\s*file:\s*"assets\/([^"]+)"/g)]
  .map((m) => ({ id: m[1], file: m[2] }));

/* ④ sync_deploy.py 写进 build.json 的 layers 声明 */
const pyPath = join(ROOT, "temp", "sync_deploy.py");
let declared = [];
if (existsSync(pyPath)) {
  const block = (read(pyPath).match(/"layers":\s*\[([\s\S]*?)\]/) || [, ""])[1];
  declared = [...block.matchAll(/"([A-Za-z0-9._-]+)"/g)].map((m) => m[1]);
}

console.log(C.b + "\n层登记一致性审计" + C.x + C.d + "（html / sw.js / health.js / sync_deploy.py 四处对齐）" + C.x + "\n");

/* ---------- 2. 校验 ---------- */

/* A. html 引用的脚本必须真实存在 */
const missingFiles = htmlLayers.filter((n) => !existsSync(join(SRC, "assets", n + ".js")));
if (missingFiles.length) no("html 引用的脚本都存在", "缺文件：" + missingFiles.join(", "));
else ok("html 引用的脚本都存在", htmlLayers.length + " 个层");

/* B. 每个加载的层都要被 health 监控
     例外：health 自己还没跑完、upgrade 在 health 之后加载，这两层无法自监控。 */
const NO_SELF_PROBE = new Set(["health", "upgrade"]);
const hFiles = new Set(healthLayers.map((L) => L.file.replace(/\.js$/, "")));
const unmonitored = htmlLayers.filter((n) => !hFiles.has(n) && !NO_SELF_PROBE.has(n));
if (unmonitored.length) no("每个加载的层都在 health 监控表里", "未登记：" + unmonitored.join(", "));
else ok("每个加载的层都在 health 监控表里", healthLayers.length + " 条登记（health/upgrade 因加载顺序豁免）");

/* C. health LAYERS 的相对顺序必须与 html 加载顺序一致
      （自愈补载按这张表的顺序重来，顺序错了可能补在依赖之前） */
const hOrder = healthLayers.map((L) => L.file.replace(/\.js$/, "")).filter((n) => htmlLayers.includes(n));
const htmlOrder = htmlLayers.filter((n) => hOrder.includes(n));
const firstDiff = hOrder.findIndex((n, i) => n !== htmlOrder[i]);
if (firstDiff === -1) ok("health 登记顺序与 html 加载顺序一致", hOrder.length + " 层");
else {
  const i = firstDiff;
  no("health 登记顺序与 html 加载顺序一致",
    "第 " + (i + 1) + " 位起分叉：health=" + hOrder.slice(i, i + 3).join("→") +
    " / html=" + htmlOrder.slice(i, i + 3).join("→"));
}

/* D. 离线可用：每个层的 js/css 都要在 sw CORE 里 */
const coreJsSet = new Set(coreJs);
const notCached = htmlLayers.filter((n) => !coreJsSet.has(n + ".js"));
if (notCached.length) no("所有层脚本都在 sw 预缓存里", "缺：" + notCached.join(", "));
else ok("所有层脚本都在 sw 预缓存里", coreJs.length + " 个 js");

const coreCssSet = new Set(coreCss);
const cssNotCached = htmlCss.filter((n) => !coreCssSet.has(n + ".css"));
if (cssNotCached.length) no("所有层样式都在 sw 预缓存里", "缺：" + cssNotCached.join(", "));
else ok("所有层样式都在 sw 预缓存里", htmlCss.length + " 个 css");

/* E. 对外声明（build.json 的 layers）要与真实层对齐 */
if (!declared.length) {
  warn("未能从 sync_deploy.py 解析出 layers 声明", "跳过该项");
} else {
  const missingInDecl = htmlLayers.filter((n) => !declared.includes(n));
  const extraInDecl = declared.filter((n) => !htmlLayers.includes(n));
  if (missingInDecl.length || extraInDecl.length) {
    no("build.json 的 layers 声明与真实层一致",
      (missingInDecl.length ? "少声明 " + missingInDecl.length + " 个：" + missingInDecl.join(",") : "") +
      (extraInDecl.length ? (missingInDecl.length ? "；" : "") + "多声明：" + extraInDecl.join(",") : ""));
  } else {
    ok("build.json 的 layers 声明与真实层一致", declared.length + " 层");
  }
}

/* F. 体积预算：防「顺手塞个大文件进去」 */
const BUDGET = { single: 200 * 1024, layers: 900 * 1024, bundleJs: 800 * 1024, bundleCss: 260 * 1024 };
const kb = (n) => (n / 1024).toFixed(0) + "KB";

const over = [];
let layerTotal = 0;
for (const n of htmlLayers) {
  const p = join(SRC, "assets", n + ".js");
  if (!existsSync(p)) continue;
  const s = statSync(p).size;
  layerTotal += s;
  if (s > BUDGET.single) over.push(n + ".js " + kb(s));
}
if (over.length) no("单层体积在预算内（≤ " + kb(BUDGET.single) + "）", over.join(", "));
else ok("单层体积在预算内", "上限 " + kb(BUDGET.single) + "，实际最大 " + kb(Math.max(...htmlLayers.map((n) => {
  const p = join(SRC, "assets", n + ".js");
  return existsSync(p) ? statSync(p).size : 0;
}))));

if (layerTotal > BUDGET.layers) no("层脚本总体积在预算内（≤ " + kb(BUDGET.layers) + "）", kb(layerTotal));
else ok("层脚本总体积在预算内", kb(layerTotal) + " / " + kb(BUDGET.layers));

const depAssets = join(ROOT, "deploy-cn", "assets");
for (const [file, budget] of [["bundle.js", BUDGET.bundleJs], ["bundle.css", BUDGET.bundleCss]]) {
  const p = join(depAssets, file);
  if (!existsSync(p)) { warn(file + " 不存在，跳过体积检查（跑 npm run sync 生成）"); continue; }
  const s = statSync(p).size;
  if (s > budget) no(file + " 体积在预算内（≤ " + kb(budget) + "）", kb(s));
  else ok(file + " 体积在预算内", kb(s) + " / " + kb(budget));
}

/* G. 反向检查：assets 里有、但既不在 html 也没被任何层引用的孤儿脚本
     例外：Web Worker 脚本（如 img-worker.js）由层动态 new Worker 创建，不是页面层 */
const allJs = readdirSync(join(SRC, "assets")).filter((f) => f.endsWith(".js"));
const known = new Set([...htmlLayers.map((n) => n + ".js"), "bundle.js"]);
const layerSource = htmlLayers
  .map((n) => { try { return read(join(SRC, "assets", n + ".js")); } catch (_) { return ""; } })
  .join("\n");
for (const f of allJs) {
  if (!known.has(f) && layerSource.indexOf(f) >= 0) known.add(f);   /* 被某层动态引用 */
}
const orphans = allJs.filter((f) => !known.has(f));
if (orphans.length) warn("assets 里存在未被引用的脚本（可能是临时件）", orphans.join(", "));
else ok("assets 里没有游离脚本", allJs.length + " 个 js 均有出处");

/* ---------- 汇总 ---------- */
console.log("");
if (bad === 0) {
  console.log(C.g + "✓ 四处登记一致" + C.x + C.d + "（" + htmlLayers.length + " 层）" + C.x + "\n");
  process.exit(0);
}
console.log(C.r + "✗ " + bad + " 项不一致" + C.x + C.d + " —— 加层请对照 docs/开发手册.md 的「五处登记」" + C.x + "\n");
process.exit(1);
