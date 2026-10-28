/* 四维称号 + 欢迎玫瑰/掌声 专项测试
   用法：YRB_BASE=<url> node temp/reward_titles_check.js
   断言：四维格渲染与数值 / 官爵连续到访 / 欢迎玫瑰层 / 长辈模式 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? " ｜ " + extra : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? " ｜ " + extra : ""}`); }
}
const dstr = d => d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  page.on("pageerror", e => console.log("  [pageerror]", String(e).slice(0, 140)));

  /* ---------- 预置：职称 25 次 / 功力 5 次（语音3+视频2） / 玫瑰 12 朵，用于验证阶梯 ---------- */
  await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => {
    localStorage.setItem("yrb_reward_v1", JSON.stringify({
      points: 390, helps: { text: 20, voice: 3, video: 2 }, rosesGot: 12, streak: 6, lastActive: ""
    }));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#feed .card", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);

  console.log("=== A. 四维称号渲染与阶梯 ===");
  await page.click('.tb-item[data-p="me"]');
  await page.waitForSelector("#rwRank .rw-titles .rw-tl", { timeout: 8000 });
  const dims = await page.evaluate(() => {
    const st = window.YRB_REWARD.state();
    const cards = [...document.querySelectorAll("#rwRank .rw-tl")].map(c => ({
      k: c.querySelector(".rw-tl-k").textContent.trim(),
      n: c.querySelector(".rw-tl-n").textContent.trim(),
      s: c.querySelector(".rw-tl-s").textContent.trim()
    }));
    return { st, cards };
  });
  check("四张称号卡齐全（尊位/职称/官爵/功力）",
    dims.cards.length === 4 && dims.cards.map(c => c.k).join() === "尊位,职称,官爵,功力",
    dims.cards.map(c => c.k).join());
  const byK = k => dims.cards.find(c => c.k === k) || {};
  check("尊位 = 收到的玫瑰 12 → 首席嘉宾(≥10)", byK("尊位").n === "首席嘉宾" && dims.st.titles.find(t => t.key === "尊位").value === 12, `${byK("尊位").n}`);
  check("职称 = 帮忙总数 25 → 资深帮手(≥15)", byK("职称").n === "资深帮手" && dims.st.titles.find(t => t.key === "职称").value === 25, `${byK("职称").n}`);
  check("功力 = 语音+视频 5 → 小有所成(≥3)", byK("功力").n === "小有所成" && dims.st.titles.find(t => t.key === "功力").value === 5, `${byK("功力").n}`);
  check("四维卡都带「还差 N」进度提示", dims.cards.every(c => /还差 <b>|已达巅峰/.test(c.s) || /还差/.test(c.s)), dims.cards.map(c => c.s).join(" / "));
  check("官爵卡存在（streak 值见 B 段验证）", !!byK("官爵").n, byK("官爵").n);

  console.log("=== B. 官爵：连续到访结算 ===");
  check("今天首次打开 → streak 至少 1", dims.st.streak >= 1, `streak=${dims.st.streak}`);
  /* 预置 streak=6 且 lastActive 为空 → 落库后 lastActive=今天，streak 应重置为 1 */
  check("lastActive 为空 → 新周期从 1 开始", dims.st.streak === 1, `streak=${dims.st.streak}`);
  await page.evaluate(() => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const d = JSON.parse(localStorage.getItem("yrb_reward_v1"));
    d.lastActive = y.getFullYear() + "-" + (y.getMonth() + 1) + "-" + y.getDate();
    d.streak = 6;
    localStorage.setItem("yrb_reward_v1", JSON.stringify(d));
    location.reload();
  });
  await page.waitForTimeout(1800);
  await page.waitForSelector("#feed .card", { timeout: 20000 }).catch(() => {});
  const st2 = await page.evaluate(() => window.YRB_REWARD.state());
  check("昨天来过 → 今天 streak = 7（连续累加）", st2.streak === 7, `streak=${st2.streak}`);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("yrb_reward_v1"));
    d.lastActive = "2026-10-10"; d.streak = 9;
    localStorage.setItem("yrb_reward_v1", JSON.stringify(d));
    location.reload();
  });
  await page.waitForTimeout(1800);
  await page.waitForSelector("#feed .card", { timeout: 20000 }).catch(() => {});
  const st3 = await page.evaluate(() => window.YRB_REWARD.state());
  check("断签（上次 10-10）→ streak 重置 1", st3.streak === 1, `streak=${st3.streak}`);

  console.log("=== C. 每次打开「我的」：玫瑰 + 掌声 1 秒 ===");
  const wl1 = await page.evaluate(() => {
    document.querySelector('.tb-item[data-p="me"]').click();
    return true;
  });
  await page.waitForSelector("#rwWelcome", { timeout: 5000 }).catch(() => {});
  const w1 = await page.evaluate(() => {
    const w = document.querySelector("#rwWelcome");
    return w ? {
      exists: true,
      roses: w.querySelectorAll("span").length,
      text: (w.querySelector(".rw-wl-card") || {}).textContent || "",
      pointer: getComputedStyle(w).pointerEvents,
      inPhone: !!w.closest("#phone")
    } : { exists: false };
  });
  check("打开我的页 → 欢迎玫瑰层出现", w1.exists);
  check("满屏玫瑰（≥8 朵，大大的一朵朵）", w1.roses >= 8, `朵数=${w1.roses}`);
  check("文案标注掌声 1 秒", /掌声 1 秒/.test(w1.text), w1.text);
  check("层挂在 #phone 内、不挡操作（pointer-events:none）", w1.inPhone && w1.pointer === "none", w1.pointer);
  /* 点击可停止 */
  const stopped = await page.evaluate(() => {
    const b = document.querySelector("#rwWlStop");
    if (!b) return false;
    b.click();
    return /已停止/.test(b.textContent);
  });
  check("点击卡片可立即停止掌声", stopped);
  /* 关闭后再切走再切回来 → 又放一次（每次打开都放） */
  await page.waitForTimeout(4800);
  const gone = await page.evaluate(() => !document.querySelector("#rwWelcome"));
  check("约 4 秒后玫瑰层自动收场", gone);
  await page.evaluate(() => document.querySelector('.tb-item[data-p="home"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.tb-item[data-p="me"]').click());
  await page.waitForSelector("#rwWelcome", { timeout: 5000 }).catch(() => {});
  const again = await page.evaluate(() => !!document.querySelector("#rwWelcome"));
  check("切走再切回 → 再次奉上玫瑰（每次打开都放）", again);

  console.log("=== D. 长辈模式放大 ===");
  const elder = await page.evaluate(() => {
    document.getElementById("phone").setAttribute("data-elder", "1");
    const k = document.querySelector(".rw-tl-k");
    const card = document.querySelector(".rw-wl-card");
    return { k: k ? getComputedStyle(k).fontSize : "", card: card ? getComputedStyle(card).fontSize : "" };
  });
  check("长辈模式下称号卡文字放大（≥13px）", parseFloat(elder.k) >= 13, elder.k);
  check("长辈模式下欢迎卡片放大（≥16px）", parseFloat(elder.card) >= 16, elder.card);

  await browser.close();
  console.log(`\n===== 四维称号测试：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
