/* 浏览器与 playwright-core 的统一取用（2026-10-29 审核 H7 修复）
 *
 * 为什么有这个文件：e2e 测试过去硬编码两样东西——
 *   1) require("../../temp/pw/node_modules/playwright-core")  （本机私有安装）
 *   2) const CHROME = "C:/Program Files (x86)/Google/Chrome/..."  （Windows 路径）
 * 导致 CI（Linux）根本跑不了 e2e，门禁系统性假绿。现在：
 *   - playwright-core：先找本机 temp/pw/，再找 node_modules/（CI 用 npm i --no-save 装）
 *   - 浏览器：环境变量 YRB_CHROME 优先 → 常见 Chrome 安装位 → playwright 自装 chromium
 * 本机行为完全不变；CI 设好 YRB_CHROME 即可。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

function loadPlaywright() {
  const cands = [
    path.join(ROOT, "temp", "pw", "node_modules", "playwright-core"),
    path.join(ROOT, "node_modules", "playwright-core"),
  ];
  for (const c of cands) {
    try { return require(c); } catch (_) { /* 下一个 */ }
  }
  throw new Error(
    "找不到 playwright-core：本机应有 temp/pw/（私有安装），" +
    "CI 应先 npm i --no-save playwright-core@1.64.1");
}

function chromePath() {
  if (process.env.YRB_CHROME) return process.env.YRB_CHROME;
  const cands = [
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  /* playwright 自装 chromium（CI 或本机没装 Chrome 时） */
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cache = path.join(home, ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).sort().reverse()) {
      if (!d.startsWith("chromium-")) continue;
      for (const sub of ["chrome-linux/chrome", "chrome-win/chrome.exe", "chrome-win64/chrome.exe"]) {
        const exe = path.join(cache, d, ...sub.split("/"));
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  throw new Error("找不到浏览器：请设 YRB_CHROME 环境变量，或安装 Chrome / playwright chromium");
}

module.exports = { loadPlaywright, chromePath };
