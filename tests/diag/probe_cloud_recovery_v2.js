#!/usr/bin/env node
/* 云服务恢复探测 v2 · 全程只读，不登录、不写库、不发帖、不改线上任何东西
 *
 * 与 v1（temp/probe_cloud_recovery.js）的唯一区别：留痕。
 * v1 只在终端打印一份结果，窗口一关就没了。而工单和"到底哪天断的、断成什么样"
 * 靠的是带时间戳的连续记录，所以这里每次运行都往 temp/cloud-recovery-log.jsonl
 * 追加一行，跑得越多链条越长，中途断一天也看得出来。
 *
 * 用法：
 *   node temp/probe_cloud_recovery_v2.js               # 探测 + 留痕（默认）
 *   node temp/probe_cloud_recovery_v2.js --no-log      # 只看，不写日志
 *   node temp/probe_cloud_recovery_v2.js --url=http://127.0.0.1:8794/   # 换目标（本地验证用）
 *   node temp/probe_cloud_recovery_v2.js --wait=12000  # 改等待时长，默认 8000ms
 *
 * 输出：人看的摘要 + 一段可直接贴进工单的 Markdown 表格行
 * 退出码：0 不管结果如何（避免打断自动化流水）；结果以 verdict 字段为准
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ── 可调参数 ────────────────────────────────────────────────────────────
const DEFAULT_URL = "https://xn--gmqq09al6z.cn/";
const WAIT_MS = 8000;

// 体验版隔离 15 天，自 2026-10-26 起算 → 约 11-10 数据销毁
// 这是"最坏情况线"，不是承诺：平台口径若有变化以平台为准
const DESTRUCTION_DEADLINE = "2026-11-10T00:00:00+08:00";
// 计费周期锚定开通日 2026-10-14 → 下一个资源点刷新日约 11-14
const REFRESH_ESTIMATE = "2026-11-14T00:00:00+08:00";
// 到这个日期仍未恢复，就该去看工单进展了（而不是继续等）
const ESCALATE_DATE = "2026-11-08T00:00:00+08:00";

const LOG_PATH = path.join(__dirname, "..", "..", "temp", "cloud-recovery-log.jsonl");

// ── 参数解析 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const noLog = argv.includes("--no-log");
const urlArg = argv.find((a) => a.startsWith("--url="));
const waitArg = argv.find((a) => a.startsWith("--wait="));
const TARGET = urlArg ? urlArg.slice(6) : DEFAULT_URL;
const WAIT = waitArg ? Math.max(0, parseInt(waitArg.slice(7), 10) || WAIT_MS) : WAIT_MS;

// ── 小工具 ──────────────────────────────────────────────────────────────
// 固定按东八区显示，不依赖机器时区（换机器跑出来的时间才对得上）
function shanghai(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return {
    stamp: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
  };
}

function daysLeft(targetIso) {
  const ms = new Date(targetIso).getTime() - Date.now();
  return Math.round((ms / 86400000) * 10) / 10; // 保留 1 位，别假装精确到分钟
}

function findChrome() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* 忽略 */ }
  }
  return null;
}

// ── 主流程 ──────────────────────────────────────────────────────────────
(async () => {
  const startedAt = Date.now();
  const out = {
    at: shanghai(startedAt).stamp,
    target: TARGET,
    verdict: "unknown",   // recovered | isolated | unknown
    postsState: null,
    feedCards: 0,
    http402: 0,
    build: null,
    buildAt: null,
    daysToDestroy: daysLeft(DESTRUCTION_DEADLINE),
    daysToRefresh: daysLeft(REFRESH_ESTIMATE),
    note: "",
  };

  let browser = null;
  try {
    const chrome = findChrome();
    if (!chrome) throw new Error("找不到 Chrome/Edge 可执行文件");
    const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));
    browser = await chromium.launch({ executablePath: chrome, headless: true });

    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block", // 挡 SW，避免读到缓存里的旧页面
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
    });
    const page = await ctx.newPage();

    // 402 计数：这是"网关卡在余额"的最直接证据，单个就足以说明问题
    page.on("response", (r) => { if (r.status() === 402) out.http402++; });

    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch((e) => { out.note = "goto: " + e.message.slice(0, 120); });

    await page.waitForTimeout(WAIT); // 等 SDK 加载 + 首轮拉取落地

    const live = await page.evaluate(async () => {
      const r = { postsState: null, feedCards: 0, feedText: "", toast: "", postsLen: null };

      try {
        if (window.YRB_CLOUD && typeof window.YRB_CLOUD.postsState === "function") {
          r.postsState = window.YRB_CLOUD.postsState();
        }
      } catch (e) { r.postsState = "ERR:" + e.message; }

      const feed = document.querySelector("#feed");
      if (feed) {
        r.feedCards = feed.querySelectorAll(".card, article, .p-card").length;
        r.feedText = (feed.innerText || "").replace(/\s+/g, " ").slice(0, 160);
      }
      const t = document.querySelector("#toast");
      r.toast = t ? (t.innerText || "").replace(/\s+/g, " ").slice(0, 160) : "";

      try { r.postsLen = (typeof S !== "undefined" && S.posts) ? S.posts.length : null; } catch (e) {}

      // 构建号同源取，避免再开一次请求
      try {
        const resp = await fetch("/build.json", { cache: "no-store" });
        if (resp.ok) {
          const b = await resp.json();
          r.build = b.build || null;
          r.buildAt = b.at || null;
        }
      } catch (e) {}

      return r;
    });

    Object.assign(out, {
      postsState: live.postsState,
      feedCards: live.feedCards,
      feedText: live.feedText,
      toast: live.toast,
      postsLen: live.postsLen,
      build: live.build || null,
      buildAt: live.buildAt || null,
    });

    // 判定：以 postsState 为主，卡片数为辅。
    // 只要还是 isolated / 页面还在喊维护 / 有 402，就不算恢复——
    // 宁可判"没恢复"让人再来看一眼，也不要在假恢复上误报好消息。
    const st = String(out.postsState || "");
    if (st === "isolated" || /维护/.test(out.feedText) || out.http402 > 0) {
      out.verdict = "isolated";
    } else if (st && st !== "isolated" && out.feedCards > 0) {
      out.verdict = "recovered";
    } else if (st && st !== "isolated") {
      out.verdict = "recovered"; // 状态已放开但暂时无内容（真空库也算恢复）
    } else {
      out.verdict = "unknown";
    }
  } catch (e) {
    out.verdict = "unknown";
    out.note = (out.note ? out.note + " | " : "") + "probe: " + String(e.message || e).slice(0, 200);
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }

  out.durationMs = Date.now() - startedAt;
  out.checkedAt = shanghai(Date.now());

  // ── 留痕 ──────────────────────────────────────────────────────────────
  if (!noLog) {
    try {
      const line = JSON.stringify({
        t: out.at,
        verdict: out.verdict,
        postsState: out.postsState,
        feedCards: out.feedCards,
        http402: out.http402,
        build: out.build,
        daysToDestroy: out.daysToDestroy,
        note: out.note || undefined,
      });
      fs.appendFileSync(LOG_PATH, line + "\n", "utf8");
    } catch (e) {
      out.note = (out.note ? out.note + " | " : "") + "log: " + e.message;
    }
  }

  // ── 人看的摘要 ────────────────────────────────────────────────────────
  const icon = out.verdict === "recovered" ? "✅" : out.verdict === "isolated" ? "❌" : "⚠️";
  const label = { recovered: "已恢复", isolated: "仍隔离", unknown: "未判定" }[out.verdict];

  console.log(`${icon} ${label}　${out.at}（+08:00）`);
  console.log("─".repeat(46));
  console.log(`  postsState        ${out.postsState}`);
  console.log(`  信息流卡片        ${out.feedCards}`);
  console.log(`  HTTP 402 次数     ${out.http402}`);
  console.log(`  构建号            ${out.build || "（未取到）"}${out.buildAt ? "  " + out.buildAt : ""}`);
  console.log(`  距数据销毁线      ${out.daysToDestroy} 天（11-10）`);
  console.log(`  距额度刷新估算    ${out.daysToRefresh} 天（约 11-14）`);
  if (out.note) console.log(`  备注              ${out.note}`);

  // 该不该升级，直接说清楚，别让人自己算日子
  const escalateIn = daysLeft(ESCALATE_DATE);
  if (out.verdict !== "recovered" && escalateIn <= 0) {
    console.log(`\n  ⚠️ 已过 11-08 闸门，仍未恢复 → 去看 docs/云服务工单-额度刷新日与隔离期冲突.md 的工单进展`);
  } else if (out.verdict !== "recovered") {
    console.log(`\n  ⏳ 距 11-08 升级闸门还有 ${escalateIn} 天；距数据销毁 ${out.daysToDestroy} 天`);
  }

  // ── 给工单用的一行 ────────────────────────────────────────────────────
  console.log("\n工单可用的 Markdown 行：");
  console.log(
    `| ${out.at} | ${out.postsState} | ${out.feedCards} | ${out.http402} | ${out.build || "-"} | ${out.verdict === "recovered" ? "已恢复" : "仍隔离"} |`
  );
  if (!noLog) console.log(`\n已追加到 ${path.relative(process.cwd(), LOG_PATH)}`);
})();
