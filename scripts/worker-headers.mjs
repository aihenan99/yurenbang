#!/usr/bin/env node
/* ============================================================================
 * Worker 安全响应头验证（worker-headers.mjs）
 *
 * 为什么需要这个：CSP 这类头一旦拼错，浏览器是**静默忽略**的——
 * 你看不到任何报错，只会以为"已经加上了"。所以必须真的调用一次 Worker，
 * 把响应头读出来核对。
 *
 * 做法：把 deploy-cn/_worker.js 复制成 .mjs（绕开 package.json 的 commonjs 类型），
 * 动态 import，喂一个假的 env.ASSETS，然后检查返回头。不联网、不起服务、百毫秒级。
 * ========================================================================== */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "deploy-cn", "_worker.js");
const TMP = join(ROOT, "temp", "_worker_probe.mjs");

writeFileSync(TMP, readFileSync(SRC, "utf8"), "utf8");
const mod = await import(pathToFileURL(TMP).href + "?t=" + Date.now());
const worker = mod.default;

const env = {
  ASSETS: {
    fetch: async () => new Response("<!doctype html><html><head></head><body>ok</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  }
};

const res = await worker.fetch(new Request("https://xn--gmqq09al6z.cn/"), env);
const h = res.headers;

const checks = [
  ["HTTP 200（页面可正常返回）", res.status === 200],
  ["x-content-type-options: nosniff", h.get("x-content-type-options") === "nosniff"],
  ["x-frame-options: DENY", h.get("x-frame-options") === "DENY"],
  ["referrer-policy 已设置", !!h.get("referrer-policy")],
  ["permissions-policy 已设置", !!h.get("permissions-policy")],
  ["HSTS 已设置且 >= 90 天", (() => {
    const v = h.get("strict-transport-security") || "";
    const m = v.match(/max-age=(\d+)/);
    return !!m && Number(m[1]) >= 7776000;
  })()],
  ["CSP 已下发（观测模式或强制模式）", !!(h.get("content-security-policy") || h.get("content-security-policy-report-only"))],
  ["CSP 含 default-src 'self'", (() => {
    const v = h.get("content-security-policy-report-only") || h.get("content-security-policy") || "";
    return v.includes("default-src 'self'");
  })()],
  ["CSP 禁止 object 嵌入", (() => {
    const v = h.get("content-security-policy-report-only") || h.get("content-security-policy") || "";
    return v.includes("object-src 'none'");
  })()],
  ["CSP 限制被嵌入（frame-ancestors 'none'）", (() => {
    const v = h.get("content-security-policy-report-only") || h.get("content-security-policy") || "";
    return v.includes("frame-ancestors 'none'");
  })()],
  ["CSP 放行 blob/data 媒体（录制与粘贴功能依赖）", (() => {
    const v = h.get("content-security-policy-report-only") || h.get("content-security-policy") || "";
    return /media-src[^;]*blob:/.test(v) && /img-src[^;]*data:/.test(v);
  })()],
  ["边缘标记 x-yrb-edge 存在", !!h.get("x-yrb-edge")]
];

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log((ok ? "  ✓ " : "  ✗ ") + name);
}

if (bad) {
  console.error("\n✗ Worker 响应头 " + bad + " 项不合格");
  process.exit(1);
}
console.log("\n✓ Worker 响应头全部合格");
