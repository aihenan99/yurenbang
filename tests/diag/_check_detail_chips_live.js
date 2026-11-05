#!/usr/bin/env node
/* 线上验证：求助详情头部不再渲染 .p-tag / .age-chip（2026-11-02 用户反馈）
 * 只读：只打开首页→点第一张卡→读 DOM，不发帖不写库 */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "..", "temp", "pw", "node_modules", "playwright-core"));

function findChrome() {
  for (const c of [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ]) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

(async () => {
  const b = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
  });
  const p = await ctx.newPage();
  await p.goto("https://xn--gmqq09al6z.cn/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForTimeout(20000);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} }).catch(() => {});
  await p.waitForTimeout(1000);
  const card = await p.evaluate(() => {
    const c = document.querySelector("#feed .card");
    if (!c) return null;
    return { id: c.dataset.id, text: (c.innerText || "").slice(0, 40) };
  });
  if (card) {
    // 点卡片里的「查看完整求助」链接（真实委托入口），失败再点卡片本身
    await p.click("#feed .card .r23-detail-link", { timeout: 5000 }).catch(async () => {
      await p.click("#feed .card .p-text", { timeout: 5000 }).catch(async () => {
        await p.click("#feed .card", { timeout: 5000 }).catch(() => {});
      });
    });
  }
  await p.waitForTimeout(2500);
  const d = await p.evaluate(() => ({
    open: document.querySelector("#r23Detail").classList.contains("open"),
    tag: !!document.querySelector("#r23Detail .r23-dcard .p-tag"),
    age: !!document.querySelector("#r23Detail .r23-dcard .age-chip"),
    name: (document.querySelector("#r23Detail .p-name") || {}).textContent || "",
  }));
  console.log("卡片：", JSON.stringify(card));
  console.log("详情页：", JSON.stringify(d));
  console.log(!card || !d.open ? "❌ 详情未打开" : (!d.tag && !d.age ? "✅ 详情页头部已无分类标签与年龄段" : "❌ 仍有残留"));
  await b.close();
})().catch((e) => { console.log("ERR", e.message); process.exit(0); });
