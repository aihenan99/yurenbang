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
 *   2026-11-04 补了第五项：被引用的资源必须已被 git 跟踪。新层文件在磁盘上
 *   齐了、页面也跑得通，但没 git add —— 仓库 clone 下来直接缺文件（真实事故）。
 *
 * 只读静态文件，不执行任何业务代码。退出码：0 全通过；1 有不一致。
 * ========================================================================== */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
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

/* ⑤ 按需层（lazy.js 的 MAP）：不在 html 首屏里、也不该进 sw 预缓存 */
const lazySrc = read(join(SRC, "assets", "lazy.js"));
const lazyLayers = [...lazySrc.matchAll(/([A-Za-z0-9_-]+)\s*:\s*\{\s*js:\s*"assets\/([^"]+)\.js"/g)]
  .map((m) => m[1]);
const lazySet = new Set(lazyLayers);

console.log(C.b + "\n层登记一致性审计" + C.x + C.d + "（html / sw.js / health.js / sync_deploy.py 四处对齐 + 按需层）" + C.x + "\n");

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

/* C2. 按需层自洽：不在首屏包里、文件存在、health 标了 lazy:true
      （任一条不成立 → 要么按需没生效，要么它缺席时会被免疫系统误判为故障） */
const lazyBad = [];
for (const id of lazySet) {
  if (htmlLayers.includes(id)) lazyBad.push(id + " 仍在 html 首屏");
  if (!existsSync(join(SRC, "assets", id + ".js"))) lazyBad.push(id + " 文件缺失");
  const h = healthLayers.find((L) => L.id === id);
  if (!h) lazyBad.push(id + " 未登记 health");
  else if (!new RegExp('id:\\s*"' + id + '"[^}]*?lazy:\\s*true').test(health)) lazyBad.push(id + " 未标 lazy:true");
}
if (lazyBad.length) no("按需层自洽（不进首屏 / 有文件 / health 标 lazy）", lazyBad.join("；"));
else ok("按需层自洽（不进首屏 / 有文件 / health 标 lazy）", lazySet.size ? [...lazySet].join(",") : "无按需层");

/* D. 离线可用：每个层的 js/css 都要在 sw CORE 里
     例外：按需层不进预缓存 —— 预缓存等于把它重新下载一遍，按需省流量的意义就没了。
     它们的样式已并入 bundle.css（bundle.css 在 CORE 里），脚本走运行时缓存。 */
const coreJsSet = new Set(coreJs);
const notCached = htmlLayers.filter((n) => !coreJsSet.has(n + ".js") && !lazySet.has(n));
if (notCached.length) no("所有层脚本都在 sw 预缓存里", "缺：" + notCached.join(", "));
else ok("所有层脚本都在 sw 预缓存里", coreJs.length + " 个 js" + (lazySet.size ? "（按需层 " + lazySet.size + " 个豁免）" : ""));

const coreCssSet = new Set(coreCss);
const cssNotCached = htmlCss.filter((n) => !coreCssSet.has(n + ".css") && !lazySet.has(n));
if (cssNotCached.length) no("所有层样式都在 sw 预缓存里", "缺：" + cssNotCached.join(", "));
else ok("所有层样式都在 sw 预缓存里", htmlCss.length + " 个 css");

/* E. 对外声明（build.json 的 layers）要与真实层对齐 */
if (!declared.length) {
  warn("未能从 sync_deploy.py 解析出 layers 声明", "跳过该项");
} else {
  const allowed = [...htmlLayers, ...lazyLayers];
  const missingInDecl = allowed.filter((n) => !declared.includes(n));
  const extraInDecl = declared.filter((n) => !allowed.includes(n));
  if (missingInDecl.length || extraInDecl.length) {
    no("build.json 的 layers 声明与真实层一致",
      (missingInDecl.length ? "少声明 " + missingInDecl.length + " 个：" + missingInDecl.join(",") : "") +
      (extraInDecl.length ? (missingInDecl.length ? "；" : "") + "多声明：" + extraInDecl.join(",") : ""));
  } else {
    ok("build.json 的 layers 声明与真实层一致", declared.length + " 层");
  }
}

/* F. 体积预算：防「顺手塞个大文件进去」
 * 2026-11-05 改为双指标：
 *   raw  —— 解析/编译成本的代表（长辈机 CPU 弱，这个才是体感来源）
 *   gzip —— 真实传输量（CF 与 nginx 都开 gzip/br，用户下载的就是这个）
 * 只看 raw 会误判（804KiB 听着吓人，实际传 274KiB）；只看 gzip 又会放过
 * 「压缩率高但解析很重」的重复代码。两条都守，且各自有独立理由。
 */
const BUDGET = { single: 200 * 1024, layers: 900 * 1024, bundleJs: 860 * 1024, bundleCss: 260 * 1024, bundleJsGzip: 300 * 1024 };
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
  if (s > budget) no(file + " 体积在预算内（≤ " + kb(budget) + "）", kb(s) +
    " —— 必须拆分（例如 admin.js 只有管理员用，可改按需加载）或按流程提额并写清理由");
  else ok(file + " 体积在预算内", kb(s) + " / " + kb(budget) +
    /* 余量少于 8KB 就提前打招呼：等它真越线才发现在功能做完之后，返工最贵 */
    (budget - s < 8 * 1024 ? "（余量 " + ((budget - s) / 1024).toFixed(1) + "KB，下一个功能前先拆层或提额）" : ""));

  /* js 额外守 gzip：这才是用户真正下载的字节数 */
  if (file === "bundle.js") {
    const gz = gzipSync(readFileSync(p), { level: 9 }).length;
    if (gz > BUDGET.bundleJsGzip) no("bundle.js 传输体积在预算内（gzip ≤ " + kb(BUDGET.bundleJsGzip) + "）", kb(gz));
    else ok("bundle.js 传输体积在预算内", "gzip " + (gz / 1024).toFixed(1) + "KB / " + kb(BUDGET.bundleJsGzip));
  }
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

/* H. 仓库完整性：被 html / sw 引用的资源必须在 git 跟踪清单里
     2026-11-04 的真实事故：staticcases.js / staticcases.css / yb-sb.js 三个新层
     文件，磁盘上有、html 与 sw.js 也都引用了、页面跑得好好的 —— 但从来没有
     git add 过。所有检查都是绿的（检查 A 只问 existsSync，磁盘有就算过），
     而仓库 clone 下来直接缺文件。这一项专门堵这个洞：只看「进没进版本库」。 */
const trackedAssets = (() => {
  const r = spawnSync("git", ["-C", ROOT, "ls-files", "-z", "--", "yurenbang-app/assets"], { encoding: "buffer" });
  if (r.error || r.status !== 0) return null;   /* 无 git 环境（如解包的分发包）不误报 */
  return new Set(
    r.stdout.toString("utf8").split("\0").filter(Boolean)
      .map((p) => p.replace(/^yurenbang-app\/assets\//, "").replace(/\\/g, "/"))
  );
})();
if (!trackedAssets) {
  warn("git 不可用，跳过「资源是否已纳入版本控制」检查", "建议手动 git status 确认新层已提交");
} else {
  /* bundle.* 是 sync_deploy.py 打包出来的产物（源码目录里没有），不算源文件 */
  const GENERATED = new Set(["bundle.js", "bundle.css"]);
  const needTracked = [...new Set([
    ...htmlLayers.map((n) => n + ".js"),
    ...htmlCss.map((n) => n + ".css"),
    ...coreJs, ...coreCss,
  ])].filter((f) => !GENERATED.has(f));
  const untracked = needTracked.filter((f) => !trackedAssets.has(f));
  if (untracked.length) {
    no("被引用的资源都已纳入版本控制",
      "未 git add：" + untracked.join(", ") + " ← 别人 clone 下来会缺文件（git add yurenbang-app/assets/…）");
  } else {
    ok("被引用的资源都已纳入版本控制", needTracked.length + " 个 js/css");
  }
}

/* ---------- 汇总 ---------- */
console.log("");
if (bad === 0) {
  console.log(C.g + "✓ 五处登记一致 · 被引用的资源都已入库" + C.x + C.d + "（" + htmlLayers.length + " 层）" + C.x + "\n");
  process.exit(0);
}
console.log(C.r + "✗ " + bad + " 项不一致" + C.x + C.d + " —— 加层请对照 docs/开发手册.md 第 4 节的「五处登记」，别忘 git add" + C.x + "\n");
process.exit(1);
