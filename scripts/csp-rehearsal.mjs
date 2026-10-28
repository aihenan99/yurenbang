#!/usr/bin/env node
/* ============================================================================
 * CSP 转强制演练（csp-rehearsal.mjs）
 *
 * 目的：在**不发版、不动生产文件**的前提下，回答一个问题——
 *   「如果把 CSP 从 Report-Only 切成强制，现在的站还活得下来吗？」
 *
 * 做法（全程本地，零外部依赖）：
 *   1) 内存里把 deploy-cn/_worker.js 的 CSP_HEADER 改成强制模式，落到 temp/ 临时副本
 *   2) 按 worker-headers.mjs 的老办法动态 import 一次，拿到「强制模式真正会下发的头」
 *   3) 起一个最小静态服务器，把部署包照原样服务出去，每个响应都带上这套安全头
 *   4) 真浏览器（Playwright + 本机 Chrome）走查首页 / 分享页 / 案例库，
 *      用 securitypolicyviolation 事件 + console + pageerror 三路收集违规
 *   5) 清掉临时文件，退出码 0=零违规 1=有违规
 *
 * 为什么值得做：强制模式下的违规是**静默失败**（脚本被拦不报错，只表现为
 * 「点了没反应」）。这份演练把「发版后才发现」提前成「本地 20 秒发现」。
 *
 * 用法：npm run verify:csp        （需本机 Chrome；Windows 默认路径已探测）
 * ========================================================================== */
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(ROOT, "deploy-cn");
const SRC_WORKER = join(DEPLOY, "_worker.js");
const TMP_WORKER = join(ROOT, "temp", "_csp_rehearsal_worker.mjs");
const require = createRequire(import.meta.url);

const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[90m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", d: "", b: "", x: "" };

let pass = 0, fail = 0;
const ck = (name, cond, info) => {
  if (cond) { pass++; console.log("  " + C.g + "✓" + C.x + " " + name + (info ? C.d + "  [" + info + "]" + C.x : "")); }
  else { fail++; console.log("  " + C.r + "✗" + C.x + " " + name + C.d + "  [" + (info || "") + "]" + C.x); }
};

/* ---------- 1. 内存改成强制模式 ---------- */
/* 必须行首锚定：文件里注释「把这行改成 const CSP_HEADER = "content-security-policy";」
   也在注释里出现过同样的字面量，不锚定会改到注释、真正的常量却还是 Report-Only
   （演练器第一次跑就栽在这上面——静默错误，正是 CSP 该防的那类） */
const raw = readFileSync(SRC_WORKER, "utf8");
const M = raw.match(/^const CSP_HEADER = "([^"]+)";/m);
if (!M) { console.error("找不到 CSP_HEADER 常量，脚本需要更新"); process.exit(2); }
const ORIGINAL = M[1];
const patched = raw.replace(/^const CSP_HEADER = "[^"]+";/m, 'const CSP_HEADER = "content-security-policy";');
if (!/^const CSP_HEADER = "content-security-policy";/m.test(patched)) {
  console.error("补丁未落到真实常量上，脚本需要更新");
  process.exit(2);
}
writeFileSync(TMP_WORKER, patched, "utf8");
console.log(C.b + "\n育人帮 · CSP 转强制演练" + C.x + C.d + "（原模式：" + ORIGINAL + " → 演练模式：强制）" + C.x + "\n");

const cleanup = () => { try { if (existsSync(TMP_WORKER)) unlinkSync(TMP_WORKER); } catch (_) {} };
process.on("exit", cleanup);

/* ---------- 2. 真调一次 Worker，拿到强制模式会下发的头 ---------- */
const mod = await import(pathToFileURL(TMP_WORKER).href + "?t=" + Date.now());
const worker = mod.default;
const probe = await worker.fetch(new Request("https://xn--gmqq09al6z.cn/"), {
  ASSETS: { fetch: async () => new Response("<!doctype html><html><body>ok</body></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) }
});
const policy = probe.headers.get("content-security-policy") || "";
ck("强制头已下发（content-security-policy，不再是 Report-Only）", !!policy && !probe.headers.get("content-security-policy-report-only"), policy.slice(0, 40) + "…");

const SEC_HEADERS = {};
for (const k of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) {
  const v = probe.headers.get(k);
  if (v) SEC_HEADERS[k] = v;
}

/* ---------- 3. 静态服务器：部署包原样 + 强制安全头 ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const server = createServer((req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(DEPLOY, rel));
    if (!file.startsWith(DEPLOY)) { res.writeHead(403, SEC_HEADERS); return res.end("forbidden"); }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { ...SEC_HEADERS, "content-type": "text/plain; charset=utf-8" });
      return res.end("404");
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      ...SEC_HEADERS,
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, SEC_HEADERS);
    res.end("server error");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = "http://127.0.0.1:" + PORT;

/* ---------- 4. 浏览器走查 ---------- */
const CHROME = [
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"
].find((p) => existsSync(p));

if (!CHROME) {
  console.log("  " + C.y + "跳过" + C.x + " 未找到本机 Chrome，无法做浏览器演练\n");
  server.close();
  process.exit(0);
}
const { chromium } = require(join(ROOT, "temp", "pw", "node_modules", "playwright-core"));

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
/* 采集器必须在任何页面脚本之前装好（addInitScript 保证顺序） */
await ctx.addInitScript(() => {
  window.__cspv = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__cspv.push({
      directive: e.violatedDirective || "",
      blocked: e.blockedURI || "",
      sample: (e.sample || "").slice(0, 90)
    });
  });
});

const PAGES = [
  ["首页（全功能）", "/"],
  ["分享落地页", "/share.html"],
  ["静态案例库", "/anli/index.html"]
];

for (const [label, path] of PAGES) {
  const p = await ctx.newPage();
  const errs = [], cons = [], notFound = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") cons.push(m.text()); });
  p.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin !== BASE) return;
    if (r.status() >= 400) notFound.push(u.pathname + " " + r.status());
  });

  let status = 0;
  try {
    const resp = await p.goto(BASE + path, { waitUntil: "load", timeout: 20000 });
    status = resp ? resp.status() : 0;
    await p.waitForTimeout(1200);
  } catch (e) {
    errs.push("导航失败：" + e.message.split("\n")[0]);
  }

  const v = await p.evaluate(() => window.__cspv || []).catch(() => []);
  const cspCons = cons.filter((t) => /Content Security Policy|Refused to/i.test(t));
  /* 云端额度隔离期的 402 属环境噪声，不算缺陷 */
  const realCons = cons.filter((t) => !/402|yrbapi|Failed to load resource/i.test(t));
  const heal = await p.evaluate(() => document.querySelectorAll("script[data-heal]").length).catch(() => 0);

  ck(label + " · HTTP 200", status === 200, String(status));
  ck(label + " · 零 CSP 违规", v.length === 0 && cspCons.length === 0,
    v.length ? v.map((x) => x.directive + " ← " + (x.blocked || x.sample)).slice(0, 3).join(" / ") : (cspCons[0] || ""));
  ck(label + " · 无页面脚本异常", errs.length === 0, errs.slice(0, 2).join(" / "));
  ck(label + " · 无本地 404", notFound.length === 0, notFound.slice(0, 3).join(" / "));
  if (path === "/") {
    const layers = await p.evaluate(() =>
      ["YRB_APP", "YRB_R23", "YRB_CLOUD", "YRB_FOOD", "YRB_PPT"].filter((k) => !window[k])
    ).catch(() => ["evaluate failed"]);
    ck("首页 · 五个核心层全部就绪", layers.length === 0, layers.join(","));
    ck("首页 · 未触发自愈补载（一次加载成功）", heal === 0, "script[data-heal]=" + heal);
    /* PPT 引擎（vendor/pptx-preview）硬依赖动态求值：这条挂了 = 强制模式下 PPT 打不开 */
    const evalOk = await p.evaluate(() => { try { return new Function("return 7")() === 7; } catch (e) { return false; } });
    ck("首页 · unsafe-eval 通道可用（PPT 引擎前提）", evalOk);
    ck("首页 · 无其它控制台错误（402 环境噪声已排除）", realCons.length === 0, realCons.slice(0, 2).join(" / "));
  }
  await p.close();
}

await b.close();
server.close();

/* ---------- 5. 结论 ---------- */
console.log("");
if (fail === 0) {
  console.log(C.g + "✓ 演练通过" + C.x + C.d + "（" + pass + " 项断言）：当前策略在强制模式下零违规，P3 分路径强制可安全开工" + C.x + "\n");
  process.exit(0);
}
console.log(C.r + "✗ 演练失败 " + fail + " 项" + C.x + "：强制模式会打断上述功能，先按预案 P2 收紧/放行再切\n");
process.exit(1);
